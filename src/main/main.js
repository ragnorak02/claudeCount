const { app, BrowserWindow, ipcMain, dialog, clipboard, desktopCapturer } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const CH = require('./ipc/channels');
const config = require('../services/config');
const logger = require('../services/logger');
const ProjectRegistry = require('../services/projectRegistry');
const gitService = require('../services/gitService');
const worktreeManager = require('../services/worktreeManager');
const ptyService = require('../services/ptyService');
const agentManager = require('../services/agentManager');
const taskManager = require('../services/taskManager');

// --- Global Error Handlers ---
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { message: err.message, stack: err.stack });
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { message: String(reason) });
});

if (require('electron-squirrel-startup')) {
  app.quit();
}

let mainWindow = null;
const projectRegistry = new ProjectRegistry();

// Debug log ring buffer
const debugLog = [];
const MAX_DEBUG_LOG = 500;
function addDebugLog(level, message, data) {
  debugLog.push({ time: Date.now(), level, message, data });
  if (debugLog.length > MAX_DEBUG_LOG) debugLog.shift();
}

// Override logger to capture debug log
const origInfo = logger.info;
const origWarn = logger.warn;
const origError = logger.error;
logger.info = (msg, data) => { addDebugLog('info', msg, data); origInfo(msg, data); };
logger.warn = (msg, data) => { addDebugLog('warn', msg, data); origWarn(msg, data); };
logger.error = (msg, data) => { addDebugLog('error', msg, data); origError(msg, data); };

// --- Helper ---
function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// --- Window Creation ---
const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Claude Count',
    backgroundColor: '#0d1117',
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0d1117',
      symbolColor: '#8b949e',
      height: 38,
    },
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  mainWindow.on('closed', () => { mainWindow = null; });
  logger.info('Main window created (1400x900)');
};

// ==================== IPC HANDLERS ====================

// --- Projects ---
ipcMain.handle(CH.PROJECT_LIST, () => projectRegistry.getAll());
ipcMain.handle(CH.PROJECT_ADD, (_e, name, projectPath) => projectRegistry.add(name, projectPath));
ipcMain.handle(CH.PROJECT_REMOVE, (_e, id) => projectRegistry.remove(id));
ipcMain.handle(CH.PROJECT_UPDATE, (_e, id, changes) => projectRegistry.update(id, changes));
ipcMain.handle(CH.PROJECT_BROWSE, () => projectRegistry.browseForPath(mainWindow));

// --- Worktrees ---
ipcMain.handle(CH.WORKTREE_LIST, async (_e, projectId) => {
  const project = projectRegistry.getById(projectId);
  if (!project) return [];
  return worktreeManager.refreshWorktrees(project);
});

ipcMain.handle(CH.WORKTREE_CREATE, async (_e, projectId, branchName, baseBranch) => {
  const project = projectRegistry.getById(projectId);
  if (!project) return { ok: false, error: 'Project not found' };
  return worktreeManager.createWorktree(project, branchName, baseBranch);
});

ipcMain.handle(CH.WORKTREE_REMOVE, async (_e, projectId, worktreeId) => {
  const project = projectRegistry.getById(projectId);
  if (!project) return { ok: false, error: 'Project not found' };
  return worktreeManager.removeWorktree(project, worktreeId);
});

ipcMain.handle(CH.WORKTREE_REFRESH, async (_e, projectId) => {
  const project = projectRegistry.getById(projectId);
  if (!project) return [];
  return worktreeManager.refreshWorktrees(project);
});

// --- Git ---
ipcMain.handle(CH.GIT_STATUS, async (_e, wtPath) => gitService.getStatus(wtPath));
ipcMain.handle(CH.GIT_DIFF, async (_e, wtPath, staged) => gitService.getDiff(wtPath, staged));
ipcMain.handle(CH.GIT_STAGE, async (_e, wtPath, files) => gitService.stage(wtPath, files));
ipcMain.handle(CH.GIT_UNSTAGE, async (_e, wtPath, files) => gitService.unstage(wtPath, files));
ipcMain.handle(CH.GIT_COMMIT, async (_e, wtPath, message) => gitService.commit(wtPath, message));
ipcMain.handle(CH.GIT_PUSH, async (_e, wtPath) => gitService.push(wtPath));
ipcMain.handle(CH.GIT_LOG, async (_e, wtPath, maxCount) => gitService.getLog(wtPath, maxCount));
ipcMain.handle(CH.GIT_BRANCH_DIFF, async (_e, repoPath, branch, baseBranch) => {
  return gitService.getBranchDiff(repoPath, branch, baseBranch);
});

// --- Agents ---
ipcMain.handle(CH.AGENT_LAUNCH, (_e, opts) => agentManager.launch(opts));
ipcMain.handle(CH.AGENT_TERMINATE, (_e, agentId) => agentManager.terminate(agentId));
ipcMain.handle(CH.AGENT_SEND_INPUT, (_e, agentId, text) => agentManager.sendInput(agentId, text));
ipcMain.handle(CH.AGENT_LIST, () => agentManager.getAll());
ipcMain.handle(CH.AGENT_GET_BUFFER, (_e, terminalId) => ptyService.getBuffer(terminalId));
ipcMain.handle(CH.AGENT_RESIZE, (_e, terminalId, cols, rows) => {
  ptyService.resize(terminalId, cols, rows);
  return { ok: true };
});

// --- Terminals (raw, non-agent) ---
ipcMain.handle(CH.TERMINAL_CREATE, (_e, opts) => ptyService.create(opts));
ipcMain.handle(CH.TERMINAL_WRITE, (_e, id, data) => ptyService.write(id, data));
ipcMain.handle(CH.TERMINAL_RESIZE, (_e, id, cols, rows) => {
  ptyService.resize(id, cols, rows);
  return { ok: true };
});
ipcMain.handle(CH.TERMINAL_CLOSE, (_e, id) => ptyService.close(id));

// --- Tasks ---
ipcMain.handle(CH.TASK_LIST, (_e, projectId) => taskManager.getAll(projectId));
ipcMain.handle(CH.TASK_CREATE, (_e, data) => taskManager.create(data));
ipcMain.handle(CH.TASK_UPDATE, (_e, taskId, changes) => taskManager.update(taskId, changes));
ipcMain.handle(CH.TASK_DELETE, (_e, taskId) => taskManager.delete(taskId));
ipcMain.handle(CH.TASK_ASSIGN, (_e, taskId, agentId) => taskManager.assignAgent(taskId, agentId));

// --- App ---
ipcMain.handle(CH.APP_GET_ENV, () => ({
  platform: process.platform,
  arch: process.arch,
  nodeVersion: process.version,
  electronVersion: process.versions.electron,
  appVersion: config.APP_VERSION,
}));

ipcMain.handle(CH.APP_GET_DEBUG_LOG, () => [...debugLog]);

ipcMain.handle(CH.APP_SCREENSHOT, async () => {
  try {
    const image = await mainWindow.webContents.capturePage();
    const png = image.toPNG();
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(app.getPath('pictures'), `claudecount-${ts}.png`);
    fs.writeFileSync(filePath, png);
    return { ok: true, filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// --- Forward PTY events to renderer ---
ptyService.on('terminal-created', (data) => sendToRenderer(CH.TERMINAL_OUTPUT, { type: 'created', ...data }));
ptyService.on('terminal-output', (data) => sendToRenderer(CH.TERMINAL_OUTPUT, data));
ptyService.on('terminal-exited', (data) => sendToRenderer(CH.TERMINAL_EXITED, data));

// --- Forward agent events to renderer ---
agentManager.on('agent-created', (data) => sendToRenderer(CH.AGENT_UPDATED, data));
agentManager.on('agent-updated', (data) => sendToRenderer(CH.AGENT_UPDATED, data));
agentManager.on('agent-notification', (data) => sendToRenderer(CH.AGENT_NOTIFICATION, data));
agentManager.on('agent-exited', (data) => sendToRenderer(CH.AGENT_EXITED, data));

// --- App Lifecycle ---
app.whenReady().then(() => {
  createWindow();
  projectRegistry.init();
  taskManager.init();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  ptyService.killAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  try { ptyService.killAll(); } catch { /* ignore */ }
});
