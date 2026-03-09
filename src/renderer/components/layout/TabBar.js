import store from '../../state/store';
import * as actions from '../../state/actions';

const VIEWS = [
  { id: 'board', label: 'Board', icon: boardIcon() },
  { id: 'list', label: 'List', icon: listIcon() },
  { id: 'grid', label: 'Grid', icon: gridIcon() },
  { id: 'terminal', label: 'Terminal', icon: terminalIcon() },
];

/**
 * Tab bar for switching views.
 */
export function createTabBar() {
  const container = document.getElementById('view-toggles');
  let _unsub = null;

  function render(currentView) {
    container.innerHTML = VIEWS.map(v => `
      <button class="view-toggle-btn ${v.id === currentView ? 'active' : ''}"
              data-view="${v.id}" title="${v.label}">
        ${v.icon}
      </button>
    `).join('');

    container.querySelectorAll('.view-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        actions.setView(btn.dataset.view);
      });
    });
  }

  _unsub = store.subscribe('ui', (ui) => {
    render(ui.currentView);
  });

  render(store.get('ui').currentView);

  return {
    destroy() {
      if (_unsub) _unsub();
    }
  };
}

function boardIcon() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
    <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
  </svg>`;
}

function listIcon() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
    <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
    <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
  </svg>`;
}

function gridIcon() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
    <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
  </svg>`;
}

function terminalIcon() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
  </svg>`;
}
