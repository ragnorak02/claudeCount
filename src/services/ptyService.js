const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const path = require('node:path');
const pty = require('node-pty');
const config = require('./config');
const logger = require('./logger').create('ptyService');

/**
 * Generalized PTY service — can spawn any command (claude, codex, shell).
 *
 * Emits:
 *   terminal-created  { id, pid, cwd, command }
 *   terminal-output   { id, pid, data }
 *   terminal-exited   { id, pid, exitCode }
 */
class PtyService extends EventEmitter {
  constructor() {
    super();
    this._terminals = new Map(); // id -> TerminalSession
  }

  /**
   * Create a new PTY terminal.
   * @param {object} opts
   * @param {string} opts.cwd - Working directory
   * @param {string} [opts.command] - Command to run (default: shell)
   * @param {string[]} [opts.args] - Command arguments
   * @param {number} [opts.cols] - Terminal columns
   * @param {number} [opts.rows] - Terminal rows
   * @param {string} [opts.type] - 'agent' or 'terminal'
   * @param {object} [opts.meta] - Extra metadata (agentType, prompt, worktreeId, etc.)
   * @returns {{ ok: boolean, id?: string, pid?: number, error?: string }}
   */
  create(opts) {
    try {
      const id = crypto.randomUUID();
      const command = opts.command || this._defaultShell();
      const args = opts.args || [];
      const cols = opts.cols || config.PTY_DEFAULT_COLS;
      const rows = opts.rows || config.PTY_DEFAULT_ROWS;

      const env = { ...process.env };
      delete env.TERM_PROGRAM;
      delete env.CLAUDECODE;        // Prevent "nested session" error
      delete env.CLAUDE_CODE_ENTRY;  // Belt and suspenders

      // Resolve command to full path on Windows if needed
      let spawnCmd = command;
      let spawnArgs = args;
      if (process.platform === 'win32' && command !== this._defaultShell()) {
        const resolved = this._resolveWindowsCommand(command);
        if (resolved) {
          spawnCmd = resolved;
        } else {
          // Fallback: wrap in cmd.exe /c
          spawnCmd = process.env.COMSPEC || 'cmd.exe';
          spawnArgs = ['/c', command, ...args];
        }
      }

      const ptyProcess = pty.spawn(spawnCmd, spawnArgs, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: opts.cwd,
        env,
      });

      const pid = ptyProcess.pid;

      const session = {
        id,
        pid,
        cwd: opts.cwd,
        command,
        args,
        type: opts.type || 'terminal',
        meta: opts.meta || {},
        ptyProcess,
        startTime: Date.now(),
        status: 'active',
        exitCode: null,
        ringBuffer: [],
      };

      this._terminals.set(id, session);

      // Wire events
      ptyProcess.onData((data) => this._onData(id, data));
      ptyProcess.onExit(({ exitCode }) => this._onExit(id, exitCode));

      logger.info('Terminal created', { id, pid, command, cwd: opts.cwd, type: session.type });

      this.emit('terminal-created', {
        id,
        pid,
        cwd: opts.cwd,
        command,
        type: session.type,
        meta: session.meta,
      });

      return { ok: true, id, pid };
    } catch (err) {
      logger.error('Failed to create terminal', { error: err.message });
      return { ok: false, error: err.message };
    }
  }

  /**
   * Write data to a terminal.
   */
  write(id, data) {
    const session = this._terminals.get(id);
    if (!session) return { ok: false, error: 'Terminal not found' };
    if (session.status !== 'active') return { ok: false, error: 'Terminal not active' };
    try {
      session.ptyProcess.write(data);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Resize a terminal.
   */
  resize(id, cols, rows) {
    const session = this._terminals.get(id);
    if (!session || session.status !== 'active') return;
    try {
      session.ptyProcess.resize(cols, rows);
    } catch (err) {
      logger.warn('Resize failed', { id, error: err.message });
    }
  }

  /**
   * Close/kill a terminal.
   */
  close(id) {
    const session = this._terminals.get(id);
    if (!session) return { ok: false, error: 'Terminal not found' };
    if (session.status !== 'active') {
      this._terminals.delete(id);
      return { ok: true };
    }

    try {
      // Try graceful first
      session.ptyProcess.write('\x03');
      setTimeout(() => {
        if (session.status === 'active') {
          try { session.ptyProcess.kill(); } catch { /* ignore */ }
        }
      }, 3000);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Get terminal info (no pty handle exposed).
   */
  get(id) {
    const s = this._terminals.get(id);
    if (!s) return null;
    return {
      id: s.id,
      pid: s.pid,
      cwd: s.cwd,
      command: s.command,
      type: s.type,
      meta: s.meta,
      startTime: s.startTime,
      status: s.status,
      exitCode: s.exitCode,
    };
  }

  /**
   * Get all terminal infos.
   */
  getAll() {
    return Array.from(this._terminals.values()).map(s => ({
      id: s.id,
      pid: s.pid,
      cwd: s.cwd,
      command: s.command,
      type: s.type,
      meta: s.meta,
      startTime: s.startTime,
      status: s.status,
      exitCode: s.exitCode,
    }));
  }

  /**
   * Get ring buffer for a terminal.
   */
  getBuffer(id) {
    const s = this._terminals.get(id);
    if (!s) return [];
    return [...s.ringBuffer];
  }

  /**
   * Kill all terminals (for shutdown).
   */
  killAll() {
    let count = 0;
    for (const [id, session] of this._terminals) {
      if (session.status === 'active') {
        try {
          session.ptyProcess.kill();
          count++;
        } catch { /* ignore */ }
      }
    }
    logger.info('Killed all terminals', { count });
  }

  // --- Internal ---

  _onData(id, data) {
    const session = this._terminals.get(id);
    if (!session) return;

    // Ring buffer
    const lines = data.split(/\r?\n/);
    for (const line of lines) {
      if (line.length > 0) {
        session.ringBuffer.push(line);
      }
    }
    if (session.ringBuffer.length > config.PTY_RING_BUFFER_MAX_LINES) {
      session.ringBuffer = session.ringBuffer.slice(-config.PTY_RING_BUFFER_MAX_LINES);
    }

    this.emit('terminal-output', { id, pid: session.pid, data });
  }

  _onExit(id, exitCode) {
    const session = this._terminals.get(id);
    if (!session) return;

    session.status = 'exited';
    session.exitCode = exitCode;

    logger.info('Terminal exited', { id, pid: session.pid, exitCode });
    this.emit('terminal-exited', { id, pid: session.pid, exitCode });
  }

  /**
   * Resolve a command name to its full path on Windows.
   * Searches PATH for .exe, .cmd, .bat variants.
   */
  _resolveWindowsCommand(command) {
    if (path.isAbsolute(command)) return command;

    const fs = require('node:fs');
    const pathDirs = (process.env.PATH || '').split(';');
    const extensions = ['.exe', '.cmd', '.bat', ''];

    for (const dir of pathDirs) {
      for (const ext of extensions) {
        const candidate = path.join(dir, command + ext);
        try {
          if (fs.existsSync(candidate)) {
            logger.debug('Resolved command', { command, resolved: candidate });
            return candidate;
          }
        } catch { /* ignore */ }
      }
    }
    return null;
  }

  _defaultShell() {
    if (process.platform === 'win32') {
      return process.env.COMSPEC || 'cmd.exe';
    }
    return process.env.SHELL || '/bin/bash';
  }
}

module.exports = new PtyService();
