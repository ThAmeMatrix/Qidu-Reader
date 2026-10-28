const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('downloadWindow',{action:value=>ipcRenderer.invoke('download-window:action',value),onState:callback=>{ipcRenderer.on('download-window:state',(_event,value)=>callback(value));}});
