const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('amelia', { saveServer: server => ipcRenderer.invoke('save-server', server) });
