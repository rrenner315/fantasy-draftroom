const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("draftroomDesktop", {
  openCompanion: () => ipcRenderer.invoke("draftroom:open-companion"),
  sendCompanionMessage: (message) => ipcRenderer.send("draftroom:companion-message", message),
  onCompanionMessage: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on("draftroom:companion-message", listener);
    return () => ipcRenderer.removeListener("draftroom:companion-message", listener);
  },
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
