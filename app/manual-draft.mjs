// One reducer is shared by the full board and the companion command handler.
export function draftRevision(draft) {
  return JSON.stringify([draft.draftId, draft.teams, draft.snake, draft.locked, draft.picks.map(({ id, pick, roster }) => [id, pick, roster])]);
}

export function pickOwner(pick, teams, snake) {
  const round = Math.floor((pick - 1) / teams);
  const offset = (pick - 1) % teams;
  return snake && round % 2 === 1 ? teams - offset : offset + 1;
}

export function applyManualAction(draft, action) {
  if (!draft.draftId) throw new Error('Open a draft in the full program first.');
  if (draft.locked) throw new Error('Sleeper is controlling this draft. Switch to manual in the full program first.');
  if (action.revision !== draftRevision(draft)) throw new Error('The board changed. Review the latest pick and try again.');
  const picks = draft.picks;
  if (action.kind === 'undo') {
    if (!picks.length) throw new Error('There are no picks to undo.');
    return picks.slice(0, -1);
  }
  const pick = picks.length + 1;
  if (action.kind === 'skip') return [...picks, {
    id: `skipped-${draft.draftId}-${pick}`, name: 'Unknown player', position: '—', team: 'Skipped pick',
    rank: 0, source: 'Manual placeholder', sourceRank: 0, tier: null, skipped: true,
    pick, roster: pickOwner(pick, draft.teams, draft.snake),
  }];
  if (action.kind !== 'pick') throw new Error('Unknown pick action.');
  const player = draft.players.find(({ id }) => id === action.playerId);
  if (!player) throw new Error('That player is no longer in this ranking set.');
  if (picks.some(({ id }) => id === player.id)) throw new Error('That player has already been picked.');
  if (action.fillPick !== undefined) {
    const index = picks.findIndex((entry) => entry.pick === action.fillPick && entry.skipped);
    if (index < 0) throw new Error('That skipped pick has already been filled or removed.');
    return picks.map((entry, i) => i === index ? { ...player, pick: entry.pick, roster: entry.roster } : entry);
  }
  return [...picks, { ...player, pick, roster: pickOwner(pick, draft.teams, draft.snake) }];
}

export function searchDraftPlayers(players, picks, query, position = 'ALL') {
  const clean = (text) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, '');
  const words = clean(query).split(/\s+/).filter(Boolean);
  const taken = new Set(picks.filter((p) => !p.skipped).map((p) => p.id));
  return players.filter((p) => {
    if (taken.has(p.id) || (position !== 'ALL' && p.position !== position)) return false;
    const name = clean(p.name);
    const initials = name.split(/\s+/).map((part) => part[0]).join('');
    const haystack = `${name} ${clean(p.team)} ${clean(p.position)}`;
    return words.every((word) => haystack.includes(word) || initials.startsWith(word));
  }).sort((a, b) => a.rank - b.rank);
}
