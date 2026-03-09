const simpleGit = require('simple-git');
const path = require('node:path');
const fs = require('node:fs');
const logger = require('./logger').create('gitService');

/**
 * Git operations wrapper using simple-git.
 * All methods take a repoPath (the root repo or worktree path).
 */
class GitService {
  /**
   * Get a simple-git instance for a path.
   */
  _git(repoPath) {
    return simpleGit(repoPath);
  }

  /**
   * Check if a path is inside a git repository.
   */
  async isGitRepo(repoPath) {
    try {
      return await this._git(repoPath).checkIsRepo();
    } catch {
      return false;
    }
  }

  /**
   * List all worktrees for a repository.
   * Returns: [{ path, branch, isMain, head }]
   */
  async listWorktrees(repoPath) {
    try {
      const git = this._git(repoPath);
      // git worktree list --porcelain
      const raw = await git.raw(['worktree', 'list', '--porcelain']);
      return this._parseWorktreeList(raw);
    } catch (err) {
      logger.error('Failed to list worktrees', { repoPath, error: err.message });
      return [];
    }
  }

  /**
   * Parse `git worktree list --porcelain` output.
   */
  _parseWorktreeList(raw) {
    const worktrees = [];
    const blocks = raw.trim().split('\n\n');

    for (const block of blocks) {
      if (!block.trim()) continue;
      const lines = block.trim().split('\n');
      const wt = { path: '', branch: '', isMain: false, head: '', bare: false };

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          wt.path = line.substring(9).trim();
        } else if (line.startsWith('HEAD ')) {
          wt.head = line.substring(5).trim();
        } else if (line.startsWith('branch ')) {
          // refs/heads/main -> main
          const ref = line.substring(7).trim();
          wt.branch = ref.replace('refs/heads/', '');
        } else if (line === 'bare') {
          wt.bare = true;
        } else if (line === 'detached') {
          wt.branch = '(detached)';
        }
      }

      if (wt.path) {
        worktrees.push(wt);
      }
    }

    // First worktree is the main one
    if (worktrees.length > 0) {
      worktrees[0].isMain = true;
    }

    return worktrees;
  }

  /**
   * Create a new worktree.
   * @param {string} repoPath - Root repo path
   * @param {string} branchName - Branch to create
   * @param {string} [baseBranch='main'] - Base branch to create from
   * @returns {{ ok: boolean, path?: string, error?: string }}
   */
  async createWorktree(repoPath, branchName, baseBranch = 'main') {
    try {
      const git = this._git(repoPath);

      // Determine worktree location: sibling to repo in .worktrees dir
      // Or use repo/.claude-count/worktrees/
      const wtDir = path.join(repoPath, '..', `${path.basename(repoPath)}-worktrees`);
      if (!fs.existsSync(wtDir)) {
        fs.mkdirSync(wtDir, { recursive: true });
      }

      const safeName = branchName.replace(/[^a-zA-Z0-9_-]/g, '-');
      const wtPath = path.join(wtDir, safeName);

      if (fs.existsSync(wtPath)) {
        return { ok: false, error: `Worktree path already exists: ${wtPath}` };
      }

      // git worktree add -b <branch> <path> <base>
      await git.raw(['worktree', 'add', '-b', branchName, wtPath, baseBranch]);
      logger.info('Worktree created', { repoPath, branchName, wtPath });
      return { ok: true, path: wtPath };
    } catch (err) {
      logger.error('Failed to create worktree', { repoPath, branchName, error: err.message });
      return { ok: false, error: err.message };
    }
  }

  /**
   * Remove a worktree.
   */
  async removeWorktree(repoPath, wtPath) {
    try {
      const git = this._git(repoPath);
      await git.raw(['worktree', 'remove', wtPath, '--force']);
      logger.info('Worktree removed', { repoPath, wtPath });
      return { ok: true };
    } catch (err) {
      logger.error('Failed to remove worktree', { repoPath, wtPath, error: err.message });
      return { ok: false, error: err.message };
    }
  }

  /**
   * Get ahead/behind counts relative to a base branch.
   */
  async getBranchDiff(repoPath, branch, baseBranch = 'main') {
    try {
      const git = this._git(repoPath);
      const raw = await git.raw(['rev-list', '--left-right', '--count', `${baseBranch}...${branch}`]);
      const parts = raw.trim().split(/\s+/);
      return {
        behind: parseInt(parts[0], 10) || 0,
        ahead: parseInt(parts[1], 10) || 0,
      };
    } catch {
      return { behind: 0, ahead: 0 };
    }
  }

  /**
   * Get git status for a worktree path.
   */
  async getStatus(wtPath) {
    try {
      const git = this._git(wtPath);
      const status = await git.status();
      return {
        branch: status.current,
        tracking: status.tracking,
        ahead: status.ahead,
        behind: status.behind,
        staged: status.staged,
        modified: status.modified,
        deleted: status.deleted,
        not_added: status.not_added,
        conflicted: status.conflicted,
        created: status.created,
        renamed: status.renamed,
        files: status.files.map(f => ({
          path: f.path,
          index: f.index,
          working_dir: f.working_dir,
        })),
      };
    } catch (err) {
      logger.error('Failed to get status', { wtPath, error: err.message });
      return null;
    }
  }

  /**
   * Get diff for a worktree.
   * @param {string} wtPath
   * @param {boolean} staged - If true, show staged diff; otherwise working tree diff
   */
  async getDiff(wtPath, staged = false) {
    try {
      const git = this._git(wtPath);
      if (staged) {
        return await git.diff(['--cached']);
      }
      return await git.diff();
    } catch (err) {
      logger.error('Failed to get diff', { wtPath, error: err.message });
      return '';
    }
  }

  /**
   * Stage files.
   */
  async stage(wtPath, files) {
    try {
      const git = this._git(wtPath);
      await git.add(files);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Unstage files.
   */
  async unstage(wtPath, files) {
    try {
      const git = this._git(wtPath);
      await git.reset(['HEAD', '--', ...files]);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Commit with message.
   */
  async commit(wtPath, message) {
    try {
      const git = this._git(wtPath);
      const result = await git.commit(message);
      return { ok: true, hash: result.commit, summary: result.summary };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Push current branch.
   */
  async push(wtPath) {
    try {
      const git = this._git(wtPath);
      await git.push();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Get recent commit log.
   */
  async getLog(wtPath, maxCount = 20) {
    try {
      const git = this._git(wtPath);
      const log = await git.log({ maxCount });
      return log.all.map(c => ({
        hash: c.hash,
        date: c.date,
        message: c.message,
        author: c.author_name,
      }));
    } catch (err) {
      return [];
    }
  }

  /**
   * Get the main/default branch name for a repo.
   */
  async getDefaultBranch(repoPath) {
    try {
      const git = this._git(repoPath);
      // Try to find main or master
      const branches = await git.branchLocal();
      if (branches.all.includes('main')) return 'main';
      if (branches.all.includes('master')) return 'master';
      return branches.current || 'main';
    } catch {
      return 'main';
    }
  }
}

module.exports = new GitService();
