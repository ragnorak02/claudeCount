const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAgents: () => ipcRenderer.invoke('agents:list'),
  getAgentLogs: (pid) => ipcRenderer.invoke('agent:get-logs', pid),
  getAgentMeta: (pid) => ipcRenderer.invoke('agent:get-meta', pid),
  startMonitor: () => ipcRenderer.invoke('monitor:start'),
  stopMonitor: () => ipcRenderer.invoke('monitor:stop'),
  sendPromptToAgent: (pid, text) => ipcRenderer.invoke('agent:send-prompt', pid, text),

  // Tag management
  setAgentTags: (pid, tags) => ipcRenderer.invoke('agent:set-tags', pid, tags),
  addAgentTag: (pid, tag) => ipcRenderer.invoke('agent:add-tag', pid, tag),
  removeAgentTag: (pid, tag) => ipcRenderer.invoke('agent:remove-tag', pid, tag),
  getAgentTags: (pid) => ipcRenderer.invoke('agent:get-tags', pid),

  // Export
  exportAgents: () => ipcRenderer.invoke('agents:export'),

  // Project Registry
  getProjects: () => ipcRenderer.invoke('projects:list'),
  getEnabledProjects: () => ipcRenderer.invoke('projects:list-enabled'),
  addProject: (name, projectPath) => ipcRenderer.invoke('projects:add', name, projectPath),
  removeProject: (id) => ipcRenderer.invoke('projects:remove', id),
  updateProject: (id, changes) => ipcRenderer.invoke('projects:update', id, changes),
  browseProjectPath: () => ipcRenderer.invoke('projects:browse'),

  // Environment & version
  getEnvironmentInfo: () => ipcRenderer.invoke('app:get-env'),
  getVersionInfo: () => ipcRenderer.invoke('app:get-version'),

  // Mobile access
  getMobileInfo: () => ipcRenderer.invoke('mobile:get-info'),
  copyMobileToken: () => ipcRenderer.invoke('mobile:copy-token'),
  startTunnel: () => ipcRenderer.invoke('mobile:start-tunnel'),
  stopTunnel: () => ipcRenderer.invoke('mobile:stop-tunnel'),

  generateQr: (text) => ipcRenderer.invoke('mobile:generate-qr', text),

  onTunnelUrl: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('mobile:tunnel-url', listener);
    return listener;
  },

  onTunnelError: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('mobile:tunnel-error', listener);
    return listener;
  },

  onTunnelExit: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('mobile:tunnel-exit', listener);
    return listener;
  },

  onAgentsUpdated: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('agents:updated', listener);
    return listener;
  },

  onAgentLogLine: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('agent:log-line', listener);
    return listener;
  },

  onMonitorDegraded: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('monitor:degraded', listener);
    return listener;
  },

  removeListener: (channel, listener) => {
    ipcRenderer.removeListener(channel, listener);
  },

  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },
});
