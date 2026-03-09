const { contextBridge, ipcRenderer } = require('electron');

// Helper to create a listener that returns an unsubscribe function
function onEvent(channel, callback) {
  const listener = (_event, data) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('api', {
  // --- Projects ---
  listProjects: () => ipcRenderer.invoke('project:list'),
  addProject: (name, path) => ipcRenderer.invoke('project:add', name, path),
  removeProject: (id) => ipcRenderer.invoke('project:remove', id),
  updateProject: (id, changes) => ipcRenderer.invoke('project:update', id, changes),
  browseProjectPath: () => ipcRenderer.invoke('project:browse'),

  // --- Worktrees ---
  listWorktrees: (projectId) => ipcRenderer.invoke('worktree:list', projectId),
  createWorktree: (projectId, branchName, baseBranch) =>
    ipcRenderer.invoke('worktree:create', projectId, branchName, baseBranch),
  removeWorktree: (projectId, worktreeId) =>
    ipcRenderer.invoke('worktree:remove', projectId, worktreeId),
  refreshWorktrees: (projectId) => ipcRenderer.invoke('worktree:refresh', projectId),

  // --- Git ---
  gitStatus: (wtPath) => ipcRenderer.invoke('git:status', wtPath),
  gitDiff: (wtPath, staged) => ipcRenderer.invoke('git:diff', wtPath, staged),
  gitStage: (wtPath, files) => ipcRenderer.invoke('git:stage', wtPath, files),
  gitUnstage: (wtPath, files) => ipcRenderer.invoke('git:unstage', wtPath, files),
  gitCommit: (wtPath, message) => ipcRenderer.invoke('git:commit', wtPath, message),
  gitPush: (wtPath) => ipcRenderer.invoke('git:push', wtPath),
  gitLog: (wtPath, maxCount) => ipcRenderer.invoke('git:log', wtPath, maxCount),
  gitBranchDiff: (repoPath, branch, baseBranch) =>
    ipcRenderer.invoke('git:branch-diff', repoPath, branch, baseBranch),

  // --- Agents ---
  launchAgent: (opts) => ipcRenderer.invoke('agent:launch', opts),
  terminateAgent: (agentId) => ipcRenderer.invoke('agent:terminate', agentId),
  sendAgentInput: (agentId, text) => ipcRenderer.invoke('agent:send-input', agentId, text),
  listAgents: () => ipcRenderer.invoke('agent:list'),
  getAgentBuffer: (terminalId) => ipcRenderer.invoke('agent:get-buffer', terminalId),
  resizeAgent: (terminalId, cols, rows) =>
    ipcRenderer.invoke('agent:resize', terminalId, cols, rows),

  // --- Terminals ---
  createTerminal: (opts) => ipcRenderer.invoke('terminal:create', opts),
  writeTerminal: (id, data) => ipcRenderer.invoke('terminal:write', id, data),
  resizeTerminal: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
  closeTerminal: (id) => ipcRenderer.invoke('terminal:close', id),

  // --- Tasks ---
  listTasks: (projectId) => ipcRenderer.invoke('task:list', projectId),
  createTask: (data) => ipcRenderer.invoke('task:create', data),
  updateTask: (taskId, changes) => ipcRenderer.invoke('task:update', taskId, changes),
  deleteTask: (taskId) => ipcRenderer.invoke('task:delete', taskId),
  assignTask: (taskId, agentId) => ipcRenderer.invoke('task:assign', taskId, agentId),

  // --- App ---
  getEnv: () => ipcRenderer.invoke('app:get-env'),
  getDebugLog: () => ipcRenderer.invoke('app:get-debug-log'),
  screenshot: () => ipcRenderer.invoke('app:screenshot'),

  // --- Events (push from main) ---
  onTerminalOutput: (cb) => onEvent('terminal:output', cb),
  onTerminalExited: (cb) => onEvent('terminal:exited', cb),
  onAgentUpdated: (cb) => onEvent('agent:updated', cb),
  onAgentNotification: (cb) => onEvent('agent:notification', cb),
  onAgentExited: (cb) => onEvent('agent:exited', cb),
});
