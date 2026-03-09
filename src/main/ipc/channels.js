/**
 * IPC Channel constants — single source of truth for all channel names.
 */
module.exports = {
  // Project
  PROJECT_LIST: 'project:list',
  PROJECT_ADD: 'project:add',
  PROJECT_REMOVE: 'project:remove',
  PROJECT_UPDATE: 'project:update',
  PROJECT_BROWSE: 'project:browse',

  // Worktree
  WORKTREE_LIST: 'worktree:list',
  WORKTREE_CREATE: 'worktree:create',
  WORKTREE_REMOVE: 'worktree:remove',
  WORKTREE_REFRESH: 'worktree:refresh',

  // Git
  GIT_STATUS: 'git:status',
  GIT_DIFF: 'git:diff',
  GIT_STAGE: 'git:stage',
  GIT_UNSTAGE: 'git:unstage',
  GIT_COMMIT: 'git:commit',
  GIT_PUSH: 'git:push',
  GIT_LOG: 'git:log',
  GIT_BRANCH_DIFF: 'git:branch-diff',

  // Agent
  AGENT_LAUNCH: 'agent:launch',
  AGENT_TERMINATE: 'agent:terminate',
  AGENT_SEND_INPUT: 'agent:send-input',
  AGENT_LIST: 'agent:list',
  AGENT_GET_BUFFER: 'agent:get-buffer',
  AGENT_RESIZE: 'agent:resize',
  // Push events (main -> renderer)
  AGENT_UPDATED: 'agent:updated',
  AGENT_OUTPUT: 'agent:output',
  AGENT_NOTIFICATION: 'agent:notification',
  AGENT_EXITED: 'agent:exited',

  // Terminal (raw, non-agent)
  TERMINAL_CREATE: 'terminal:create',
  TERMINAL_WRITE: 'terminal:write',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_CLOSE: 'terminal:close',
  TERMINAL_OUTPUT: 'terminal:output',
  TERMINAL_EXITED: 'terminal:exited',

  // Task / Kanban
  TASK_LIST: 'task:list',
  TASK_CREATE: 'task:create',
  TASK_UPDATE: 'task:update',
  TASK_DELETE: 'task:delete',
  TASK_ASSIGN: 'task:assign',

  // App
  APP_SCREENSHOT: 'app:screenshot',
  APP_GET_DEBUG_LOG: 'app:get-debug-log',
  APP_GET_ENV: 'app:get-env',
  APP_SAVE_STATE: 'app:save-state',
  APP_RESTORE_STATE: 'app:restore-state',
};
