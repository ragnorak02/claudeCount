const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAgents: () => ipcRenderer.invoke('agents:list'),
  getAgentLogs: (pid) => ipcRenderer.invoke('agent:get-logs', pid),
  getAgentMeta: (pid) => ipcRenderer.invoke('agent:get-meta', pid),
  startMonitor: () => ipcRenderer.invoke('monitor:start'),
  stopMonitor: () => ipcRenderer.invoke('monitor:stop'),

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

  removeListener: (channel, listener) => {
    ipcRenderer.removeListener(channel, listener);
  },

  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },
});
