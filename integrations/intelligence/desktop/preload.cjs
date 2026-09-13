const { contextBridge, ipcRenderer } = require('electron');

// No generic IPC, filesystem or authentication credential access.
if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('chengyeDesktop', Object.freeze({
    version: 1,
    openAssistant: () => ipcRenderer.invoke('chengye:open-assistant'),
    setKnowledgeIdentity: value => ipcRenderer.send('chengye:knowledge-identity', value),
    replyKnowledge: value => ipcRenderer.send('chengye:knowledge-reply', value),
    onKnowledgeRequest: callback => {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on('chengye:knowledge-event', listener);
      return () => ipcRenderer.removeListener('chengye:knowledge-event', listener);
    },
  }));
}
