const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, dialog } = require('electron');
const logger = require('./logger');

const log = logger.create ? logger.create('projectRegistry') : logger;

const PROJECTS_FILE = 'projects.json';

class ProjectRegistry {
  constructor() {
    this._filePath = null;
    this._data = { version: 1, projects: [] };
  }

  /**
   * Load projects from disk or create default file.
   * Must be called after app.whenReady().
   */
  init() {
    const dir = app.getPath('userData');
    this._filePath = path.join(dir, PROJECTS_FILE);

    try {
      if (fs.existsSync(this._filePath)) {
        const raw = fs.readFileSync(this._filePath, 'utf-8');
        const data = JSON.parse(raw);
        if (data && Array.isArray(data.projects)) {
          this._data = data;
          log.info('Loaded project registry', { count: data.projects.length });
          return;
        }
      }
    } catch (err) {
      log.warn('Failed to read projects file, resetting to empty', { message: err.message });
    }

    this._data = { version: 1, projects: [] };
    this._persist();
    log.info('Created new project registry');
  }

  /** Returns all projects. */
  getAll() {
    return this._data.projects;
  }

  /** Returns only enabled projects. */
  getEnabled() {
    return this._data.projects.filter((p) => p.enabled);
  }

  /** Returns a project by its id, or null. */
  getById(id) {
    return this._data.projects.find((p) => p.id === id) || null;
  }

  /**
   * Add a new project.
   * @returns {{ ok: boolean, project?: object, error?: string }}
   */
  add(name, projectPath) {
    if (!name || typeof name !== 'string' || !name.trim()) {
      return { ok: false, error: 'Name is required' };
    }
    if (!projectPath || typeof projectPath !== 'string' || !projectPath.trim()) {
      return { ok: false, error: 'Path is required' };
    }

    const resolved = path.resolve(projectPath.trim());

    if (!fs.existsSync(resolved)) {
      return { ok: false, error: 'Path does not exist' };
    }

    // Duplicate detection (case-insensitive on Windows)
    const normalised = resolved.toLowerCase();
    const duplicate = this._data.projects.find(
      (p) => path.resolve(p.path).toLowerCase() === normalised
    );
    if (duplicate) {
      return { ok: false, error: `Path already registered as "${duplicate.name}"` };
    }

    const project = {
      id: crypto.randomUUID(),
      name: name.trim(),
      path: resolved,
      enabled: true,
      addedAt: new Date().toISOString(),
    };

    this._data.projects.push(project);
    this._persist();
    log.info('Project added', { id: project.id, name: project.name });
    return { ok: true, project };
  }

  /**
   * Remove a project by id.
   * @returns {{ ok: boolean, error?: string }}
   */
  remove(id) {
    const idx = this._data.projects.findIndex((p) => p.id === id);
    if (idx === -1) {
      return { ok: false, error: 'Project not found' };
    }
    const removed = this._data.projects.splice(idx, 1)[0];
    this._persist();
    log.info('Project removed', { id: removed.id, name: removed.name });
    return { ok: true };
  }

  /**
   * Update a project by id with partial changes.
   * Allowed fields: name, path, enabled.
   * @returns {{ ok: boolean, project?: object, error?: string }}
   */
  update(id, changes) {
    const project = this._data.projects.find((p) => p.id === id);
    if (!project) {
      return { ok: false, error: 'Project not found' };
    }

    if (changes.name !== undefined) {
      const n = String(changes.name).trim();
      if (!n) return { ok: false, error: 'Name cannot be empty' };
      project.name = n;
    }

    if (changes.path !== undefined) {
      const resolved = path.resolve(String(changes.path).trim());
      if (!fs.existsSync(resolved)) {
        return { ok: false, error: 'Path does not exist' };
      }
      // Check duplicate (excluding self)
      const normalised = resolved.toLowerCase();
      const duplicate = this._data.projects.find(
        (p) => p.id !== id && path.resolve(p.path).toLowerCase() === normalised
      );
      if (duplicate) {
        return { ok: false, error: `Path already registered as "${duplicate.name}"` };
      }
      project.path = resolved;
    }

    if (changes.enabled !== undefined) {
      project.enabled = Boolean(changes.enabled);
    }

    this._persist();
    log.info('Project updated', { id: project.id });
    return { ok: true, project };
  }

  /**
   * Open a folder picker dialog and return the selected path.
   * @param {BrowserWindow} parentWindow
   * @returns {Promise<string|null>}
   */
  async browseForPath(parentWindow) {
    // Default to Z:\Development if it exists, otherwise home
    const defaultPath = require('node:fs').existsSync('Z:\\Development')
      ? 'Z:\\Development'
      : require('node:os').homedir();

    const result = await dialog.showOpenDialog(parentWindow, {
      title: 'Select Project Folder',
      defaultPath,
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths.length) {
      return null;
    }
    return result.filePaths[0];
  }

  _persist() {
    try {
      const dir = path.dirname(this._filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this._filePath, JSON.stringify(this._data, null, 2), 'utf-8');
    } catch (err) {
      log.error('Failed to persist projects', { message: err.message });
    }
  }
}

module.exports = ProjectRegistry;
