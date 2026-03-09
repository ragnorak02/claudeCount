import store from '../../state/store';
import * as actions from '../../state/actions';

let _container = null;
let _unsubs = [];

export const ListView = {
  create(container) {
    _container = container;
    _container.className = 'view-list';
    render();
    _unsubs.push(store.subscribe('agents', render));
    _unsubs.push(store.subscribe('worktrees', render));
  },

  destroy() {
    _unsubs.forEach(fn => fn());
    _unsubs = [];
    _container = null;
  },
};

function render() {
  if (!_container) return;
  const agents = store.get('agents');
  const worktrees = store.get('worktrees');

  if (agents.length === 0) {
    _container.innerHTML = `
      <div class="list-empty">
        <p>No agents running</p>
        <p class="hint">Launch an agent from the sidebar or command palette</p>
      </div>
    `;
    return;
  }

  _container.innerHTML = `
    <div class="list-header-row">
      <span class="list-col list-col-type">Type</span>
      <span class="list-col list-col-prompt">Prompt</span>
      <span class="list-col list-col-status">Status</span>
      <span class="list-col list-col-worktree">Worktree</span>
      <span class="list-col list-col-time">Duration</span>
      <span class="list-col list-col-actions">Actions</span>
    </div>
    <div class="list-body">
      ${agents.map(agent => {
        const wt = worktrees.find(w => w.id === agent.worktreeId);
        const duration = formatDuration(agent.startTime, agent.endTime);
        const statusClass = `status-${agent.status}`;

        return `
          <div class="list-row ${agent.status === 'waiting_input' || agent.status === 'waiting_permission' ? 'attention' : ''}" data-id="${agent.id}">
            <span class="list-col list-col-type">
              <span class="agent-type-badge badge-${agent.type}">${agent.type}</span>
            </span>
            <span class="list-col list-col-prompt" title="${escHtml(agent.prompt)}">${escHtml(agent.prompt || '—')}</span>
            <span class="list-col list-col-status">
              <span class="status-dot ${statusClass}"></span>
              <span class="status-label">${formatStatus(agent.status)}</span>
            </span>
            <span class="list-col list-col-worktree">${wt ? escHtml(wt.branch) : '—'}</span>
            <span class="list-col list-col-time">${duration}</span>
            <span class="list-col list-col-actions">
              ${agent.status === 'running' || agent.status === 'starting' || agent.status === 'waiting_input' || agent.status === 'waiting_permission'
                ? `<button class="btn btn-sm btn-danger terminate-btn" data-id="${agent.id}">Stop</button>`
                : ''}
            </span>
          </div>
        `;
      }).join('')}
    </div>
  `;

  _container.querySelectorAll('.terminate-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      actions.terminateAgent(btn.dataset.id);
    });
  });

  _container.querySelectorAll('.list-row').forEach(row => {
    row.addEventListener('click', () => {
      const agent = store.get('agents').find(a => a.id === row.dataset.id);
      if (agent && agent.terminalId) {
        actions.setActiveTerminal(agent.terminalId);
        actions.setView('terminal');
      }
    });
  });
}

function formatDuration(startTime, endTime) {
  const end = endTime || Date.now();
  const diff = end - startTime;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatStatus(status) {
  return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
