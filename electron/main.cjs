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

function normalizeEspnPlayers(entries, rankType) {
  const positions = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DEF" };
  const teams = { 1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET", 9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WAS", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU" };
  return entries
    .map((entry) => ({ entry, rank: Number(entry.player?.draftRanksByRankType?.[rankType]?.rank) }))
    .filter(({ entry, rank }) => positions[entry.player?.defaultPositionId] && rank > 0 && rank <= 500)
    .sort((a, b) => a.rank - b.rank)
    .map(({ entry, rank }) => ({ player_id: entry.player.id, name: entry.player.fullName, position: positions[entry.player.defaultPositionId], team: teams[entry.player.proTeamId] || "FA", adp: rank }));
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
  ipcMain.handle("draftroom:load-ffc-rankings", async (_event, format, teams) => {
    const allowedFormats = new Set(["standard", "half-ppr", "ppr", "2qb"]);
    const allowedTeams = new Set([8, 10, 12, 14]);
    if (!allowedFormats.has(format) || !allowedTeams.has(teams)) throw new Error("Unsupported rankings format.");
    const response = await fetch(`https://fantasyfootballcalculator.com/api/v1/adp/${format}?teams=${teams}&year=${new Date().getFullYear()}`, {
      headers: { Accept: "application/json", "User-Agent": "The Program fantasy draft app" },
    });
    if (!response.ok) throw new Error(`Rankings service returned ${response.status}.`);
    return response.json();
  });
  ipcMain.handle("draftroom:load-sleeper-rankings", async (_event, format) => {
    const statFields = { standard: "adp_std", "half-ppr": "adp_half_ppr", ppr: "adp_ppr", "2qb": "adp_2qb" };
    const statField = statFields[format];
    if (!statField) throw new Error("Unsupported rankings format.");
    const response = await fetch(`https://api.sleeper.app/projections/nfl/${new Date().getFullYear()}?season_type=regular&order_by=${statField}`, {
      headers: { Accept: "application/json", "User-Agent": "The Program fantasy draft app" },
    });
    if (!response.ok) throw new Error(`Rankings service returned ${response.status}.`);
    const data = await response.json();
    const positions = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);
    const players = data
      .filter((entry) => positions.has(entry.player?.position) && Number(entry.stats?.[statField]) > 0 && Number(entry.stats?.[statField]) <= 400)
      .sort((a, b) => Number(a.stats[statField]) - Number(b.stats[statField]))
      .map((entry) => ({ player_id: entry.player_id, name: [entry.player.first_name, entry.player.last_name].filter(Boolean).join(" "), position: entry.player.position, team: entry.player.team || entry.team || "FA", adp: Number(entry.stats[statField]) }));
    return { status: "Success", meta: { type: format }, players };
  });
  ipcMain.handle("draftroom:load-sleeper-draft", async (_event, draftId, picksOnly = false) => {
    if (!/^\d+$/.test(String(draftId))) throw new Error("Enter a valid Sleeper draft link or draft ID.");
    const headers = { Accept: "application/json", "User-Agent": "The Program fantasy draft app" };
    const sleeperJson = async (resource) => {
      const response = await fetch(`https://api.sleeper.app/v1${resource}`, { headers });
      if (!response.ok) throw new Error(`Sleeper returned ${response.status}.`);
      return response.json();
    };
    if (picksOnly) {
      const picks = await sleeperJson(`/draft/${draftId}/picks`);
      return { draft: { draft_id: String(draftId) }, picks, users: [] };
    }
    const [draft, picks] = await Promise.all([sleeperJson(`/draft/${draftId}`), sleeperJson(`/draft/${draftId}/picks`)]);
    const users = draft.league_id ? await sleeperJson(`/league/${draft.league_id}/users`) : [];
    return { draft, picks, users };
  });
  ipcMain.handle("draftroom:load-espn-rankings", async (_event, format) => {
    const rankTypes = { standard: "STANDARD", ppr: "PPR", superflex: "SUPERFLEX" };
    const rankType = rankTypes[format];
    if (!rankType) throw new Error("Unsupported rankings format.");
    const filter = JSON.stringify({ players: { limit: 500, sortDraftRanks: { sortPriority: 100, sortAsc: true, value: rankType } } });
    const response = await fetch(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${new Date().getFullYear()}/segments/0/leaguedefaults/1?view=kona_player_info`, {
      headers: { Accept: "application/json", "User-Agent": "The Program fantasy draft app", "x-fantasy-filter": filter },
    });
    if (!response.ok) throw new Error(`Rankings service returned ${response.status}.`);
    const data = await response.json();
    return { status: "Success", meta: { type: format }, players: normalizeEspnPlayers(data.players, rankType) };
  });
  ipcMain.handle("draftroom:load-yahoo-rankings", async (_event, format) => {
    if (format !== "standard") throw new Error("Yahoo currently supports Standard ADP only.");
    const headers = { Accept: "application/json", "User-Agent": "The Program fantasy draft app" };
    const gameResponse = await fetch("https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/game/nfl?format=json_f", { headers });
    if (!gameResponse.ok) throw new Error(`Rankings service returned ${gameResponse.status}.`);
    const gameData = await gameResponse.json();
    const gameKey = gameData.fantasy_content?.game?.game_key;
    if (!gameKey) throw new Error("Yahoo did not return a current fantasy football season.");
    const resource = `league/${gameKey}.l.public;out=settings/players;position=ALL;start=0;count=400;sort=average_pick;search=;out=auction_values,ranks;ranks=o-rank;out=expert_ranks;expert_ranks.rank_type=projected_season_remaining/draft_analysis;cut_types=diamond;slices=last7days`;
    const response = await fetch(`https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/${resource}?format=json_f`, { headers });
    if (!response.ok) throw new Error(`Rankings service returned ${response.status}.`);
    const data = await response.json();
    const players = (data.fantasy_content?.league?.players || [])
      .map((entry) => ({ entry, adp: Number(entry.player?.draft_analysis?.average_pick) }))
      .filter(({ entry, adp }) => entry.player?.name?.full && entry.player?.player_id && Number.isFinite(adp) && adp > 0)
      .sort((a, b) => a.adp - b.adp)
      .map(({ entry, adp }) => ({ player_id: entry.player.player_id, name: entry.player.name.full, position: entry.player.primary_position || entry.player.display_position || "FLEX", team: entry.player.editorial_team_abbr || "FA", adp }));
    return { status: "Success", meta: { type: format, season: gameData.fantasy_content?.game?.season }, players };
  });
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
