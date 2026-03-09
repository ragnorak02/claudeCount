const crypto = require('node:crypto');
const gitService = require('./gitService');
const logger = require('./logger').create('worktreeManager');

/**
 * Manages worktree state for all registered projects.
 * Wraps gitService with caching and ID assignment.
 */
class WorktreeManager {
  constructor() {
    // projectId -> { worktrees: Map<worktreeId, worktreeData>, defaultBranch: string }
    this._cache = new Map();
  }

  /**
   * Refresh worktrees for a project.
   * @param {object} project - { id, name, path }
   * @returns {Array} worktree list
   */
  async refreshWorktrees(project) {
    const gitWorktrees = await gitService.listWorktrees(project.path);
    const defaultBranch = await gitService.getDefaultBranch(project.path);

    const wtMap = new Map();
    const results = [];

    for (const gw of gitWorktrees) {
      // Generate stable ID from path
      const id = this._worktreeId(project.id, gw.path);

      // Get ahead/behind vs main
      let ahead = 0, behind = 0;
      if (!gw.isMain && gw.branch && gw.branch !== '(detached)') {
        try {
          const diff = await gitService.getBranchDiff(project.path, gw.branch, defaultBranch);
          ahead = diff.ahead;
          behind = diff.behind;
        } catch { /* ignore */ }
      }

      const wt = {
        id,
        projectId: project.id,
        path: gw.path,
        branch: gw.branch,
        isMain: gw.isMain,
        head: gw.head,
        commitsAhead: ahead,
        commitsBehind: behind,
        agents: [], // filled by agentManager
      };

      wtMap.set(id, wt);
      results.push(wt);
    }

    this._cache.set(project.id, { worktrees: wtMap, defaultBranch });
    return results;
  }

  /**
   * Get cached worktrees for a project (call refreshWorktrees first).
   */
  getWorktrees(projectId) {
    const entry = this._cache.get(projectId);
    if (!entry) return [];
    return Array.from(entry.worktrees.values());
  }

  /**
   * Get a worktree by ID.
   */
  getWorktreeById(worktreeId) {
    for (const [, entry] of this._cache) {
      const wt = entry.worktrees.get(worktreeId);
      if (wt) return wt;
    }
    return null;
  }

  /**
   * Find worktree by path.
   */
  getWorktreeByPath(wtPath) {
    const normalized = wtPath.replace(/\\/g, '/').toLowerCase();
    for (const [, entry] of this._cache) {
      for (const [, wt] of entry.worktrees) {
        if (wt.path.replace(/\\/g, '/').toLowerCase() === normalized) {
          return wt;
        }
      }
    }
    return null;
  }

  /**
   * Create a new worktree.
   */
  async createWorktree(project, branchName, baseBranch) {
    const defaultBranch = baseBranch || (this._cache.get(project.id)?.defaultBranch) || 'main';
    const result = await gitService.createWorktree(project.path, branchName, defaultBranch);
    if (result.ok) {
      // Refresh cache
      await this.refreshWorktrees(project);
    }
    return result;
  }

  /**
   * Remove a worktree.
   */
  async removeWorktree(project, worktreeId) {
    const entry = this._cache.get(project.id);
    if (!entry) return { ok: false, error: 'Project not cached' };
    const wt = entry.worktrees.get(worktreeId);
    if (!wt) return { ok: false, error: 'Worktree not found' };
    if (wt.isMain) return { ok: false, error: 'Cannot remove the main worktree' };

    const result = await gitService.removeWorktree(project.path, wt.path);
    if (result.ok) {
      entry.worktrees.delete(worktreeId);
    }
    return result;
  }

  /**
   * Generate a deterministic worktree ID from project + path.
   */
  _worktreeId(projectId, wtPath) {
    const normalized = wtPath.replace(/\\/g, '/').toLowerCase();
    const hash = crypto.createHash('md5').update(`${projectId}:${normalized}`).digest('hex');
    return `wt-${hash.substring(0, 12)}`;
  }
}

module.exports = new WorktreeManager();
