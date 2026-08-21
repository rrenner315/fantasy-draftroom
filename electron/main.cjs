const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");

let database;
let databasePath;
let backupsPath;

function writeAtomic(target, contents) {
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, contents, "utf8");
  fs.renameSync(temporary, target);
}

function openDatabase() {
  const dataPath = app.getPath("userData");
  fs.mkdirSync(dataPath, { recursive: true });
  databasePath = path.join(dataPath, "draftroom.db");
  backupsPath = path.join(dataPath, "Backups");
  fs.mkdirSync(backupsPath, { recursive: true });
  database = new DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK (id = 1), schema_version INTEGER NOT NULL, state_json TEXT NOT NULL, updated_at TEXT NOT NULL)");
}

function readState() {
  const row = database.prepare("SELECT state_json FROM app_state WHERE id = 1").get();
  return row ? JSON.parse(row.state_json) : null;
}

function saveState(state) {
  const json = JSON.stringify(state);
  const savedAt = new Date().toISOString();
  database.prepare("INSERT INTO app_state (id, schema_version, state_json, updated_at) VALUES (1, 2, ?, ?) ON CONFLICT(id) DO UPDATE SET schema_version = excluded.schema_version, state_json = excluded.state_json, updated_at = excluded.updated_at").run(json, savedAt);

  const dailyBackup = path.join(backupsPath, `draftroom-${savedAt.slice(0, 10)}.json`);
  writeAtomic(dailyBackup, JSON.stringify({ format: "draftroom-backup", version: 2, exportedAt: savedAt, state }, null, 2));
  const backups = fs.readdirSync(backupsPath).filter((file) => file.endsWith(".json")).sort().reverse();
  backups.slice(10).forEach((file) => fs.unlinkSync(path.join(backupsPath, file)));
  return savedAt;
}

function registerIpc() {
  ipcMain.handle("draftroom:load-state", () => readState());
  ipcMain.handle("draftroom:save-state", (_event, state) => saveState(state));
  ipcMain.handle("draftroom:storage-info", () => ({ databasePath, backupsPath }));
  ipcMain.handle("draftroom:export-backup", async () => {
    const state = readState();
    if (!state) return { canceled: true };
    const result = await dialog.showSaveDialog({
      title: "Export The Program backup",
      defaultPath: `The Program Backup ${new Date().toISOString().slice(0, 10)}.draftroom`,
      filters: [{ name: "The Program backup", extensions: ["draftroom"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    writeAtomic(result.filePath, JSON.stringify({ format: "draftroom-backup", version: 2, exportedAt: new Date().toISOString(), state }, null, 2));
    return { canceled: false, filePath: result.filePath };
  });
  ipcMain.handle("draftroom:import-backup", async () => {
    const result = await dialog.showOpenDialog({
      title: "Restore The Program backup",
      properties: ["openFile"],
      filters: [{ name: "The Program backup", extensions: ["draftroom", "json"] }],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const parsed = JSON.parse(fs.readFileSync(result.filePaths[0], "utf8"));
    const state = parsed.format === "draftroom-backup" ? parsed.state : parsed;
    if (!state || !Array.isArray(state.rankingSets)) throw new Error("This file is not a valid The Program backup.");
    saveState(state);
    return { canceled: false };
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 940,
    minHeight: 640,
    backgroundColor: "#f4f2eb",
    title: "The Program",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.loadFile(path.join(__dirname, "..", "desktop-dist", "index.html"));
}

app.whenReady().then(() => {
  openDatabase();
  registerIpc();
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (database) database.close();
});
