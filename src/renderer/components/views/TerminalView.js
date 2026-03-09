import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import store from '../../state/store';
import * as actions from '../../state/actions';

const api = window.api;

let _container = null;
let _unsubs = [];
let _terminals = new Map(); // terminalId -> { term, fitAddon, el }
let _outputUnsub = null;
let _exitUnsub = null;
let _resizeObserver = null;

const XTERM_THEME = {
  background: '#0d1117',
  foreground: '#c9d1d9',
  cursor: '#58a6ff',
  cursorAccent: '#0d1117',
  selectionBackground: '#264f78',
  black: '#484f58',
  red: '#ff7b72',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39d353',
  white: '#b1bac4',
  brightBlack: '#6e7681',
  brightRed: '#ffa198',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d364',
  brightWhite: '#f0f6fc',
};

export const TerminalView = {
  create(container) {
    _container = container;
    _container.className = 'view-terminal';

    // Build layout
    _container.innerHTML = `
      <div class="terminal-tabs" id="terminal-tab-bar">
        <!-- Tabs rendered dynamically -->
      </div>
      <div class="terminal-panes" id="terminal-panes">
        <!-- Terminal panes rendered here -->
      </div>
    `;

    // Listen to terminal output from main process
    _outputUnsub = api.onTerminalOutput((data) => {
      const entry = _terminals.get(data.id);
      if (entry && entry.term) {
        entry.term.write(data.data);
      }
    });

    _exitUnsub = api.onTerminalExited((data) => {
      const entry = _terminals.get(data.id);
      if (entry && entry.term) {
        entry.term.write('\r\n\x1b[90m[Process exited with code ' + data.exitCode + ']\x1b[0m\r\n');
      }
    });

    // Resize observer for fitting terminals
    _resizeObserver = new ResizeObserver(() => {
      for (const [, entry] of _terminals) {
        if (entry.fitAddon && entry.el.offsetParent !== null) {
          try { entry.fitAddon.fit(); } catch { /* ignore */ }
        }
      }
    });
    _resizeObserver.observe(_container);

    // Subscribe to store changes
    _unsubs.push(store.subscribe('terminals', () => renderTabs()));
    _unsubs.push(store.subscribe('ui', (ui) => {
      renderTabs();
      showActivePane(ui.activeTerminalId);
    }));

    renderTabs();

    // Auto-create initial terminals for any that already exist
    const terminals = store.get('terminals');
    for (const t of terminals) {
      ensureTerminal(t.id);
    }
    showActivePane(store.get('ui').activeTerminalId);
  },

  destroy() {
    _unsubs.forEach(fn => fn());
    _unsubs = [];

    if (_outputUnsub) _outputUnsub();
    if (_exitUnsub) _exitUnsub();
    if (_resizeObserver) _resizeObserver.disconnect();

    // Dispose all xterm instances
    for (const [, entry] of _terminals) {
      entry.term.dispose();
    }
    _terminals.clear();
    _container = null;
  },
};

function renderTabs() {
  if (!_container) return;
  const tabBar = _container.querySelector('#terminal-tab-bar');
  const terminals = store.get('terminals');
  const activeId = store.get('ui').activeTerminalId;

  tabBar.innerHTML = terminals.map(t => {
    const agent = t.agentId ? store.get('agents').find(a => a.id === t.agentId) : null;
    const hasAttention = agent && (agent.status === 'waiting_input' || agent.status === 'waiting_permission');

    return `
      <div class="terminal-tab ${t.id === activeId ? 'active' : ''} ${hasAttention ? 'attention' : ''}" data-id="${t.id}">
        <span class="tab-label">${escHtml(t.label)}</span>
        <button class="tab-close" data-id="${t.id}">&times;</button>
      </div>
    `;
  }).join('') + `
    <button class="terminal-tab-add" id="btn-add-terminal" title="New Terminal">+</button>
  `;

  // Tab click handlers
  tabBar.querySelectorAll('.terminal-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      if (!e.target.classList.contains('tab-close')) {
        actions.setActiveTerminal(tab.dataset.id);
      }
    });
  });

  tabBar.querySelectorAll('.tab-close').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      actions.closeTerminalTab(btn.dataset.id);
      const entry = _terminals.get(btn.dataset.id);
      if (entry) {
        entry.term.dispose();
        entry.el.remove();
        _terminals.delete(btn.dataset.id);
      }
    });
  });

  tabBar.querySelector('#btn-add-terminal').addEventListener('click', () => {
    const wt = store.get('worktrees').find(w => w.id === store.get('selectedWorktreeId'));
    const project = store.get('projects').find(p => p.id === store.get('selectedProjectId'));
    const cwd = wt ? wt.path : (project ? project.path : process.cwd?.() || '.');
    const label = wt ? wt.branch : 'Terminal';
    actions.openTerminal(cwd, label);
  });
}

function ensureTerminal(terminalId) {
  if (_terminals.has(terminalId)) return;
  if (!_container) return;

  const panes = _container.querySelector('#terminal-panes');
  const el = document.createElement('div');
  el.className = 'terminal-pane';
  el.dataset.id = terminalId;
  el.style.display = 'none';
  panes.appendChild(el);

  const term = new Terminal({
    theme: XTERM_THEME,
    fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
    fontSize: 13,
    lineHeight: 1.3,
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 5000,
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());

  term.open(el);

  // Fit after a frame
  requestAnimationFrame(() => {
    try { fitAddon.fit(); } catch { /* ignore */ }
  });

  // Wire input to PTY
  term.onData((data) => {
    // Check if this is an agent terminal
    const termInfo = store.get('terminals').find(t => t.id === terminalId);
    if (termInfo && termInfo.agentId) {
      api.sendAgentInput(termInfo.agentId, data);
    } else {
      api.writeTerminal(terminalId, data);
    }
  });

  // Report resize
  term.onResize(({ cols, rows }) => {
    api.resizeTerminal(terminalId, cols, rows);
  });

  _terminals.set(terminalId, { term, fitAddon, el });
}

function showActivePane(activeId) {
  if (!_container) return;

  // Ensure the terminal exists
  if (activeId) {
    ensureTerminal(activeId);
  }

  // Show/hide panes
  for (const [id, entry] of _terminals) {
    if (id === activeId) {
      entry.el.style.display = 'block';
      requestAnimationFrame(() => {
        try { entry.fitAddon.fit(); } catch { /* ignore */ }
        entry.term.focus();
      });
    } else {
      entry.el.style.display = 'none';
    }
  }

  // Show empty state if no terminals
  const panes = _container?.querySelector('#terminal-panes');
  if (panes) {
    const hasVisible = activeId && _terminals.has(activeId);
    let empty = panes.querySelector('.terminal-empty');
    if (!hasVisible) {
      if (!empty) {
        empty = document.createElement('div');
        empty.className = 'terminal-empty';
        empty.innerHTML = '<p>No terminals open</p><p class="hint">Click + to open a terminal, or launch an agent</p>';
        panes.appendChild(empty);
      }
      empty.style.display = 'flex';
    } else {
      if (empty) empty.style.display = 'none';
    }
  }
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
