const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("typeTranslate", {
  request: (request) => ipcRenderer.invoke("service:request", request),
  getMeta: () => ipcRenderer.invoke("app:meta"),
  openData: () => ipcRenderer.invoke("app:open-data"),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
  copy: (text) => ipcRenderer.invoke("clipboard:write", text),
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  hide: () => ipcRenderer.send("window:hide"),
  onNavigate: (callback) => ipcRenderer.on("navigate", (_, page) => callback(page)),
  onUpdate: (callback) => ipcRenderer.on("update", (_, info) => callback(info)),
  checkUpdates: () => ipcRenderer.invoke("app:check-updates"),
  installUpdate: () => ipcRenderer.invoke("app:install-update"),
});
