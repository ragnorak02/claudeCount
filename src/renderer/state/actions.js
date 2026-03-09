import store from './store';

const api = window.api;

// ==================== Projects ====================

export async function loadProjects() {
  const projects = await api.listProjects();
  store.set('projects', projects);
  return projects;
}

export async function addProject(name, path) {
  const result = await api.addProject(name, path);
  if (result.ok) {
    await loadProjects();
  }
  return result;
}

export async function removeProject(id) {
  const result = await api.removeProject(id);
  if (result.ok) {
    await loadProjects();
    // Remove worktrees for this project
    store.set('worktrees', (prev) => prev.filter(wt => wt.projectId !== id));
    if (store.get('selectedProjectId') === id) {
      store.set('selectedProjectId', null);
    }
  }
  return result;
}

export function selectProject(projectId) {
  store.set('selectedProjectId', projectId);
}

// ==================== Worktrees ====================

export async function loadWorktrees(projectId) {
  const worktrees = await api.listWorktrees(projectId);
  // Merge into the flat all-projects worktree list
  store.set('worktrees', (prev) => {
    const filtered = prev.filter(wt => wt.projectId !== projectId);
    return [...filtered, ...worktrees];
  });
  return worktrees;
}

/**
 * Load worktrees for ALL registered projects.
 */
export async function loadAllWorktrees() {
  const projects = store.get('projects');
  const allWorktrees = [];
  for (const p of projects) {
    try {
      const wts = await api.listWorktrees(p.id);
      allWorktrees.push(...wts);
    } catch (err) {
      console.warn(`Failed to load worktrees for ${p.name}:`, err);
    }
  }
  store.set('worktrees', allWorktrees);
  return allWorktrees;
}

export async function createWorktree(projectId, branchName, baseBranch) {
  const result = await api.createWorktree(projectId, branchName, baseBranch);
  if (result.ok) {
    await loadWorktrees(projectId);
  }
  return result;
}

export async function removeWorktree(projectId, worktreeId) {
  const result = await api.removeWorktree(projectId, worktreeId);
  if (result.ok) {
    await loadWorktrees(projectId);
  }
  return result;
}

export function selectWorktree(worktreeId) {
  store.set('selectedWorktreeId', worktreeId);
}

// ==================== Agents ====================

export async function loadAgents() {
  const agents = await api.listAgents();
  store.set('agents', agents);
  return agents;
}

export async function launchAgent(opts) {
  const result = await api.launchAgent(opts);
  if (result.ok) {
    await loadAgents();
    // Add terminal tab
    addTerminalTab(result.terminalId, 'agent', opts.agentType, result.agentId);
  }
  return result;
}

export async function terminateAgent(agentId) {
  const result = await api.terminateAgent(agentId);
  if (result.ok) {
    await loadAgents();
  }
  return result;
}

export async function sendAgentInput(agentId, text) {
  return api.sendAgentInput(agentId, text);
}

// ==================== Terminals ====================

export async function openTerminal(cwd, label) {
  const result = await api.createTerminal({
    cwd,
    type: 'terminal',
  });
  if (result.ok) {
    addTerminalTab(result.id, 'terminal', label || 'Terminal');
  }
  return result;
}

export function addTerminalTab(terminalId, type, label, agentId) {
  store.set('terminals', (prev) => [
    ...prev,
    { id: terminalId, type, label: label || 'Terminal', agentId: agentId || null },
  ]);
  store.merge('ui', { activeTerminalId: terminalId });
}

export function closeTerminalTab(terminalId) {
  api.closeTerminal(terminalId);
  store.set('terminals', (prev) => prev.filter(t => t.id !== terminalId));

  // Switch to next tab
  const remaining = store.get('terminals');
  if (remaining.length > 0) {
    store.merge('ui', { activeTerminalId: remaining[remaining.length - 1].id });
  } else {
    store.merge('ui', { activeTerminalId: null });
  }
}

export function setActiveTerminal(terminalId) {
  store.merge('ui', { activeTerminalId: terminalId });
}

// ==================== Tasks ====================

export async function loadTasks(projectId) {
  const tasks = await api.listTasks(projectId);
  store.set('tasks', tasks);
  return tasks;
}

export async function createTask(data) {
  const result = await api.createTask(data);
  if (result.ok) {
    const projectId = store.get('selectedProjectId');
    await loadTasks(projectId);
  }
  return result;
}

export async function updateTask(taskId, changes) {
  const result = await api.updateTask(taskId, changes);
  if (result.ok) {
    const projectId = store.get('selectedProjectId');
    await loadTasks(projectId);
  }
  return result;
}

export async function deleteTask(taskId) {
  const result = await api.deleteTask(taskId);
  if (result.ok) {
    const projectId = store.get('selectedProjectId');
    await loadTasks(projectId);
  }
  return result;
}

// ==================== UI ====================

export function setView(view) {
  store.merge('ui', { currentView: view });
}

export function toggleSidebar() {
  const ui = store.get('ui');
  store.merge('ui', { sidebarCollapsed: !ui.sidebarCollapsed });
}

export function openCommandPalette() {
  store.merge('ui', { commandPaletteOpen: true });
}

export function closeCommandPalette() {
  store.merge('ui', { commandPaletteOpen: false });
}

export function setSplit(mode) {
  store.merge('ui', { terminalSplit: mode });
}

// ==================== App ====================

export async function takeScreenshot() {
  return api.screenshot();
}

export async function getDebugLog() {
  return api.getDebugLog();
}

export async function browseProjectPath() {
  return api.browseProjectPath();
}
