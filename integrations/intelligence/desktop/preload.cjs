const { contextBridge, ipcRenderer } = require('electron');

// No generic IPC, filesystem, authentication token or caller-supplied argument.
if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('chengyeDesktop', Object.freeze({
    version: 1,
    openAssistant: () => ipcRenderer.invoke('chengye:open-assistant'),
  }));
}
