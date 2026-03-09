import store from '../../state/store';
import * as actions from '../../state/actions';

/**
 * Command palette — Ctrl+P to open.
 */
let _commands = [];
let _filteredCommands = [];
let _selectedIndex = 0;

export function initCommandPalette() {
  const overlay = document.getElementById('command-palette');
  const input = document.getElementById('palette-input');
  const results = document.getElementById('palette-results');

  // Register commands
  _commands = [
    { label: 'Switch to Board View', category: 'View', action: () => actions.setView('board') },
    { label: 'Switch to List View', category: 'View', action: () => actions.setView('list') },
    { label: 'Switch to Grid View', category: 'View', action: () => actions.setView('grid') },
    { label: 'Switch to Terminal View', category: 'View', action: () => actions.setView('terminal') },
    { label: 'Toggle Sidebar', category: 'UI', action: () => actions.toggleSidebar() },
    { label: 'Take Screenshot', category: 'App', action: () => actions.takeScreenshot() },
    { label: 'Add Project', category: 'Project', action: () => document.getElementById('btn-add-project').click() },
    { label: 'New Terminal', category: 'Terminal', action: () => {
      const wt = store.get('worktrees').find(w => w.id === store.get('selectedWorktreeId'));
      if (wt) actions.openTerminal(wt.path, wt.branch);
    }},
    { label: 'Launch Agent', category: 'Agent', action: () => {
      const wt = store.get('worktrees').find(w => w.id === store.get('selectedWorktreeId'));
      if (wt) {
        window.dispatchEvent(new CustomEvent('show-agent-launcher', {
          detail: { worktreeId: wt.id, worktreePath: wt.path }
        }));
      }
    }},
    { label: 'Create Worktree', category: 'Git', action: () => {
      window.dispatchEvent(new CustomEvent('show-create-worktree'));
    }},
  ];

  function open() {
    overlay.classList.remove('hidden');
    input.value = '';
    _selectedIndex = 0;
    filter('');
    input.focus();
  }

  function close() {
    overlay.classList.add('hidden');
    actions.closeCommandPalette();
  }

  function filter(query) {
    const q = query.toLowerCase();
    _filteredCommands = q
      ? _commands.filter(c => c.label.toLowerCase().includes(q) || c.category.toLowerCase().includes(q))
      : [..._commands];
    _selectedIndex = Math.min(_selectedIndex, Math.max(0, _filteredCommands.length - 1));
    renderResults();
  }

  function renderResults() {
    results.innerHTML = _filteredCommands.map((cmd, i) => `
      <div class="palette-item ${i === _selectedIndex ? 'selected' : ''}" data-index="${i}">
        <span class="palette-category">${cmd.category}</span>
        <span class="palette-label">${cmd.label}</span>
      </div>
    `).join('') || '<div class="palette-empty">No matching commands</div>';

    results.querySelectorAll('.palette-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.index);
        execute(idx);
      });
      el.addEventListener('mouseenter', () => {
        _selectedIndex = parseInt(el.dataset.index);
        renderResults();
      });
    });
  }

  function execute(index) {
    const cmd = _filteredCommands[index];
    if (cmd) {
      close();
      cmd.action();
    }
  }

  // Events
  input.addEventListener('input', () => filter(input.value));

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); e.preventDefault(); }
    else if (e.key === 'ArrowDown') {
      _selectedIndex = Math.min(_selectedIndex + 1, _filteredCommands.length - 1);
      renderResults();
      e.preventDefault();
    }
    else if (e.key === 'ArrowUp') {
      _selectedIndex = Math.max(_selectedIndex - 1, 0);
      renderResults();
      e.preventDefault();
    }
    else if (e.key === 'Enter') {
      execute(_selectedIndex);
      e.preventDefault();
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  // Subscribe to store
  store.subscribe('ui', (ui) => {
    if (ui.commandPaletteOpen) open();
  });

  // Global shortcut
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
      e.preventDefault();
      if (overlay.classList.contains('hidden')) {
        actions.openCommandPalette();
      } else {
        close();
      }
    }
  });
}

/**
 * Register a dynamic command.
 */
export function registerCommand(label, category, action) {
  _commands.push({ label, category, action });
}
