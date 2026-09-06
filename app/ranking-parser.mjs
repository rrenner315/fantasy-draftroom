const headerAliases = {
  name: new Set(["player", "playername", "name", "fullname", "athlete", "playerfullname"]),
  position: new Set(["position", "pos", "playerposition", "rosterposition"]),
  team: new Set(["team", "tm", "nflteam", "club", "proteam"]),
  rank: new Set(["rank", "rk", "overall", "overallrank", "myrank", "consensusrank", "adp", "avgpick", "averagepick"]),
  bye: new Set(["bye", "byeweek", "weekoff", "offweek"]),
};

const cleanHeader = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function headerType(value) {
  const header = cleanHeader(value);
  if (!header) return null;
  for (const [type, aliases] of Object.entries(headerAliases)) if (aliases.has(header)) return type;
  if ((header.includes("player") || header.includes("athlete")) && header.includes("name")) return "name";
  if (header.includes("position") && !header.includes("rank")) return "position";
  if (header.includes("team") && !header.includes("rank")) return "team";
  if ((header.includes("rank") || header.includes("overall") || header === "adp") && !header.includes("position") && !header.startsWith("pos")) return "rank";
  if (header.includes("bye")) return "bye";
  return null;
}

export function findRankingHeaders(rows) {
  let best = null;
  rows.slice(0, 50).forEach((row, rowIndex) => {
    const columns = {};
    row.forEach((cell, columnIndex) => {
      const type = headerType(cell);
      if (type && columns[type] === undefined) columns[type] = columnIndex;
    });
    if (columns.name === undefined) return;
    const score = 5 + (columns.rank !== undefined ? 3 : 0) + (columns.position !== undefined ? 2 : 0) + (columns.team !== undefined ? 1 : 0);
    if (!best || score > best.score) best = { rowIndex, columns, score };
  });
  return best;
}

function numericRank(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = String(value ?? "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function normalizePosition(value) {
  const raw = String(value ?? "").trim().toUpperCase().replace(/[^A-Z/]/g, "");
  if (["D/ST", "DST", "DEFENSE"].includes(raw)) return "DEF";
  if (raw === "PK") return "K";
  return raw || "FLEX";
}

export function parseRankingRows(rows) {
  const headers = findRankingHeaders(rows);
  if (!headers) throw new Error("No player-name header was found. Add a column labeled Player, Player Name, or Name.");
  const { columns, rowIndex } = headers;
  const records = [];
  rows.slice(rowIndex + 1).forEach((row, rowOffset) => {
    const name = String(row?.[columns.name] ?? "").trim();
    if (!name || headerType(name) === "name") return;
    const rank = columns.rank === undefined ? null : numericRank(row?.[columns.rank]);
    records.push({
      name,
      position: columns.position === undefined ? "FLEX" : normalizePosition(row?.[columns.position]),
      team: columns.team === undefined ? "FA" : String(row?.[columns.team] ?? "FA").trim().toUpperCase() || "FA",
      byeWeek: columns.bye === undefined ? null : numericRank(row?.[columns.bye]),
      sourceRank: rank && rank > 0 ? rank : records.length + 1,
      rowNumber: rowIndex + rowOffset + 2,
    });
  });
  if (!records.length) throw new Error("The ranking headers were found, but no player rows appeared below them.");
  return { records: records.sort((a, b) => a.sourceRank - b.sourceRank || a.rowNumber - b.rowNumber), headerRow: rowIndex + 1, columns };
}

function countDelimiter(text, delimiter) {
  let count = 0;
  let quoted = false;
  for (const character of text.slice(0, 8000)) {
    if (character === '"') quoted = !quoted;
    else if (character === delimiter && !quoted) count++;
  }
  return count;
}

export function parseDelimitedText(text) {
  const clean = text.replace(/^\uFEFF/, "");
  const delimiters = [",", "\t", ";"];
  const delimiter = delimiters.sort((left, right) => countDelimiter(clean, right) - countDelimiter(clean, left))[0];
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < clean.length; index++) {
    const character = clean[index];
    if (character === '"' && quoted && clean[index + 1] === '"') {
      cell += '"';
      index++;
    } else if (character === '"') quoted = !quoted;
    else if (character === delimiter && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && clean[index + 1] === "\n") index++;
      row.push(cell.trim());
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  row.push(cell.trim());
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}
