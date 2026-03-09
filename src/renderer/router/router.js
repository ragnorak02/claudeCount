import store from '../state/store';

/**
 * Simple view router — manages which view is mounted in the content area.
 */
class Router {
  constructor() {
    this._views = new Map(); // name -> { create, mount, unmount }
    this._currentView = null;
    this._container = null;
  }

  /**
   * Initialize with the content container element.
   */
  init(container) {
    this._container = container;

    // Subscribe to view changes
    store.subscribe('ui', (ui) => {
      if (ui.currentView !== this._currentView) {
        this.navigate(ui.currentView);
      }
    });
  }

  /**
   * Register a view.
   * @param {string} name
   * @param {object} view - { create(container), destroy() }
   */
  register(name, view) {
    this._views.set(name, view);
  }

  /**
   * Navigate to a view.
   */
  navigate(name) {
    if (!this._container) return;
    if (!this._views.has(name)) {
      console.warn(`View "${name}" not registered`);
      return;
    }

    // Unmount current
    if (this._currentView && this._views.has(this._currentView)) {
      const current = this._views.get(this._currentView);
      if (current.destroy) {
        try { current.destroy(); } catch (err) { console.error('View destroy error:', err); }
      }
    }

    // Clear container
    this._container.innerHTML = '';

    // Mount new
    this._currentView = name;
    const view = this._views.get(name);
    if (view.create) {
      view.create(this._container);
    }
  }

  /**
   * Get current view name.
   */
  getCurrent() {
    return this._currentView;
  }
}

const router = new Router();
export default router;
