import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders The Program home page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>The Program — Fantasy Football Draft Companion<\/title>/i);
  assert.match(html, /Rankings and drafts/);
  assert.match(html, /Manage your ranking sets, customize tiers, and continue active drafts/);
  assert.match(html, /Create rankings set/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("includes the online rankings importer and desktop bridge", async () => {
  const [page, route, sleeperRoute, espnRoute, yahooRoute, preload, main] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/rankings/ffc/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/rankings/sleeper/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/rankings/espn/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/rankings/yahoo/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../electron/preload.cjs", import.meta.url), "utf8"),
    readFile(new URL("../electron/main.cjs", import.meta.url), "utf8"),
  ]);

  assert.match(page, /Import Expert Ranks/);
  assert.match(page, /Choose a source/);
  assert.match(page, /Choose your format/);
  assert.match(page, /Standard/);
  assert.match(page, /Half-PPR/);
  assert.match(page, /PPR/);
  assert.match(page, /2QB/);
  assert.match(route, /fantasyfootballcalculator\.com\/api\/v1\/adp/);
  assert.match(sleeperRoute, /api\.sleeper\.app\/projections\/nfl/);
  assert.match(espnRoute, /fantasy\.espn\.com|fantasy\.espn/);
  assert.match(yahooRoute, /pub-api-ro\.fantasysports\.yahoo\.com/);
  assert.match(page, /Sleeper/);
  assert.match(page, /ESPN/);
  assert.match(page, /Yahoo/);
  assert.match(preload, /loadFfcRankings/);
  assert.match(preload, /loadSleeperRankings/);
  assert.match(preload, /loadEspnRankings/);
  assert.match(preload, /loadYahooRankings/);
  assert.match(main, /draftroom:load-ffc-rankings/);
  assert.match(main, /draftroom:load-sleeper-rankings/);
  assert.match(main, /draftroom:load-espn-rankings/);
  assert.match(main, /draftroom:load-yahoo-rankings/);
});

test("supports Excel workbooks whose blank cells separate position tiers", async () => {
  const [page, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(packageJson, /read-excel-file/);
  assert.match(page, /parseTierRows/);
  assert.match(page, /players not listed become N\/A/i);
  assert.match(page, /Choose tier sheet/);
  assert.match(page, /tier:.*\?\? null/s);
});

test("detects common tier sheet layouts", async () => {
  const { parseTierRows } = await import("../app/tier-parser.mjs");

  const explicit = parseTierRows([
    ["Player Name", "Pos", "Tier", "Team"],
    ["Bijan Robinson", "RB", 1, "ATL"],
    ["Jahmyr Gibbs", "RB", 2, "DET"],
  ]);
  assert.deepEqual(explicit.map(({ name, tier }) => [name, tier]), [["Bijan Robinson", 1], ["Jahmyr Gibbs", 2]]);

  const blankSeparated = parseTierRows([
    ["Quarterbacks", "Running Backs"],
    ["Josh Allen", "Bijan Robinson"],
    ["", "Jahmyr Gibbs"],
    ["Lamar Jackson", ""],
    ["", "Saquon Barkley"],
  ]);
  assert.equal(blankSeparated.find(({ name }) => name === "Lamar Jackson").tier, 2);
  assert.equal(blankSeparated.find(({ name }) => name === "Saquon Barkley").tier, 2);

  const tierHeadings = parseTierRows([
    ["Tier 1", "Tier 2"],
    ["Ja'Marr Chase", "Puka Nacua"],
    ["Justin Jefferson", "Amon-Ra St. Brown"],
  ]);
  assert.deepEqual(tierHeadings.map(({ tier }) => tier), [1, 1, 2, 2]);

  const positionGroups = parseTierRows([
    ["QB", "", "", "RB", "", ""],
    ["Player Name", "Team", "Tier Number", "Player Name", "Team", "Tier Number"],
    ["Josh Allen", "BUF", 1, "Bijan Robinson", "ATL", 1],
    ["Lamar Jackson", "BAL", 2, "Jahmyr Gibbs", "DET", 2],
  ]);
  assert.deepEqual(positionGroups.map(({ name, position, tier }) => [name, position, tier]), [
    ["Josh Allen", "QB", 1],
    ["Lamar Jackson", "QB", 2],
    ["Bijan Robinson", "RB", 1],
    ["Jahmyr Gibbs", "RB", 2],
  ]);

  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /CSV, TSV, and Excel files are supported/);
  assert.match(page, /inspect every worksheet/);
  assert.match(page, /download a blank template/i);
  assert.match(page, /downloadTierTemplate\("table"\)/);
  assert.match(page, /downloadTierTemplate\("positions"\)/);
  assert.match(page, /The-Program-Tier-Template-Player-Table\.csv/);
  assert.match(page, /The-Program-Tier-Template-By-Position\.csv/);
});

test("matches obvious player-name variations and surfaces uncertain matches", async () => {
  const { findAutomaticPlayerMatch, normalizePlayerName, rankPlayerMatches } = await import("../app/name-matching.mjs");
  const board = [
    { id: "walker", name: "Kenneth Walker", position: "RB", team: "KC", rank: 1 },
    { id: "mclaurin", name: "Terry McLaurin", position: "WR", team: "WAS", rank: 2 },
  ];

  assert.equal(normalizePlayerName("Kenneth Walker |||"), normalizePlayerName("Kenneth Walker III"));
  assert.equal(normalizePlayerName("Amon-Ra St. Brown"), normalizePlayerName("Amon Ra St Brown"));
  assert.equal(findAutomaticPlayerMatch({ name: "Kenneth Walker |||", position: "RB", team: "KC" }, board)?.id, "walker");
  assert.equal(findAutomaticPlayerMatch({ name: "Terry McLaurin Jr.", position: "WR", team: "WAS" }, board)?.id, "mclaurin");
  assert.equal(rankPlayerMatches({ name: "Terri McLaurin", position: "WR", team: "WAS" }, board)[0].player.id, "mclaurin");

  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /A few names need your help/);
  assert.match(page, /Leave unmatched/);
  assert.match(page, /Apply matches/);
});

test("discovers ranking tables with varied headers and optional rank columns", async () => {
  const { parseDelimitedText, parseRankingRows } = await import("../app/ranking-parser.mjs");
  const titledSheet = [
    ["My Custom Rankings"],
    ["Updated before the draft"],
    ["TM", "Player Name", "Overall Rank", "Pos"],
    ["MIN", "Justin Jefferson", 2, "WR"],
    ["DET", "Jahmyr Gibbs", 1, "RB"],
  ];
  const parsed = parseRankingRows(titledSheet);
  assert.equal(parsed.headerRow, 3);
  assert.deepEqual(parsed.records.map((player) => player.name), ["Jahmyr Gibbs", "Justin Jefferson"]);
  assert.deepEqual(parsed.records.map((player) => player.position), ["RB", "WR"]);

  const withoutRank = parseRankingRows(parseDelimitedText("Notes about this list\nName;Position;Team\nPuka Nacua;WR;LAR\nBijan Robinson;RB;ATL"));
  assert.deepEqual(withoutRank.records.map((player) => player.sourceRank), [1, 2]);

  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /CSV, TSV, or Excel/);
  assert.match(page, /What does my sheet need\?/);
  assert.match(page, /If it&apos;s missing, row order becomes the ranking/);
});

test("offers roster and Excel-style tier views in the draft room", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /Rankings View/);
  assert.match(page, /Tier Board/);
  assert.match(page, /Available by tier/);
  assert.match(page, /tierBoardColumns/);
  assert.match(page, /available\.filter\(\(player\) => player\.position === boardPosition\)/);
  assert.match(page, /group\.tier === null \? "N\/A"/);
  assert.match(css, /draft-tier-board/);
  assert.match(css, /tier-column-qb/);
  assert.match(css, /tier-column-rb/);
  assert.match(css, /tier-column-wr/);
  assert.match(css, /tier-column-te/);
});

test("shows an elapsed timer that resets for every pick", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /pickTimerSeconds/);
  assert.match(page, /setInterval\(\(\) => setPickTimerSeconds/);
  assert.match(page, /\[step, picks\.length\]/);
  assert.match(page, /Current pick has taken/);
  assert.match(page, /pickTimerLabel/);
  assert.match(css, /\.pick-timer/);
  assert.match(css, /font-variant-numeric:tabular-nums/);
});

test("keeps the full player list in custom ranking order", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /const filtered = available\.filter[\s\S]*?\.sort\(\(a, b\) => a\.rank - b\.rank\);/);
});

test("optionally compares personal ranks with league-platform defaults", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /OPTIONAL DRAFT STRATEGY/);
  assert.match(page, /<option value="none">No comparison<\/option>/);
  assert.match(page, /useState<LeagueProvider>\("none"\)/);
  assert.match(page, /Math\.abs\(difference\) < teams/);
  assert.match(page, /May last/);
  assert.match(page, /Going early/);
  assert.match(page, /platformRanks/);
  assert.match(page, /fetchPlatformDefaults/);
  assert.match(css, /strategy-wait/);
  assert.match(css, /strategy-early/);
});

test("lets users rename opponent teams within each draft", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /teamNames\?: Record<string, string>/);
  assert.match(page, /kind: "rename-team"/);
  assert.match(page, /setTeamNames/);
  assert.match(page, /teamDisplayName\(team\)/);
  assert.match(page, /teamDisplayName\(p\.roster\)/);
  assert.match(page, /title="Rename team"/);
  assert.match(css, /roster-team-name/);
});

test("offers a FLEX player filter for RB, WR, and TE", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /position === "FLEX" && \["RB", "WR", "TE"\]\.includes\(player\.position\)/);
  assert.match(page, /\["ALL","RB","WR","QB","TE","FLEX"\]/);
});

test("uses the blue and slate visual theme", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(css, /Blue \+ slate interface/);
  assert.match(css, /--paper:#09111f/);
  assert.match(css, /--card:#151f30/);
  assert.match(css, /--lime:#60a5fa/);
  assert.match(css, /background:#3b82f6/);
});

test("uses a guided tier import flow", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /tierImporterOpen/);
  assert.match(page, /Prepare your tier sheet/);
  assert.match(page, /Upload the completed sheet/);
  assert.match(page, /Review the results/);
  assert.match(page, /Already have one\? Skip to step 2/);
  assert.match(css, /tier-import-steps/);
  assert.match(css, /tier-step-number/);
});

test("offers signals, watchlist, or no companion panel beside rankings", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /sidePanelMode/);
  assert.match(page, /Draft signals/);
  assert.match(page, /Player list companion panel/);
  assert.match(page, /watchlistIds/);
  assert.match(page, /toggleWatchlist/);
  assert.match(page, /Remove from watchlist/);
  assert.match(page, /Tier \$\{cliff\.tier\}/);
  assert.match(page, /selected in the last/);
  assert.match(page, /picksUntilMine/);
  assert.match(page, /stackOpportunity/);
  assert.match(page, /Stack \$\{stackOpportunity\.candidate\.name\}/);
  assert.match(page, /pairs with your/);
  assert.doesNotMatch(page, /const recommendations/);
  assert.match(css, /side-panel-toggle/);
  assert.match(css, /draft-watchlist/);
  assert.match(css, /draft-signal-list/);
  assert.match(css, /signal-stack/);
  assert.match(css, /\.recommend-panel \.player-list\{flex:1 1 auto/);
});

test("uses the entire draft workspace for the tier board", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /draftCenterView === "tiers" \? "draft-grid tier-view"/);
  assert.match(css, /\.draft-grid\.tier-view\{grid-template-columns:1fr\}/);
  assert.match(css, /\.tier-view>\.recommend-panel,\.tier-view>\.activity-panel\{display:none\}/);
});

test("connects to and reconciles a live Sleeper draft", async () => {
  const [page, css, route, preload, main] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/api/sleeper/draft/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../electron/preload.cjs", import.meta.url), "utf8"),
    readFile(new URL("../electron/main.cjs", import.meta.url), "utf8"),
  ]);

  assert.match(page, /Connect a Sleeper draft/);
  assert.match(page, /setInterval\(\(\) => syncSleeperDraft\(sleeperDraftId\), 1000\)/);
  assert.match(page, /fetchSleeperDraft\(draftId, !connecting\)/);
  assert.match(route, /picksOnly/);
  assert.match(page, /setPicks\(syncedPicks\)/);
  assert.match(page, /setWatchlistIds[\s\S]*syncedPicks/);
  assert.match(page, /This draft is controlled by Sleeper/);
  assert.match(route, /\/draft\/\$\{draftId\}\/picks/);
  assert.match(route, /\/league\/\$\{draft\.league_id\}\/users/);
  assert.match(preload, /loadSleeperDraft/);
  assert.match(main, /draftroom:load-sleeper-draft/);
  assert.match(page, /Switch to manual/);
  assert.match(page, /Reconnect Sleeper/);
  assert.match(page, /sleeperSyncPaused/);
  assert.match(page, /reportOverrides/);
  assert.match(page, /No pick recorded in Sleeper/);
  assert.match(page, /The Program/);
  assert.match(page, /Sleeper replaced/);
  assert.match(page, /onClick=\{disconnectSleeperDraft\}/);
  assert.match(css, /sleeper-board-sync/);
  assert.match(css, /sleeper-override-dialog/);
  assert.match(css, /\.board-heading\{position:sticky/);
});
