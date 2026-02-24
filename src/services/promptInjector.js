const koffi = require('koffi');
const logger = require('./logger').create('promptInjector');

// --- Win32 constants ---
const STD_INPUT_HANDLE = -10;
const KEY_EVENT = 0x0001;
const VK_RETURN = 0x0D;
const SCAN_RETURN = 0x1C;

// --- koffi struct definitions ---
// CHAR union inside KEY_EVENT_RECORD — we use the Unicode member (UnicodeChar).
// koffi doesn't support unions directly, so we model it as a struct overlapping
// at the same offset.  Because we only write UnicodeChar we define the union as
// a single uint16 (2 bytes, matching the C union size).
const KEY_EVENT_RECORD = koffi.struct('KEY_EVENT_RECORD', {
  bKeyDown: 'int32',        // BOOL
  wRepeatCount: 'uint16',
  wVirtualKeyCode: 'uint16',
  wVirtualScanCode: 'uint16',
  UnicodeChar: 'uint16',    // union { WCHAR UnicodeChar; CHAR AsciiChar; }
  dwControlKeyState: 'uint32',
});

// INPUT_RECORD: EventType (uint16) + 2 bytes padding + union (max 16 bytes)
// For KEY_EVENT the union is KEY_EVENT_RECORD.
const INPUT_RECORD = koffi.struct('INPUT_RECORD', {
  EventType: 'uint16',
  _padding: 'uint16',
  Event: KEY_EVENT_RECORD,
});

// --- Load kernel32 functions ---
const kernel32 = koffi.load('kernel32.dll');

const FreeConsole = kernel32.func('int FreeConsole()');
const AttachConsole = kernel32.func('int AttachConsole(uint32 dwProcessId)');
const GetStdHandle = kernel32.func('intptr GetStdHandle(int nStdHandle)');
const WriteConsoleInputW = kernel32.func(
  'int WriteConsoleInputW(intptr hConsoleInput, _In_ INPUT_RECORD *lpBuffer, uint32 nLength, _Out_ uint32 *lpNumberOfEventsWritten)'
);

/**
 * Build a pair of INPUT_RECORD structs (key-down + key-up) for a single character.
 */
function charRecords(charCode, vk, scan) {
  return [
    {
      EventType: KEY_EVENT,
      _padding: 0,
      Event: {
        bKeyDown: 1,
        wRepeatCount: 1,
        wVirtualKeyCode: vk,
        wVirtualScanCode: scan,
        UnicodeChar: charCode,
        dwControlKeyState: 0,
      },
    },
    {
      EventType: KEY_EVENT,
      _padding: 0,
      Event: {
        bKeyDown: 0,
        wRepeatCount: 1,
        wVirtualKeyCode: vk,
        wVirtualScanCode: scan,
        UnicodeChar: charCode,
        dwControlKeyState: 0,
      },
    },
  ];
}

class PromptInjector {
  constructor() {
    // Serialization queue — only one AttachConsole can be active at a time.
    this._queue = Promise.resolve();
  }

  /**
   * Send text to a Claude agent's console as keyboard input.
   * @param {number} pid   - Target process PID
   * @param {string} text  - Text to inject (Enter is appended automatically)
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  sendPrompt(pid, text) {
    // Chain onto the serialization queue
    this._queue = this._queue
      .then(() => this._doSend(pid, text))
      .catch((err) => {
        logger.error(`sendPrompt failed for PID ${pid}`, { message: err.message });
        return { ok: false, error: err.message };
      });
    return this._queue;
  }

  /**
   * @private
   */
  _doSend(pid, text) {
    logger.info(`Injecting prompt to PID ${pid} (${text.length} chars)`);

    // Build INPUT_RECORD array for each character + trailing Enter
    const records = [];
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      // Use vk=0, scan=0 for regular characters — Windows console handles UnicodeChar
      records.push(...charRecords(code, 0, 0));
    }
    // Append Enter
    records.push(...charRecords(0x0D, VK_RETURN, SCAN_RETURN));

    // --- Attach / Write / Detach ---
    // FreeConsole first to detach from any current console (e.g. Electron's own)
    FreeConsole();

    try {
      const attached = AttachConsole(pid);
      if (!attached) {
        const msg = `AttachConsole failed for PID ${pid}`;
        logger.error(msg);
        return { ok: false, error: msg };
      }

      const handle = GetStdHandle(STD_INPUT_HANDLE);
      if (!handle || handle === -1) {
        const msg = `GetStdHandle failed for PID ${pid}`;
        logger.error(msg);
        return { ok: false, error: msg };
      }

      const written = [0];
      const ok = WriteConsoleInputW(handle, records, records.length, written);
      if (!ok) {
        const msg = `WriteConsoleInputW failed for PID ${pid}`;
        logger.error(msg);
        return { ok: false, error: msg };
      }

      logger.info(`Injected ${written[0]} events to PID ${pid}`);
      return { ok: true };
    } finally {
      FreeConsole();
    }
  }
}

module.exports = PromptInjector;
