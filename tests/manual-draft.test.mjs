import test from 'node:test';
import assert from 'node:assert/strict';
import { applyManualAction, draftRevision, pickOwner, searchDraftPlayers } from '../app/manual-draft.mjs';

const players = [
  { id: 'chase', name: "Ja’Marr Chase", position: 'WR', team: 'CIN', rank: 1, tier: 1 },
  { id: 'allen', name: 'Josh Allen', position: 'QB', team: 'BUF', rank: 20, tier: 1 },
  { id: 'brown', name: 'Amon-Ra St. Brown', position: 'WR', team: 'DET', rank: 5, tier: 1 },
];
const room = () => ({ draftId: 'one', teams: 8, snake: true, locked: false, picks: [], players });
const act = (draft, action) => ({ ...draft, picks: applyManualAction(draft, { ...action, revision: draftRevision(draft) }) });

test('skip reserves a pick and filling it preserves subsequent picks and owners', () => {
  let draft = act(room(), { kind: 'skip' });
  draft = act(draft, { kind: 'pick', playerId: 'allen' });
  assert.equal(draft.picks[0].skipped, true);
  assert.equal(draft.picks[1].roster, 2);
  const after = act(draft, { kind: 'pick', playerId: 'chase', fillPick: 1 });
  assert.equal(after.picks.length, 2);
  assert.equal(after.picks[0].id, 'chase');
  assert.equal(after.picks[0].roster, 1);
  assert.equal(after.picks[0].skipped, undefined);
  assert.deepEqual(after.picks[1], draft.picks[1]);
  assert.equal(searchDraftPlayers(players, after.picks, '').length, 1);
});

test('undo handles placeholders and restores a player to availability', () => {
  let draft = act(room(), { kind: 'pick', playerId: 'chase' });
  draft = act(draft, { kind: 'skip' });
  draft = act(draft, { kind: 'undo' });
  assert.equal(draft.picks.length, 1);
  draft = act(draft, { kind: 'undo' });
  assert.equal(draft.picks.length, 0);
  assert.equal(searchDraftPlayers(players, draft.picks, 'chase')[0].id, 'chase');
});

test('stale and duplicate commands cannot advance or undo the board twice', () => {
  const initial = room();
  const action = { kind: 'skip', revision: draftRevision(initial) };
  const updated = { ...initial, picks: applyManualAction(initial, action) };
  assert.throws(() => applyManualAction(updated, action), /board changed/);
  assert.throws(() => applyManualAction({ ...initial, draftId: 'other' }, action), /board changed/);
  const undo = { kind: 'undo', revision: draftRevision(updated) };
  const undone = { ...updated, picks: applyManualAction(updated, undo) };
  assert.throws(() => applyManualAction(undone, undo), /board changed/);
});

test('Sleeper control, missing drafts, invalid players and invalid fill slots reject writes', () => {
  const draft = room();
  assert.throws(() => act({ ...draft, locked: true }, { kind: 'skip' }), /Sleeper/);
  assert.throws(() => act({ ...draft, draftId: '' }, { kind: 'skip' }), /Open a draft/);
  assert.throws(() => act(draft, { kind: 'pick', playerId: 'missing' }), /no longer/);
  const picked = act(draft, { kind: 'pick', playerId: 'chase' });
  assert.throws(() => act(picked, { kind: 'pick', playerId: 'chase' }), /already been picked/);
  assert.throws(() => act(picked, { kind: 'pick', playerId: 'allen', fillPick: 1 }), /already been filled/);
  assert.throws(() => act(draft, { kind: 'undo' }), /no picks/);
});

test('snake and linear ownership stays correct through skipped round boundaries', () => {
  let draft = room();
  for (let i = 0; i < 17; i++) draft = act(draft, { kind: 'skip' });
  assert.deepEqual(draft.picks.map((p) => p.roster), [1,2,3,4,5,6,7,8,8,7,6,5,4,3,2,1,1]);
  assert.equal(pickOwner(9, 8, false), 1);
});

test('search handles initials, punctuation, partial words, teams, filters, and taken players', () => {
  assert.equal(searchDraftPlayers(players, [], 'jamarr')[0].id, 'chase');
  assert.equal(searchDraftPlayers(players, [], 'ja')[0].id, 'chase');
  assert.equal(searchDraftPlayers(players, [], 'j a', 'QB')[0].id, 'allen');
  assert.equal(searchDraftPlayers(players, [], 'asb')[0].id, 'brown');
  assert.equal(searchDraftPlayers(players, [], 'buf')[0].id, 'allen');
  assert.deepEqual(searchDraftPlayers(players, [{ id: 'chase' }], 'chase'), []);
  assert.deepEqual(searchDraftPlayers(players, [], '').map((p) => p.id), ['chase', 'brown', 'allen']);
});

test('new optional placeholder metadata survives normal JSON persistence', () => {
  const draft = act(room(), { kind: 'skip' });
  const restored = JSON.parse(JSON.stringify(draft));
  assert.equal(restored.picks[0].skipped, true);
  assert.equal(draftRevision(restored), draftRevision(draft));
  assert.equal(act(restored, { kind: 'pick', playerId: 'allen', fillPick: 1 }).picks[0].id, 'allen');
});
