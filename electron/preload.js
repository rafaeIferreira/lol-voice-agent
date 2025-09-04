const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('voiceAPI', {
  onPresenceUpdate: (cb) => {
    const handler = (_event, data) => cb(data)
    ipcRenderer.on('presence:update', handler)
    return () => ipcRenderer.removeListener('presence:update', handler)
  },
  getIdentity: () => ipcRenderer.invoke('voice:get-identity'),
  join: (payload) => ipcRenderer.invoke('voice:join', payload)
})
contextBridge.exposeInMainWorld('windowAPI', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
})
