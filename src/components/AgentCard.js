// Active duration timers keyed by PID
const durationTimers = new Map();

/**
 * Creates a DOM element for an agent card.
 */
export function createAgentCard(agent, { onClick } = {}) {
  const card = document.createElement('div');
  card.className = `agent-card ${agent.status}`;
  card.dataset.pid = agent.pid;
  card.dataset.startTime = agent.startTime || '';
  card.dataset.status = agent.status;

  const projectDisplay = agent.cwd
    ? decodeProjectPath(agent.cwd)
    : 'unknown project';

  card.innerHTML = `
    <div class="agent-card-header">
      <span class="status-dot ${agent.status}"></span>
      <span class="agent-pid">PID ${agent.pid}</span>
      <span class="agent-status-label">${formatStatusLabel(agent.status)}</span>
    </div>
    <div class="agent-card-body">
      <div class="agent-meta">
        <span class="label">Duration</span>
        <span class="value agent-duration">${formatDuration(agent.startTime)}</span>
      </div>
      <div class="agent-meta">
        <span class="label">Project</span>
        <span class="value agent-project" title="${escapeAttr(agent.cwd || '')}">${escapeHtml(projectDisplay)}</span>
      </div>
      <div class="agent-meta">
        <span class="label">Session</span>
        <span class="value agent-session">${agent.sessionId ? truncate(agent.sessionId, 20) : '--'}</span>
      </div>
      <div class="agent-meta">
        <span class="label">Logs</span>
        <span class="value agent-log-count">${agent.logLineCount || 0} lines</span>
      </div>
    </div>
    <div class="agent-card-footer">
      <span class="agent-cmd" title="${escapeAttr(agent.commandLine)}">${escapeHtml(truncate(agent.commandLine, 50))}</span>
    </div>
  `;

  // Start live duration timer for active agents
  if (agent.status === 'active') {
    startDurationTimer(card, agent.startTime);
  }

  if (onClick) {
    card.addEventListener('click', () => onClick(agent));
  }

  return card;
}

/**
 * Updates an existing agent card in-place — no re-creation, only targeted DOM patches.
 */
export function updateAgentCard(container, agent) {
  const card = container.querySelector(`.agent-card[data-pid="${agent.pid}"]`);
  if (!card) return;

  const oldStatus = card.dataset.status;

  // Only touch class if status actually changed
  if (oldStatus !== agent.status) {
    card.className = `agent-card ${agent.status}`;
    card.dataset.status = agent.status;

    const statusDot = card.querySelector('.status-dot');
    if (statusDot) statusDot.className = `status-dot ${agent.status}`;

    const statusLabel = card.querySelector('.agent-status-label');
    if (statusLabel) statusLabel.textContent = formatStatusLabel(agent.status);

    // Manage duration timer based on status transition
    if (agent.status === 'active' && oldStatus !== 'active') {
      startDurationTimer(card, agent.startTime);
    } else if (agent.status === 'terminated') {
      stopDurationTimer(agent.pid);
    }
  }

  // Update session if it was discovered after initial creation
  const sessionEl = card.querySelector('.agent-session');
  if (sessionEl && agent.sessionId) {
    const newVal = truncate(agent.sessionId, 20);
    if (sessionEl.textContent !== newVal) {
      sessionEl.textContent = newVal;
    }
  }

  // Update project if correlated
  const projectEl = card.querySelector('.agent-project');
  if (projectEl && agent.cwd) {
    const newVal = decodeProjectPath(agent.cwd);
    if (projectEl.textContent !== newVal) {
      projectEl.textContent = newVal;
      projectEl.title = agent.cwd;
    }
  }

  // Update log count
  const logEl = card.querySelector('.agent-log-count');
  if (logEl) {
    const newVal = `${agent.logLineCount || 0} lines`;
    if (logEl.textContent !== newVal) {
      logEl.textContent = newVal;
    }
  }
}

/**
 * Removes an agent card with a fade-out animation.
 */
export function removeAgentCard(container, pid) {
  stopDurationTimer(pid);
  const card = container.querySelector(`.agent-card[data-pid="${pid}"]`);
  if (card) {
    card.classList.add('removing');
    setTimeout(() => card.remove(), 300);
  }
}

/**
 * Stops all running duration timers — call on monitor stop.
 */
export function stopAllTimers() {
  for (const [pid, timerId] of durationTimers) {
    clearInterval(timerId);
  }
  durationTimers.clear();
}

// --- Duration Timer ---

function startDurationTimer(card, startTime) {
  const pid = parseInt(card.dataset.pid, 10);
  stopDurationTimer(pid);

  if (!startTime) return;

  const el = card.querySelector('.agent-duration');
  if (!el) return;

  const timer = setInterval(() => {
    el.textContent = formatDuration(startTime);
  }, 1000);

  durationTimers.set(pid, timer);
}

function stopDurationTimer(pid) {
  if (durationTimers.has(pid)) {
    clearInterval(durationTimers.get(pid));
    durationTimers.delete(pid);
  }
}

// --- Helpers ---

function formatStatusLabel(status) {
  if (status === 'active') return 'Active';
  if (status === 'terminated') return 'Ended';
  return status;
}

function decodeProjectPath(encodedPath) {
  if (!encodedPath) return 'unknown';
  // Claude stores project paths with URL-encoded separators
  // e.g. "Z--Development-MyProject" → "Z:/Development/MyProject"
  try {
    return encodedPath
      .replace(/^([A-Za-z])--/, '$1:/')
      .replace(/-/g, '/');
  } catch {
    return encodedPath;
  }
}

export function formatDuration(startTime) {
  if (!startTime) return '--';

  const ms = Date.now() - new Date(startTime).getTime();
  if (ms < 0) return '--';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${String(minutes % 60).padStart(2, '0')}m ${String(seconds % 60).padStart(2, '0')}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  }
  return `${seconds}s`;
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
