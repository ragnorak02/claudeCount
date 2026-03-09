import store from '../../state/store';
import * as actions from '../../state/actions';

let _container = null;
let _unsubs = [];

export const GridView = {
  create(container) {
    _container = container;
    _container.className = 'view-grid';
    render();
    _unsubs.push(store.subscribe('worktrees', render));
    _unsubs.push(store.subscribe('agents', render));
  },

  destroy() {
    _unsubs.forEach(fn => fn());
    _unsubs = [];
    _container = null;
  },
};

function render() {
  if (!_container) return;
  const worktrees = store.get('worktrees');
  const agents = store.get('agents');

  if (worktrees.length === 0) {
    _container.innerHTML = `
      <div class="grid-empty">
        <p>No worktrees</p>
        <p class="hint">Select a project to see its worktrees</p>
      </div>
    `;
    return;
  }

  _container.innerHTML = `
    <div class="grid-cards">
      ${worktrees.map(wt => {
        const wtAgents = agents.filter(a => a.worktreeId === wt.id);
        const hasAttention = wtAgents.some(a =>
          a.status === 'waiting_input' || a.status === 'waiting_permission'
        );
        const isActive = wtAgents.some(a =>
          a.status === 'running' || a.status === 'starting'
        );

        let diffBadge = '';
        if (!wt.isMain && wt.commitsAhead > 0) {
          diffBadge = `<span class="diff-badge ahead">+${wt.commitsAhead}</span>`;
        } else if (!wt.isMain && wt.commitsBehind > 0) {
          diffBadge = `<span class="diff-badge behind">-${wt.commitsBehind}</span>`;
        }

        const lastActivity = wtAgents.length > 0
          ? formatTimeAgo(Math.max(...wtAgents.map(a => a.lastActivity || a.startTime)))
          : '';

        return `
          <div class="grid-card ${isActive ? 'active' : 'idle'} ${hasAttention ? 'attention' : ''}" data-id="${wt.id}">
            <div class="grid-card-header">
              <span class="grid-card-icon">
                ${wt.isMain
                  ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>'
                  : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>'
                }
              </span>
              <span class="grid-card-branch">${escHtml(wt.isMain ? 'main' : wt.branch)}</span>
              ${diffBadge}
            </div>
            <div class="grid-card-body">
              ${wtAgents.length > 0
                ? `<span class="agent-badge ${hasAttention ? 'attention' : ''}">${wtAgents.length} agent${wtAgents.length > 1 ? 's' : ''}</span>`
                : '<span class="idle-label">idle</span>'
              }
              ${lastActivity ? `<span class="time-ago">${lastActivity}</span>` : ''}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  _container.querySelectorAll('.grid-card').forEach(card => {
    card.addEventListener('click', () => {
      actions.selectWorktree(card.dataset.id);
    });
    card.addEventListener('dblclick', () => {
      const wt = worktrees.find(w => w.id === card.dataset.id);
      if (wt) {
        window.dispatchEvent(new CustomEvent('show-agent-launcher', {
          detail: { worktreeId: wt.id, worktreePath: wt.path }
        }));
      }
    });
  });
}

function formatTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
