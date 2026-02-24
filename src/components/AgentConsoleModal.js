import { formatDuration } from './AgentCard';

// --- Module-scoped state (singleton modal) ---
let overlay = null;
let currentPid = null;
let logLineListener = null;
let metaPollTimer = null;
let escKeyHandler = null;
let autoScroll = true;
let currentAgentStatus = null;

const MAX_LOG_ENTRIES = 1000;

/**
 * Opens the agent console modal. Only one can be open at a time.
 */
export function openAgentConsoleModal(agent) {
  // Close existing modal first (full cleanup)
  if (overlay) {
    closeAgentConsoleModalImmediate();
  }

  currentPid = agent.pid;

  // Build DOM
  overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const container = document.createElement('div');
  container.className = 'modal-container';

  // --- Header ---
  const header = document.createElement('div');
  header.className = 'modal-header';

  const titleRow = document.createElement('div');
  titleRow.className = 'modal-title-row';

  const statusDot = document.createElement('span');
  statusDot.className = `status-dot ${agent.status}`;
  statusDot.id = 'modal-status-dot';

  const title = document.createElement('span');
  title.className = 'modal-title';
  title.textContent = `Agent PID ${agent.pid}`;

  const statusBadge = document.createElement('span');
  statusBadge.className = `modal-status-badge ${agent.status}`;
  statusBadge.id = 'modal-status-badge';
  statusBadge.textContent = agent.status === 'active' ? 'Active' : 'Ended';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'modal-close-btn';
  closeBtn.innerHTML = '&#x2715;';
  closeBtn.title = 'Close (Esc)';

  titleRow.append(statusDot, title, statusBadge, closeBtn);

  const metaGrid = document.createElement('div');
  metaGrid.className = 'modal-meta-grid';

  const projectDisplay = agent.cwd ? decodeProjectPath(agent.cwd) : '--';

  metaGrid.innerHTML = `
    <div class="modal-meta-item">
      <span class="label">Duration</span>
      <span class="value" id="modal-duration">${formatDuration(agent.startTime)}</span>
    </div>
    <div class="modal-meta-item">
      <span class="label">Project</span>
      <span class="value" title="${escapeAttr(agent.cwd || '')}">${escapeHtml(projectDisplay)}</span>
    </div>
    <div class="modal-meta-item">
      <span class="label">Session</span>
      <span class="value">${agent.sessionId ? truncate(agent.sessionId, 24) : '--'}</span>
    </div>
    <div class="modal-meta-item">
      <span class="label">Command</span>
      <span class="value" title="${escapeAttr(agent.commandLine || '')}">${escapeHtml(truncate(agent.commandLine || '', 40))}</span>
    </div>
  `;

  header.append(titleRow, metaGrid);

  // --- Body ---
  const body = document.createElement('div');
  body.className = 'modal-body';

  const toolbar = document.createElement('div');
  toolbar.className = 'modal-log-toolbar';

  const logCount = document.createElement('span');
  logCount.className = 'log-count';
  logCount.id = 'modal-log-count';
  logCount.textContent = '0 messages';

  const scrollLabel = document.createElement('label');
  const scrollCheckbox = document.createElement('input');
  scrollCheckbox.type = 'checkbox';
  scrollCheckbox.checked = true;
  scrollCheckbox.id = 'modal-autoscroll';
  scrollLabel.append(scrollCheckbox, ' Auto-scroll');

  toolbar.append(logCount, scrollLabel);

  const logViewer = document.createElement('div');
  logViewer.className = 'modal-log-viewer';
  logViewer.id = 'modal-log-viewer';

  const logStatus = document.createElement('div');
  logStatus.className = 'modal-log-status';
  logStatus.id = 'modal-log-status';
  logStatus.style.display = 'none';

  // --- Input Area ---
  currentAgentStatus = agent.status;

  const inputArea = document.createElement('div');
  inputArea.className = 'modal-input-area';
  inputArea.id = 'modal-input-area';

  const inputBox = document.createElement('textarea');
  inputBox.className = 'modal-input-box';
  inputBox.id = 'modal-input-box';
  inputBox.rows = 2;
  inputBox.placeholder = 'Type a message to send to this agent...';
  if (agent.status === 'terminated') {
    inputBox.disabled = true;
    inputBox.placeholder = 'Agent has terminated';
  }

  const sendBtn = document.createElement('button');
  sendBtn.className = 'modal-send-btn';
  sendBtn.id = 'modal-send-btn';
  sendBtn.textContent = 'Send';
  if (agent.status === 'terminated') {
    sendBtn.disabled = true;
  }

  const inputStatus = document.createElement('span');
  inputStatus.className = 'modal-input-status';
  inputStatus.id = 'modal-input-status';

  inputArea.append(inputBox, sendBtn, inputStatus);

  // --- Send handler ---
  async function doSend() {
    const text = inputBox.value;
    if (!text || !text.trim()) return;
    if (currentAgentStatus === 'terminated') return;

    inputBox.disabled = true;
    sendBtn.disabled = true;
    inputStatus.textContent = 'Sending...';
    inputStatus.className = 'modal-input-status sending';

    try {
      const result = await window.electronAPI.sendPromptToAgent(currentPid, text);
      if (result.ok) {
        inputStatus.textContent = 'Sent';
        inputStatus.className = 'modal-input-status sent';
        inputBox.value = '';
      } else {
        inputStatus.textContent = result.error || 'Send failed';
        inputStatus.className = 'modal-input-status error';
      }
    } catch (err) {
      inputStatus.textContent = 'Send failed';
      inputStatus.className = 'modal-input-status error';
    } finally {
      if (currentAgentStatus !== 'terminated') {
        inputBox.disabled = false;
        sendBtn.disabled = false;
        inputBox.focus();
      }
      // Clear status after a few seconds
      setTimeout(() => {
        if (inputStatus.textContent === 'Sent' || inputStatus.textContent === 'Send failed') {
          inputStatus.textContent = '';
        }
      }, 3000);
    }
  }

  sendBtn.addEventListener('click', doSend);

  inputBox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });

  body.append(toolbar, logViewer, logStatus, inputArea);
  container.append(header, body);
  overlay.append(backdrop, container);
  document.body.appendChild(overlay);

  // --- Bind close handlers ---
  closeBtn.addEventListener('click', () => closeAgentConsoleModal());
  backdrop.addEventListener('click', () => closeAgentConsoleModal());

  escKeyHandler = (e) => {
    if (e.key === 'Escape') closeAgentConsoleModal();
  };
  document.addEventListener('keydown', escKeyHandler);

  // --- Auto-scroll detection ---
  autoScroll = true;
  scrollCheckbox.checked = true;

  logViewer.addEventListener('scroll', () => {
    const atBottom = logViewer.scrollHeight - logViewer.scrollTop - logViewer.clientHeight < 50;
    autoScroll = atBottom;
    scrollCheckbox.checked = atBottom;
  });

  scrollCheckbox.addEventListener('change', () => {
    autoScroll = scrollCheckbox.checked;
    if (autoScroll) {
      logViewer.scrollTop = logViewer.scrollHeight;
    }
  });

  // --- Fetch initial logs ---
  fetchAndRenderLogs(agent.pid, logViewer, logStatus, logCount);

  // --- Subscribe to live log lines ---
  logLineListener = window.electronAPI.onAgentLogLine((data) => {
    if (data.pid !== currentPid) return;
    appendLogLine(logViewer, logCount, data.line);
  });

  // --- Start metadata poll ---
  startMetaPoll(agent.pid);
}

/**
 * Closes the modal with animation.
 */
export function closeAgentConsoleModal() {
  if (!overlay) return;

  // Remove IPC listener
  if (logLineListener) {
    window.electronAPI.removeListener('agent:log-line', logLineListener);
    logLineListener = null;
  }

  // Clear metadata poll
  if (metaPollTimer) {
    clearInterval(metaPollTimer);
    metaPollTimer = null;
  }

  // Remove keydown listener
  if (escKeyHandler) {
    document.removeEventListener('keydown', escKeyHandler);
    escKeyHandler = null;
  }

  // Animate out
  const ref = overlay;
  ref.classList.add('closing');
  setTimeout(() => {
    ref.remove();
  }, 200);

  overlay = null;
  currentPid = null;
}

/**
 * Closes modal immediately without animation (used when switching agents).
 */
function closeAgentConsoleModalImmediate() {
  if (!overlay) return;

  if (logLineListener) {
    window.electronAPI.removeListener('agent:log-line', logLineListener);
    logLineListener = null;
  }
  if (metaPollTimer) {
    clearInterval(metaPollTimer);
    metaPollTimer = null;
  }
  if (escKeyHandler) {
    document.removeEventListener('keydown', escKeyHandler);
    escKeyHandler = null;
  }

  overlay.remove();
  overlay = null;
  currentPid = null;
}

// --- Data Fetching ---

async function fetchAndRenderLogs(pid, logViewer, logStatus, logCount) {
  try {
    const result = await window.electronAPI.getAgentLogs(pid);

    if (!result.available) {
      logViewer.style.display = 'none';
      logStatus.style.display = 'flex';
      logStatus.textContent = result.reason || 'Logs unavailable';
      logCount.textContent = '0 messages';
      return;
    }

    logViewer.style.display = 'block';
    logStatus.style.display = 'none';

    if (result.logs.length === 0) {
      logCount.textContent = '0 messages';
      return;
    }

    // Batch-render existing logs
    const fragment = document.createDocumentFragment();
    for (const line of result.logs) {
      const el = createLogLineElement(line);
      if (el) fragment.appendChild(el);
    }
    logViewer.appendChild(fragment);

    logCount.textContent = `${result.logs.length} message${result.logs.length !== 1 ? 's' : ''}`;

    // Auto-scroll to bottom
    if (autoScroll) {
      logViewer.scrollTop = logViewer.scrollHeight;
    }
  } catch (err) {
    logViewer.style.display = 'none';
    logStatus.style.display = 'flex';
    logStatus.textContent = 'Failed to fetch logs';
    console.error('[AgentConsoleModal] fetchAndRenderLogs error:', err);
  }
}

function appendLogLine(logViewer, logCount, line) {
  const el = createLogLineElement(line);
  if (!el) return;

  logViewer.appendChild(el);

  // DOM pruning — cap at MAX_LOG_ENTRIES
  while (logViewer.children.length > MAX_LOG_ENTRIES) {
    logViewer.removeChild(logViewer.firstChild);
  }

  // Update count
  const count = logViewer.children.length;
  logCount.textContent = `${count} message${count !== 1 ? 's' : ''}`;

  // Auto-scroll
  if (autoScroll) {
    logViewer.scrollTop = logViewer.scrollHeight;
  }
}

// --- Metadata Polling ---

function startMetaPoll(pid) {
  if (metaPollTimer) clearInterval(metaPollTimer);

  metaPollTimer = setInterval(async () => {
    try {
      const meta = await window.electronAPI.getAgentMeta(pid);

      if (!meta) {
        // Agent was pruned from registry — stop polling
        clearInterval(metaPollTimer);
        metaPollTimer = null;
        return;
      }

      // Update duration
      const durationEl = document.getElementById('modal-duration');
      if (durationEl) {
        durationEl.textContent = formatDuration(meta.startTime);
      }

      // Update status
      const dotEl = document.getElementById('modal-status-dot');
      const badgeEl = document.getElementById('modal-status-badge');
      if (dotEl) dotEl.className = `status-dot ${meta.status}`;
      if (badgeEl) {
        badgeEl.className = `modal-status-badge ${meta.status}`;
        badgeEl.textContent = meta.status === 'active' ? 'Active' : 'Ended';
      }

      // Disable input area when agent terminates
      if (meta.status === 'terminated' && currentAgentStatus !== 'terminated') {
        currentAgentStatus = 'terminated';
        const box = document.getElementById('modal-input-box');
        const btn = document.getElementById('modal-send-btn');
        if (box) { box.disabled = true; box.placeholder = 'Agent has terminated'; }
        if (btn) { btn.disabled = true; }
      }
      currentAgentStatus = meta.status;
    } catch {
      // Silently ignore — modal may be closing
    }
  }, 2000);
}

// --- Log Line Formatting ---

function createLogLineElement(line) {
  if (!line || typeof line !== 'object') return null;

  const type = line.type || 'unknown';
  const entry = document.createElement('div');

  switch (type) {
    case 'user':
      entry.className = 'log-entry log-role-user';
      entry.appendChild(createBadge('User'));
      entry.appendChild(createContentElement(extractUserContent(line)));
      break;

    case 'assistant':
      entry.className = 'log-entry log-role-assistant';
      entry.appendChild(createBadge('Assistant'));
      entry.appendChild(createContentElement(extractAssistantContent(line)));
      appendToolUseIndicators(entry, line);
      appendTokenUsage(entry, line);
      break;

    case 'file-history-snapshot':
      entry.className = 'log-entry log-role-system';
      entry.appendChild(createBadge('File Snapshot'));
      const collapsed = document.createElement('div');
      collapsed.className = 'log-collapsed';
      collapsed.textContent = '[file history snapshot]';
      entry.appendChild(collapsed);
      break;

    default:
      entry.className = 'log-entry log-role-unknown';
      entry.appendChild(createBadge(type));
      const raw = document.createElement('div');
      raw.className = 'log-content';
      raw.textContent = truncate(JSON.stringify(line), 500);
      entry.appendChild(raw);
      break;
  }

  return entry;
}

function createBadge(text) {
  const badge = document.createElement('div');
  badge.className = 'log-role-badge';
  badge.textContent = text;
  return badge;
}

function createContentElement(text) {
  const content = document.createElement('div');
  content.className = 'log-content';
  content.textContent = text || '';
  return content;
}

function extractUserContent(line) {
  const msg = line.message;
  if (!msg) return '';

  if (typeof msg.content === 'string') return msg.content;

  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
  }

  return JSON.stringify(msg.content || msg);
}

function extractAssistantContent(line) {
  const msg = line.message;
  if (!msg) return '';

  if (typeof msg.content === 'string') return msg.content;

  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
  }

  return '';
}

function appendToolUseIndicators(entry, line) {
  const msg = line.message;
  if (!msg || !Array.isArray(msg.content)) return;

  const toolUses = msg.content.filter((block) => block.type === 'tool_use');
  if (toolUses.length === 0) return;

  const container = document.createElement('div');
  for (const tool of toolUses) {
    const tag = document.createElement('span');
    tag.className = 'log-tool-use';
    tag.textContent = tool.name || 'tool_use';
    container.appendChild(tag);
  }
  entry.appendChild(container);
}

function appendTokenUsage(entry, line) {
  // Token usage may be in line.costUSD, line.usage, etc.
  const usage = line.usage || (line.message && line.message.usage);
  if (!usage) return;

  const el = document.createElement('div');
  el.className = 'log-token-usage';

  const parts = [];
  if (usage.input_tokens) parts.push(`in: ${usage.input_tokens}`);
  if (usage.output_tokens) parts.push(`out: ${usage.output_tokens}`);
  if (parts.length > 0) {
    el.textContent = `Tokens: ${parts.join(' | ')}`;
    entry.appendChild(el);
  }
}

// --- Helpers ---

function decodeProjectPath(encodedPath) {
  if (!encodedPath) return '--';
  try {
    return encodedPath
      .replace(/^([A-Za-z])--/, '$1:/')
      .replace(/-/g, '/');
  } catch {
    return encodedPath;
  }
}

function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.substring(0, maxLen) + '\u2026' : str;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
