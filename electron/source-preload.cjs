const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('sourceWindow', {
  action: action => ipcRenderer.invoke('source-window:action',action),
  onState: callback => ipcRenderer.on('source-window:state',(_event,value)=>callback(value)),
});
