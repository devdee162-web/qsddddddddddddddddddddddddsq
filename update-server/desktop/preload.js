const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("zcordPanel", {
    isDesktop: true,
    invoke: (channel, data) => ipcRenderer.invoke(channel, data),
    pickFile: () => ipcRenderer.invoke("pick-file")
});
