const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cloudnex', {
  platform: process.platform,
  backendUrl: 'http://127.0.0.1:8000',
  getHealth: () => fetch('http://127.0.0.1:8000/health').then((response) => response.json()),
});
