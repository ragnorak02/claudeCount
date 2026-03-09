/**
 * Claude Count — Renderer Entry Point
 * Wires store, router, components, and IPC event listeners.
 */
import '../styles/global.css';
import 'xterm/css/xterm.css';

import store from './state/store';
import * as actions from './state/actions';
import router from './router/router';

// Components
import { createSidebar } from './components/layout/Sidebar';
import { createTabBar } from './components/layout/TabBar';
import { initCommandPalette } from './components/common/CommandPalette';
import { initAgentLauncher } from './components/agents/AgentLauncher';
import { initDebugPanel } from './components/agents/DebugPanel';
import { showToast } from './components/common/Toast';
import { showModal } from './components/common/Modal';

// Views
import { BoardView } from './components/views/BoardView';
import { ListView } from './components/views/ListView';
import { GridView } from './components/views/GridView';
import { TerminalView } from './components/views/TerminalView';

const api = window.api;

// ==================== Initialize ====================

async function init() {
  // 1. Register views with router
  router.register('board', BoardView);
  router.register('list', ListView);
  router.register('grid', GridView);
  router.register('terminal', TerminalView);

  // 2. Initialize router with content container
  const content = document.getElementById('content');
  router.init(content);

  // 3. Initialize layout components
  createSidebar();
  createTabBar();
  initCommandPalette();
  initAgentLauncher();
  initDebugPanel();

  // 4. Wire topbar buttons
  document.getElementById('btn-screenshot').addEventListener('click', async () => {
    const result = await actions.takeScreenshot();
    if (result.ok) {
      showToast(`Screenshot saved: ${result.filePath}`, 'success');
    } else {
      showToast('Screenshot failed', 'error');
    }
  });

  document.getElementById('btn-command-palette').addEventListener('click', () => {
    actions.openCommandPalette();
  });

  // 5. Wire IPC event listeners
  api.onAgentUpdated((data) => {
    // Refresh agents list in store
    actions.loadAgents();
  });

  api.onAgentNotification((data) => {
    const typeMap = {
      done: 'success',
      error: 'error',
      attention: 'attention',
    };
    showToast(data.message || 'Agent needs attention', typeMap[data.type] || 'info');
  });

  api.onAgentExited((data) => {
    actions.loadAgents();
  });

  // 6. Worktree creation modal listener
  window.addEventListener('show-create-worktree', (e) => {
    const projectId = e.detail?.projectId || store.get('selectedProjectId');
    showCreateWorktreeModal(projectId);
  });

  // 7. Load initial data
  await actions.loadProjects();

  // Load worktrees for ALL projects
  await actions.loadAllWorktrees();

  // Auto-select first project if available
  const projects = store.get('projects');
  if (projects.length > 0) {
    actions.selectProject(projects[0].id);
  }

  // Load agents and tasks
  await actions.loadAgents();
  const projectId = store.get('selectedProjectId');
  if (projectId) {
    await actions.loadTasks(projectId);
  }

  // 8. Navigate to default view
  router.navigate('board');

  console.log('[ClaudeCount] Initialized');
}

// ==================== Worktree Creation Modal ====================

function showCreateWorktreeModal(projectId) {
  if (!projectId) {
    projectId = store.get('selectedProjectId');
  }
  if (!projectId) {
    showToast('Select a project first', 'warning');
    return;
  }

  const form = document.createElement('div');
  form.innerHTML = `
    <div class="form-group">
      <label>Branch Name</label>
      <input type="text" id="wt-branch" class="form-input" placeholder="feature/my-feature" />
    </div>
    <div class="form-group">
      <label>Base Branch</label>
      <input type="text" id="wt-base" class="form-input" value="main" />
    </div>
    <div class="form-actions">
      <button id="wt-create-btn" class="btn btn-primary">Create Worktree</button>
    </div>
  `;

  const modal = showModal({ title: 'New Worktree', content: form, width: '400px' });

  form.querySelector('#wt-create-btn').addEventListener('click', async () => {
    const branch = form.querySelector('#wt-branch').value.trim();
    const base = form.querySelector('#wt-base').value.trim() || 'main';
    if (!branch) return;

    const result = await actions.createWorktree(projectId, branch, base);
    if (result.ok) {
      modal.close();
      showToast(`Worktree "${branch}" created`, 'success');
    } else {
      showToast(result.error || 'Failed to create worktree', 'error');
    }
  });

  // Focus input
  setTimeout(() => form.querySelector('#wt-branch').focus(), 100);
}

// ==================== Boot ====================

document.addEventListener('DOMContentLoaded', () => {
  init().catch(err => {
    console.error('[ClaudeCount] Init failed:', err);
  });
});
