const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const ProcessMonitor = require('../services/processMonitor');
const AgentBridge = require('../services/agentBridge');
const logger = require('../services/logger');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

let mainWindow = null;
const monitor = new ProcessMonitor();
const bridge = new AgentBridge(monitor);

// --- IPC Push Throttling ---
// Batch rapid agent updates to avoid overwhelming the renderer.
const PUSH_THROTTLE_MS = 300;
let pendingPush = null;
let lastPushTime = 0;

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function pushAgentUpdate(data) {
  const now = Date.now();
  const elapsed = now - lastPushTime;

  if (elapsed >= PUSH_THROTTLE_MS) {
    lastPushTime = now;
    sendToRenderer('agents:updated', data);
  } else {
    // Coalesce: only keep the latest data, schedule one push
    if (pendingPush) clearTimeout(pendingPush);
    pendingPush = setTimeout(() => {
      pendingPush = null;
      lastPushTime = Date.now();
      sendToRenderer('agents:updated', {
        agents: monitor.getAgents(),
        added: [],
        removed: [],
      });
    }, PUSH_THROTTLE_MS - elapsed);
  }
}

// --- Heartbeat ---
// Periodically push the full agent list so the renderer can detect connectivity.
let heartbeatTimer = null;

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    sendToRenderer('agents:updated', {
      agents: monitor.getAgents(),
      added: [],
      removed: [],
    });
  }, 5000);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// --- Window Creation ---

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 700,
    minWidth: 320,
    minHeight: 400,
    maxWidth: 600,
    title: 'ClaudeCount',
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  logger.info('Main window created');
};

// --- IPC Handlers ---

ipcMain.handle('agents:list', () => {
  return monitor.getAgents();
});

ipcMain.handle('agent:get-logs', (_event, pid) => {
  return bridge.getLogsForAgent(pid);
});

ipcMain.handle('agent:get-meta', (_event, pid) => {
  return bridge.getAgentMeta(pid);
});

ipcMain.handle('monitor:start', () => {
  monitor.start();
  startHeartbeat();
  logger.info('Monitor started via IPC');
});

ipcMain.handle('monitor:stop', () => {
  monitor.stop();
  stopHeartbeat();
  logger.info('Monitor stopped via IPC');
});

// --- Forward monitor events to renderer (throttled) ---

monitor.on('agents-updated', (data) => {
  pushAgentUpdate(data);
});

monitor.on('agent-log-line', (data) => {
  sendToRenderer('agent:log-line', data);
});

// --- App Lifecycle ---

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  monitor.stop();
  stopHeartbeat();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  monitor.stop();
  stopHeartbeat();
});
