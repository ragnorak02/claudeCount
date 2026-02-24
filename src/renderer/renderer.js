import '../styles/global.css';
import {
  createAgentCard,
  updateAgentCard,
  removeAgentCard,
  stopAllTimers,
  formatDuration,
} from '../components/AgentCard';
import { openAgentConsoleModal } from '../components/AgentConsoleModal';

// --- DOM References ---

const agentGrid = document.getElementById('agent-grid');
const emptyState = document.getElementById('empty-state');
const toggleBtn = document.getElementById('toggle-monitor');
const monitorStatus = document.getElementById('monitor-status');
const agentCountEl = document.getElementById('agent-count');
const sortSelect = document.getElementById('sort-select');
const healthDot = document.querySelector('#connection-health .health-dot');
const healthLabel = document.querySelector('#connection-health .health-label');

// --- State ---

let monitoring = false;
let agents = [];
let sortMode = 'pid-asc';
let lastUpdateTime = 0;
let updateCount = 0;
let fallbackPollTimer = null;

// Throttle: batch rapid IPC pushes — at most one render per 250ms
const THROTTLE_MS = 250;
let pendingRender = null;
let lastRenderTime = 0;

// --- Monitor Toggle ---

toggleBtn.addEventListener('click', async () => {
  if (monitoring) {
    await stopMonitoring();
  } else {
    await startMonitoring();
  }
});

async function startMonitoring() {
  await window.electronAPI.startMonitor();
  monitoring = true;
  toggleBtn.textContent = 'Stop Monitoring';
  monitorStatus.textContent = 'Running';
  monitorStatus.className = 'status-badge running';
  setHealth('ok', 'Connected');

  // Fetch initial snapshot
  const currentAgents = await window.electronAPI.getAgents();
  agents = currentAgents;
  renderAgents();

  // Start fallback polling (in case IPC push is missed)
  startFallbackPoll();
}

async function stopMonitoring() {
  await window.electronAPI.stopMonitor();
  monitoring = false;
  toggleBtn.textContent = 'Start Monitoring';
  monitorStatus.textContent = 'Stopped';
  monitorStatus.className = 'status-badge stopped';
  setHealth('off', '--');
  stopAllTimers();
  stopFallbackPoll();
}

// --- Sort Control ---

sortSelect.addEventListener('change', () => {
  sortMode = sortSelect.value;
  renderAgents();
});

function sortAgents(list) {
  const sorted = [...list];
  switch (sortMode) {
    case 'pid-asc':
      sorted.sort((a, b) => a.pid - b.pid);
      break;
    case 'start-newest':
      sorted.sort((a, b) => {
        const tA = a.startTime ? new Date(a.startTime).getTime() : 0;
        const tB = b.startTime ? new Date(b.startTime).getTime() : 0;
        return tB - tA;
      });
      break;
    case 'start-oldest':
      sorted.sort((a, b) => {
        const tA = a.startTime ? new Date(a.startTime).getTime() : 0;
        const tB = b.startTime ? new Date(b.startTime).getTime() : 0;
        return tA - tB;
      });
      break;
    case 'status':
      sorted.sort((a, b) => {
        const order = { active: 0, terminated: 1 };
        return (order[a.status] ?? 2) - (order[b.status] ?? 2);
      });
      break;
  }
  return sorted;
}

// --- IPC Event Listeners ---

window.electronAPI.onAgentsUpdated((data) => {
  agents = data.agents;
  lastUpdateTime = Date.now();
  updateCount++;
  scheduleRender();
});

window.electronAPI.onAgentLogLine((data) => {
  // Update the log count on the matching card directly (no full re-render)
  const card = agentGrid.querySelector(`.agent-card[data-pid="${data.pid}"]`);
  if (card) {
    const logEl = card.querySelector('.agent-log-count');
    if (logEl) {
      const current = parseInt(logEl.textContent, 10) || 0;
      logEl.textContent = `${current + 1} lines`;
    }
  }
});

// --- Throttled Rendering ---

function scheduleRender() {
  if (pendingRender) return; // already scheduled

  const elapsed = Date.now() - lastRenderTime;
  if (elapsed >= THROTTLE_MS) {
    renderAgents();
  } else {
    pendingRender = setTimeout(() => {
      pendingRender = null;
      renderAgents();
    }, THROTTLE_MS - elapsed);
  }
}

// --- Rendering (Diffed) ---

function renderAgents() {
  lastRenderTime = Date.now();

  // Update header counts
  const activeCount = agents.filter((a) => a.status === 'active').length;
  const totalCount = agents.length;
  agentCountEl.textContent = activeCount === totalCount
    ? `${activeCount} agent${activeCount !== 1 ? 's' : ''}`
    : `${activeCount} active / ${totalCount} total`;

  // Empty state
  if (totalCount === 0) {
    emptyState.classList.add('visible');
    agentGrid.innerHTML = '';
    return;
  }
  emptyState.classList.remove('visible');

  const sorted = sortAgents(agents);

  // Build a set of current PIDs for diffing
  const currentPids = new Set(sorted.map((a) => a.pid));

  // Collect existing card PIDs
  const existingCards = agentGrid.querySelectorAll('.agent-card');
  const existingPids = new Set();
  existingCards.forEach((card) => {
    existingPids.add(parseInt(card.dataset.pid, 10));
  });

  // 1) Remove cards whose PID is no longer in the agent list
  for (const pid of existingPids) {
    if (!currentPids.has(pid)) {
      removeAgentCard(agentGrid, pid);
    }
  }

  // 2) Update existing cards or create new ones
  //    Build a document fragment for new cards to avoid multiple reflows
  const fragment = document.createDocumentFragment();
  const newPids = [];

  for (const agent of sorted) {
    if (existingPids.has(agent.pid)) {
      updateAgentCard(agentGrid, agent);
    } else {
      const card = createAgentCard(agent, {
        onClick: (a) => openAgentConsoleModal(a),
      });
      fragment.appendChild(card);
      newPids.push(agent.pid);
    }
  }

  // Append all new cards in one batch
  if (fragment.childNodes.length > 0) {
    agentGrid.appendChild(fragment);
  }

  // 3) Re-order cards to match sorted order without removing/re-adding
  //    Only re-order if the DOM order doesn't match
  const desiredOrder = sorted.map((a) => a.pid);
  const currentOrder = Array.from(agentGrid.querySelectorAll('.agent-card:not(.removing)'))
    .map((c) => parseInt(c.dataset.pid, 10));

  if (!arraysEqual(desiredOrder, currentOrder)) {
    reorderCards(agentGrid, desiredOrder);
  }

  // Update connection health
  updateHealth();
}

/**
 * Reorders cards in the grid to match the desired PID order.
 * Uses DOM reinsert (cheap — no destroy/create).
 */
function reorderCards(container, pidOrder) {
  for (const pid of pidOrder) {
    const card = container.querySelector(`.agent-card[data-pid="${pid}"]`);
    if (card) {
      container.appendChild(card); // moves existing node to end
    }
  }
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// --- Fallback Polling ---

function startFallbackPoll() {
  stopFallbackPoll();
  fallbackPollTimer = setInterval(async () => {
    if (!monitoring) return;

    // If we haven't received an IPC push in 10s, fetch directly
    if (Date.now() - lastUpdateTime > 10_000) {
      setHealth('degraded', 'Polling');
      try {
        const currentAgents = await window.electronAPI.getAgents();
        agents = currentAgents;
        lastUpdateTime = Date.now();
        renderAgents();
      } catch (err) {
        setHealth('error', 'Error');
      }
    }
  }, 5_000);
}

function stopFallbackPoll() {
  if (fallbackPollTimer) {
    clearInterval(fallbackPollTimer);
    fallbackPollTimer = null;
  }
}

// --- Connection Health ---

function setHealth(state, label) {
  healthDot.className = `health-dot ${state}`;
  healthLabel.textContent = label;
}

function updateHealth() {
  if (!monitoring) return;
  const age = Date.now() - lastUpdateTime;
  if (age < 5_000) {
    setHealth('ok', 'Live');
  } else if (age < 15_000) {
    setHealth('degraded', 'Stale');
  } else {
    setHealth('error', 'Lost');
  }
}

// --- Auto-start on load ---

(async () => {
  await startMonitoring();
})();
