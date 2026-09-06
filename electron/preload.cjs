const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("draftroomDesktop", {
  loadState: () => ipcRenderer.invoke("draftroom:load-state"),
  saveState: (state) => ipcRenderer.invoke("draftroom:save-state", state),
  exportBackup: () => ipcRenderer.invoke("draftroom:export-backup"),
  importBackup: () => ipcRenderer.invoke("draftroom:import-backup"),
  getStorageInfo: () => ipcRenderer.invoke("draftroom:storage-info"),
  loadFfcRankings: (format, teams) => ipcRenderer.invoke("draftroom:load-ffc-rankings", format, teams),
  loadSleeperRankings: (format) => ipcRenderer.invoke("draftroom:load-sleeper-rankings", format),
  loadSleeperDraft: (draftId, picksOnly = false) => ipcRenderer.invoke("draftroom:load-sleeper-draft", draftId, picksOnly),
  loadEspnRankings: (format) => ipcRenderer.invoke("draftroom:load-espn-rankings", format),
  loadYahooRankings: (format) => ipcRenderer.invoke("draftroom:load-yahoo-rankings", format),
});
