const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cloudnex', {
  platform: process.platform,
  backendUrl: 'http://127.0.0.1:8000',
  getHealth: () => fetch('http://127.0.0.1:8000/health').then((response) => response.json()),
  chooseCheckpointExportPath: () => ipcRenderer.invoke('checkpoint:save-dialog'),
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    onMaximizedState: (callback) => ipcRenderer.on('window:maximized-state', (_event, maximized) => callback(maximized)),
  },
});
