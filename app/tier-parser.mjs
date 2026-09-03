const clean = (value) => String(value ?? "").trim();
const headerKey = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "");

const aliases = {
  name: new Set(["player", "playername", "name", "athlete"]),
  position: new Set(["position", "pos", "playerposition"]),
  team: new Set(["team", "tm", "nflteam"]),
  tier: new Set(["tier", "tiernumber", "tierno", "tiernum"]),
};

export function positionFromTierHeader(value) {
  const header = clean(value).toUpperCase().replace(/[^A-Z]/g, "");
  if (header === "QB" || header.includes("QUARTERBACK")) return "QB";
  if (header === "RB" || header.includes("RUNNINGBACK")) return "RB";
  if (header === "WR" || header.includes("WIDERECEIVER")) return "WR";
  if (header === "TE" || header.includes("TIGHTEND")) return "TE";
  if (header === "K" || header.includes("KICKER")) return "K";
  if (["DEF", "DST", "DEFENSE"].includes(header)) return "DEF";
  return "";
}

function tierNumber(value) {
  const text = clean(value);
  const match = text.match(/^(?:tier\s*)?#?([0-9]+)$/i);
  return match ? Number(match[1]) : null;
}

function isTierMarker(value) {
  return /^tier\s*#?\s*[0-9]+$/i.test(clean(value));
}

function headerColumns(row) {
  const columns = {};
  row.forEach((cell, index) => {
    const key = headerKey(cell);
    for (const [field, values] of Object.entries(aliases)) if (values.has(key)) columns[field] = index;
  });
  return columns;
}

function parsePositionGroups(rows) {
  let positionRow = -1;
  let groups = [];
  rows.forEach((row, rowIndex) => {
    const found = row.map((cell, column) => ({ column, position: positionFromTierHeader(cell) })).filter((item) => item.position);
    if (found.length > groups.length) {
      positionRow = rowIndex;
      groups = found;
    }
  });
  if (positionRow < 0) return [];
  for (let headerRow = positionRow + 1; headerRow <= Math.min(positionRow + 3, rows.length - 1); headerRow++) {
    const parsedGroups = groups.map(({ column, position }, groupIndex) => {
      const end = groups[groupIndex + 1]?.column ?? (rows[headerRow]?.length || column + 3);
      const local = headerColumns((rows[headerRow] || []).slice(column, end));
      return local.name === undefined || local.tier === undefined ? null : {
        position,
        name: column + local.name,
        team: local.team === undefined ? undefined : column + local.team,
        tier: column + local.tier,
      };
    }).filter(Boolean);
    if (!parsedGroups.length) continue;
    const assignments = [];
    parsedGroups.forEach((group) => {
      let carriedTier = null;
      for (let rowIndex = headerRow + 1; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex] || [];
        const name = clean(row[group.name]);
        const parsedTier = tierNumber(row[group.tier]);
        if (parsedTier !== null) carriedTier = parsedTier;
        if (!name || carriedTier === null) continue;
        assignments.push({ name, position: group.position, team: clean(row[group.team]), tier: carriedTier });
      }
    });
    if (assignments.length) return assignments;
  }
  return [];
}

function parseExplicitTable(rows) {
  let headerRow = -1;
  let columns = {};
  rows.forEach((row, index) => {
    const found = headerColumns(row);
    if (found.name !== undefined && found.tier !== undefined && Object.keys(found).length > Object.keys(columns).length) {
      headerRow = index;
      columns = found;
    }
  });
  if (headerRow < 0) return [];
  const assignments = [];
  let carriedTier = null;
  for (let index = headerRow + 1; index < rows.length; index++) {
    const row = rows[index] || [];
    const name = clean(row[columns.name]);
    const parsedTier = tierNumber(row[columns.tier]);
    if (parsedTier !== null) carriedTier = parsedTier;
    if (!name || isTierMarker(name) || carriedTier === null) continue;
    assignments.push({ name, position: clean(row[columns.position]).toUpperCase(), team: clean(row[columns.team]), tier: carriedTier });
  }
  return assignments;
}

function parsePositionColumns(rows) {
  let headerRow = -1;
  let positionColumns = [];
  rows.forEach((row, rowIndex) => {
    const found = row.map((cell, column) => ({ column, position: positionFromTierHeader(cell) })).filter((item) => item.position);
    if (found.length > positionColumns.length) {
      headerRow = rowIndex;
      positionColumns = found;
    }
  });
  if (headerRow < 0 || !positionColumns.length) return [];
  const positionColumnIndexes = new Set(positionColumns.map(({ column }) => column));
  const assignments = [];
  positionColumns.forEach(({ column, position }) => {
    let tier = 1;
    let foundPlayer = false;
    let crossedBlank = false;
    for (let rowIndex = headerRow + 1; rowIndex < rows.length; rowIndex++) {
      const name = clean(rows[rowIndex]?.[column]);
      if (!name) {
        if (foundPlayer) crossedBlank = true;
        continue;
      }
      if (isTierMarker(name)) {
        tier = tierNumber(name) ?? tier;
        crossedBlank = false;
        continue;
      }
      if (foundPlayer && crossedBlank) tier++;
      const nextCell = positionColumnIndexes.has(column + 1) ? "" : clean(rows[rowIndex]?.[column + 1]);
      assignments.push({ name, position, team: nextCell, tier });
      foundPlayer = true;
      crossedBlank = false;
    }
  });
  return assignments;
}

function parseTierColumns(rows) {
  let best = null;
  rows.forEach((row, rowIndex) => {
    const columns = row.map((cell, column) => ({ column, tier: isTierMarker(cell) ? tierNumber(cell) : null })).filter((item) => item.tier !== null);
    if (columns.length && (!best || columns.length > best.columns.length)) best = { rowIndex, columns };
  });
  if (!best) return [];
  const assignments = [];
  best.columns.forEach(({ column, tier }) => {
    let position = positionFromTierHeader(rows[best.rowIndex]?.[column]);
    for (let above = best.rowIndex - 1; above >= Math.max(0, best.rowIndex - 3) && !position; above--) position = positionFromTierHeader(rows[above]?.[column]);
    for (let rowIndex = best.rowIndex + 1; rowIndex < rows.length; rowIndex++) {
      const name = clean(rows[rowIndex]?.[column]);
      if (!name || isTierMarker(name)) continue;
      assignments.push({ name, position, team: "", tier });
    }
  });
  return assignments;
}

function parseGroupedList(rows) {
  let headerRow = -1;
  let columns = {};
  rows.forEach((row, index) => {
    const found = headerColumns(row);
    if (found.name !== undefined && Object.keys(found).length > Object.keys(columns).length) {
      headerRow = index;
      columns = found;
    }
  });
  if (headerRow < 0) return [];
  const assignments = [];
  let tier = 1;
  let foundPlayer = false;
  let crossedBlank = false;
  for (let index = headerRow + 1; index < rows.length; index++) {
    const row = rows[index] || [];
    const marker = row.find((cell) => isTierMarker(cell));
    if (marker !== undefined) {
      tier = tierNumber(marker) ?? tier;
      crossedBlank = false;
      continue;
    }
    const name = clean(row[columns.name]);
    if (!name) {
      if (foundPlayer) crossedBlank = true;
      continue;
    }
    if (foundPlayer && crossedBlank) tier++;
    assignments.push({ name, position: clean(row[columns.position]).toUpperCase(), team: clean(row[columns.team]), tier });
    foundPlayer = true;
    crossedBlank = false;
  }
  return assignments;
}

export function parseTierRows(rows) {
  const parsers = [parsePositionGroups, parseExplicitTable, parsePositionColumns, parseTierColumns, parseGroupedList];
  for (const parser of parsers) {
    const assignments = parser(rows);
    if (assignments.length) return assignments;
  }
  throw new Error("No supported tier layout was found. Add Player and Tier columns, position columns, or tier headings with player names underneath.");
}
