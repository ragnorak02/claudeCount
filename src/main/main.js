const { app, BrowserWindow, ipcMain, dialog, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const ProcessMonitor = require('../services/processMonitor');
const AgentBridge = require('../services/agentBridge');
const PromptInjector = require('../services/promptInjector');
const TokenStore = require('../services/tokenStore');
const MobileServer = require('../services/mobileServer');
const TunnelManager = require('../services/tunnelManager');
const ProjectRegistry = require('../services/projectRegistry');
const config = require('../services/config');
const logger = require('../services/logger');
const { getEnvironmentInfo, getVersionInfo } = require('../services/exportService');

// --- Global Error Handlers ---
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { message: err.message, stack: err.stack });
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { message: String(reason) });
});

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

let mainWindow = null;
const monitor = new ProcessMonitor();
const bridge = new AgentBridge(monitor);
const injector = new PromptInjector();
const tokenStore = new TokenStore();
let mobileServer = null;
const tunnelManager = new TunnelManager();
const projectRegistry = new ProjectRegistry();

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

ipcMain.handle('agent:send-prompt', async (_event, pid, text) => {
  // Validate pid
  const agent = monitor.getAgentByPid(pid);
  if (!agent) {
    return { ok: false, error: 'Agent not found' };
  }
  if (agent.status === 'terminated') {
    return { ok: false, error: 'Agent is terminated' };
  }

  // Only allow injection to claude.exe processes, not bash.exe subprocesses
  const name = (agent.name || '').toLowerCase();
  if (name.includes('bash') || name.includes('sh.exe')) {
    return { ok: false, error: 'Cannot inject into shell subprocess' };
  }

  // Validate text
  if (!text || typeof text !== 'string') {
    return { ok: false, error: 'Text is required' };
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'Text is empty' };
  }
  if (trimmed.length > config.MAX_PROMPT_LENGTH) {
    return { ok: false, error: `Text exceeds maximum length (${config.MAX_PROMPT_LENGTH})` };
  }

  try {
    return await injector.sendPrompt(pid, trimmed);
  } catch (err) {
    logger.error('Prompt injection failed', { pid, message: err.message });
    return { ok: false, error: 'Injection failed: ' + err.message };
  }
});

// --- Tag Management ---

ipcMain.handle('agent:set-tags', (_event, pid, tags) => {
  bridge.setAgentTags(pid, tags);
  return { ok: true };
});

ipcMain.handle('agent:add-tag', (_event, pid, tag) => {
  bridge.addAgentTag(pid, tag);
  return { ok: true };
});

ipcMain.handle('agent:remove-tag', (_event, pid, tag) => {
  bridge.removeAgentTag(pid, tag);
  return { ok: true };
});

ipcMain.handle('agent:get-tags', (_event, pid) => {
  return bridge.getAgentTags(pid);
});

// --- Export ---

ipcMain.handle('agents:export', async () => {
  const payload = bridge.exportAgents();

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Agents',
    defaultPath: `claude-agents-${Date.now()}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });

  if (canceled || !filePath) {
    return { ok: false, reason: 'cancelled' };
  }

  try {
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
    logger.info('Agents exported', { filePath });
    return { ok: true, filePath };
  } catch (err) {
    logger.error('Export failed', { message: err.message });
    return { ok: false, reason: err.message };
  }
});

// --- Project Registry ---

ipcMain.handle('projects:list', () => {
  return projectRegistry.getAll();
});

ipcMain.handle('projects:list-enabled', () => {
  return projectRegistry.getEnabled();
});

ipcMain.handle('projects:add', (_event, name, projectPath) => {
  return projectRegistry.add(name, projectPath);
});

ipcMain.handle('projects:remove', (_event, id) => {
  return projectRegistry.remove(id);
});

ipcMain.handle('projects:update', (_event, id, changes) => {
  return projectRegistry.update(id, changes);
});

ipcMain.handle('projects:browse', async () => {
  return projectRegistry.browseForPath(mainWindow);
});

// --- Environment & Version ---

ipcMain.handle('app:get-env', () => {
  return getEnvironmentInfo();
});

ipcMain.handle('app:get-version', () => {
  return getVersionInfo();
});

// --- Mobile Access ---

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

ipcMain.handle('mobile:get-info', () => {
  return {
    enabled: config.MOBILE_SERVER_ENABLED,
    localUrl: `http://${getLocalIp()}:${config.MOBILE_SERVER_PORT}`,
    port: config.MOBILE_SERVER_PORT,
    token: tokenStore.getToken(),
    tunnelUrl: tunnelManager.getUrl(),
    tunnelRunning: tunnelManager.isRunning(),
  };
});

ipcMain.handle('mobile:copy-token', () => {
  const t = tokenStore.getToken();
  if (t) clipboard.writeText(t);
  return { ok: true };
});

ipcMain.handle('mobile:start-tunnel', () => {
  if (tunnelManager.isRunning()) {
    return { ok: false, error: 'Tunnel already running' };
  }
  tunnelManager.start(config.MOBILE_SERVER_PORT);
  return { ok: true };
});

ipcMain.handle('mobile:stop-tunnel', () => {
  tunnelManager.stop();
  return { ok: true };
});

ipcMain.handle('mobile:generate-qr', async (_event, text) => {
  try {
    const QRCode = require('qrcode');
    return await QRCode.toDataURL(text, {
      width: 256,
      margin: 1,
      color: { dark: '#cccccc', light: '#1e1e1e' },
    });
  } catch (err) {
    logger.warn('QR generation failed', { message: err.message });
    return null;
  }
});

tunnelManager.on('url', (url) => {
  sendToRenderer('mobile:tunnel-url', { url });
});

tunnelManager.on('error', (err) => {
  sendToRenderer('mobile:tunnel-error', { message: err.message });
});

tunnelManager.on('exit', (code) => {
  sendToRenderer('mobile:tunnel-exit', { code });
});

// --- Forward monitor events to renderer (throttled) ---

monitor.on('agents-updated', (data) => {
  pushAgentUpdate(data);
});

monitor.on('agent-log-line', (data) => {
  sendToRenderer('agent:log-line', data);
});

monitor.on('monitor-degraded', (data) => {
  sendToRenderer('monitor:degraded', data);
});

// --- App Lifecycle ---

app.whenReady().then(() => {
  createWindow();

  // Init project registry
  projectRegistry.init();

  // Init mobile server
  tokenStore.init();
  if (config.MOBILE_SERVER_ENABLED) {
    mobileServer = new MobileServer(monitor, bridge, injector, tokenStore);
    mobileServer.start(config.MOBILE_SERVER_PORT, config.MOBILE_SERVER_HOST);
  }

  // Auto-start tunnel if configured
  if (config.TUNNEL_PROVIDER === 'cloudflared') {
    tunnelManager.start(config.MOBILE_SERVER_PORT);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  monitor.stop();
  stopHeartbeat();
  if (mobileServer) { try { mobileServer.stop(); } catch { } }
  tunnelManager.stop();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  try { monitor.stop(); } catch { /* ignore */ }
  stopHeartbeat();
  if (mobileServer) { try { mobileServer.stop(); } catch { } }
  try { tunnelManager.stop(); } catch { /* ignore */ }
});
