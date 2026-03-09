const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app } = require('electron');
const logger = require('./logger').create('taskManager');

/**
 * Kanban task persistence and management.
 */
class TaskManager {
  constructor() {
    this._filePath = null;
    this._tasks = [];
  }

  init() {
    const dir = app.getPath('userData');
    this._filePath = path.join(dir, 'tasks.json');
    this._load();
  }

  getAll(projectId) {
    if (projectId) {
      return this._tasks.filter(t => t.projectId === projectId);
    }
    return [...this._tasks];
  }

  getById(taskId) {
    return this._tasks.find(t => t.id === taskId) || null;
  }

  create(data) {
    const task = {
      id: crypto.randomUUID(),
      projectId: data.projectId || null,
      title: data.title || 'Untitled Task',
      description: data.description || '',
      status: 'queued',
      agentId: null,
      worktreeId: null,
      agentType: data.agentType || 'claude',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      parentTaskId: data.parentTaskId || null,
    };
    this._tasks.push(task);
    this._persist();
    return { ok: true, task };
  }

  update(taskId, changes) {
    const task = this._tasks.find(t => t.id === taskId);
    if (!task) return { ok: false, error: 'Task not found' };

    const allowed = ['title', 'description', 'status', 'agentId', 'worktreeId', 'agentType'];
    for (const key of allowed) {
      if (changes[key] !== undefined) {
        task[key] = changes[key];
      }
    }
    task.updatedAt = new Date().toISOString();
    this._persist();
    return { ok: true, task };
  }

  delete(taskId) {
    const idx = this._tasks.findIndex(t => t.id === taskId);
    if (idx === -1) return { ok: false, error: 'Task not found' };
    this._tasks.splice(idx, 1);
    this._persist();
    return { ok: true };
  }

  assignAgent(taskId, agentId) {
    const task = this._tasks.find(t => t.id === taskId);
    if (!task) return { ok: false, error: 'Task not found' };
    task.agentId = agentId;
    task.status = 'in_progress';
    task.updatedAt = new Date().toISOString();
    this._persist();
    return { ok: true, task };
  }

  _load() {
    try {
      if (fs.existsSync(this._filePath)) {
        const raw = fs.readFileSync(this._filePath, 'utf-8');
        const data = JSON.parse(raw);
        if (Array.isArray(data.tasks)) {
          this._tasks = data.tasks;
          logger.info('Loaded tasks', { count: this._tasks.length });
          return;
        }
      }
    } catch (err) {
      logger.warn('Failed to load tasks', { error: err.message });
    }
    this._tasks = [];
  }

  _persist() {
    try {
      const dir = path.dirname(this._filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this._filePath, JSON.stringify({ version: 1, tasks: this._tasks }, null, 2), 'utf-8');
    } catch (err) {
      logger.error('Failed to persist tasks', { error: err.message });
    }
  }
}

module.exports = new TaskManager();
