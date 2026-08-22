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
  assert.match(html, /Welcome to The Program/);
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

  assert.match(page, /Load popular draft data/);
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
