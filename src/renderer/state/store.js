/**
 * Simple observable store — no framework needed.
 * Components subscribe to sections and get notified on changes.
 */
class Store {
  constructor() {
    this._state = {
      // Projects
      projects: [],
      selectedProjectId: null,

      // Worktrees (for selected project)
      worktrees: [],
      selectedWorktreeId: null,

      // Agents
      agents: [],

      // Tasks
      tasks: [],

      // Terminals
      terminals: [], // { id, type, label, agentId? }

      // UI state
      ui: {
        currentView: 'board',       // 'terminal' | 'board' | 'list' | 'grid'
        sidebarCollapsed: false,
        sidebarWidth: 280,
        commandPaletteOpen: false,
        activeTerminalId: null,
        terminalSplit: null,         // null | 'horizontal' | 'vertical'
        splitTerminalIds: [],
      },
    };

    this._listeners = new Map(); // section -> Set<callback>
  }

  /**
   * Get current state for a section.
   */
  get(section) {
    return this._state[section];
  }

  /**
   * Get full state.
   */
  getAll() {
    return this._state;
  }

  /**
   * Set state for a section.
   * @param {string} section
   * @param {*} valueOrUpdater - value or function(prev) => newValue
   */
  set(section, valueOrUpdater) {
    const prev = this._state[section];
    const next = typeof valueOrUpdater === 'function'
      ? valueOrUpdater(prev)
      : valueOrUpdater;

    this._state[section] = next;
    this._notify(section, next, prev);
  }

  /**
   * Merge partial state into a section (for objects like `ui`).
   */
  merge(section, partial) {
    const prev = this._state[section];
    const next = { ...prev, ...partial };
    this._state[section] = next;
    this._notify(section, next, prev);
  }

  /**
   * Subscribe to a section.
   * @returns {Function} unsubscribe
   */
  subscribe(section, callback) {
    if (!this._listeners.has(section)) {
      this._listeners.set(section, new Set());
    }
    this._listeners.get(section).add(callback);
    return () => this._listeners.get(section)?.delete(callback);
  }

  _notify(section, next, prev) {
    const listeners = this._listeners.get(section);
    if (!listeners) return;
    for (const cb of listeners) {
      try { cb(next, prev); } catch (err) { console.error('Store listener error:', err); }
    }
  }
}

// Singleton
const store = new Store();
export default store;
