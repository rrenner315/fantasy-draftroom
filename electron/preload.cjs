const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("draftroomDesktop", {
  loadState: () => ipcRenderer.invoke("draftroom:load-state"),
  saveState: (state) => ipcRenderer.invoke("draftroom:save-state", state),
  exportBackup: () => ipcRenderer.invoke("draftroom:export-backup"),
  importBackup: () => ipcRenderer.invoke("draftroom:import-backup"),
  getStorageInfo: () => ipcRenderer.invoke("draftroom:storage-info"),
});
