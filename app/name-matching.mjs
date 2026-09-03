const suffixes = new Set(["jr", "junior", "sr", "senior", "ii", "iii", "iv", "v"]);

export function nameTokens(value) {
  const cleaned = String(value ?? "")
    .replace(/\|/g, "I")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const tokens = cleaned ? cleaned.split(/\s+/) : [];
  while (tokens.length > 1 && suffixes.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.filter((token) => token.length > 1 || !suffixes.has(token));
}

export function normalizePlayerName(value) {
  return nameTokens(value).join("");
}

function normalizedPosition(value) {
  const position = String(value ?? "").toUpperCase();
  return position === "DST" ? "DEF" : position;
}

function normalizedTeam(value) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z]/g, "");
}

function similarity(left, right) {
  if (left === right) return 1;
  if (!left || !right) return 0;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length);
}

export function scorePlayerMatch(incoming, player) {
  const incomingTokens = nameTokens(incoming.name);
  const playerTokens = nameTokens(player.name);
  const incomingName = incomingTokens.join("");
  const playerName = playerTokens.join("");
  if (!incomingName || !playerName) return 0;
  if (incomingName === playerName) return 1;

  let score = similarity(incomingName, playerName);
  const samePosition = normalizedPosition(incoming.position) && normalizedPosition(incoming.position) === normalizedPosition(player.position);
  const sameTeam = normalizedTeam(incoming.team) && normalizedTeam(incoming.team) === normalizedTeam(player.team);
  const incomingFirst = incomingTokens[0] || "";
  const playerFirst = playerTokens[0] || "";
  const incomingLast = incomingTokens[incomingTokens.length - 1] || "";
  const playerLast = playerTokens[playerTokens.length - 1] || "";
  if (samePosition) score += 0.06;
  if (sameTeam) score += 0.04;
  if (incomingLast === playerLast) score += 0.08;
  if (incomingFirst[0] && incomingFirst[0] === playerFirst[0]) score += 0.02;
  if (Math.min(incomingFirst.length, playerFirst.length) >= 3 && (incomingFirst.startsWith(playerFirst) || playerFirst.startsWith(incomingFirst))) score += 0.05;
  return Math.min(score, 0.999);
}

export function rankPlayerMatches(incoming, players, excludedIds = new Set()) {
  return players
    .filter((player) => !excludedIds.has(player.id))
    .map((player) => ({ player, score: scorePlayerMatch(incoming, player) }))
    .sort((a, b) => b.score - a.score || a.player.rank - b.player.rank);
}

export function findAutomaticPlayerMatch(incoming, players, excludedIds = new Set()) {
  const ranked = rankPlayerMatches(incoming, players, excludedIds);
  const best = ranked[0];
  if (!best) return null;
  const exact = normalizePlayerName(incoming.name) === normalizePlayerName(best.player.name);
  const positionMatches = !incoming.position || normalizedPosition(incoming.position) === normalizedPosition(best.player.position);
  const teamMatches = incoming.team && normalizedTeam(incoming.team) === normalizedTeam(best.player.team);
  const margin = best.score - (ranked[1]?.score ?? 0);
  if (exact || (positionMatches && best.score >= 0.94 && margin >= 0.035) || (positionMatches && teamMatches && best.score >= 0.9 && margin >= 0.025)) return best.player;
  return null;
}
