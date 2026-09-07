'use client';
import { useEffect, useRef, useState } from 'react';
import { draftRevision, pickOwner, searchDraftPlayers } from '../manual-draft.mjs';
import type { CompanionMessage, CompanionSnapshot, CompanionPlayer, PickAction } from '../companion-types';

export default function DraftCompanion() {
  const [snapshot, setSnapshot] = useState<CompanionSnapshot | null>(null);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState('ALL');
  const [selected, setSelected] = useState(0);
  const [fillPick, setFillPick] = useState<number | undefined>();
  const [online, setOnline] = useState(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState('Connecting to the full program…');
  const input = useRef<HTMLInputElement>(null);
  const lastSeen = useRef(0);
  const pendingRequest = useRef<{ id: string; message: string; sent: number } | null>(null);
  const draftId = useRef('');
  const selection = useRef<HTMLButtonElement>(null);
  const send = (message: CompanionMessage) => {
    if (window.draftroomDesktop) window.draftroomDesktop.sendCompanionMessage(message);
    else window.opener?.postMessage(message, window.location.origin);
  };

  useEffect(() => {
    document.title = 'Quick picks — The Program';
    const receive = (message: CompanionMessage) => {
      if (message?.channel !== 'draft-companion' || message.type !== 'snapshot' || !message.snapshot) return;
      const next = message.snapshot;
      lastSeen.current = Date.now();
      setOnline(true);
      setSnapshot(next);
      if (draftId.current !== next.draftId) {
        draftId.current = next.draftId;
        setQuery(''); setPosition('ALL'); setSelected(0); setFillPick(undefined);
        pendingRequest.current = null; setPending(false);
        setFeedback(next.draftId ? 'Connected. Picks update both windows.' : 'Open a draft in the full program.');
      }
      if (message.requestId && message.requestId === pendingRequest.current?.id) {
        setFeedback(message.error || pendingRequest.current.message);
        if (!message.error) { setQuery(''); setSelected(0); setFillPick(undefined); }
        pendingRequest.current = null; setPending(false);
        input.current?.focus();
      }
    };
    const listener = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.source === window.opener) receive(event.data);
    };
    const dispose = window.draftroomDesktop?.onCompanionMessage(receive);
    window.addEventListener('message', listener);
    const hello = () => {
      send({ channel: 'draft-companion', type: 'hello' });
      if (Date.now() - lastSeen.current > 7000) setOnline(false);
      if (pendingRequest.current && Date.now() - pendingRequest.current.sent > 7000) {
        pendingRequest.current = null; setPending(false);
        setFeedback('Confirmation was delayed. Check the latest picks before trying again.');
      }
    };
    hello();
    const timer = window.setInterval(hello, 2000);
    input.current?.focus();
    return () => { dispose?.(); window.removeEventListener('message', listener); window.clearInterval(timer); };
  }, []);

  const available: CompanionPlayer[] = snapshot ? searchDraftPlayers(snapshot.players, snapshot.picks, query, position) : [];
  const results = available.slice(0, 60);
  const highlighted = Math.min(selected, Math.max(results.length - 1, 0));
  const selectedPlayer = results[highlighted];
  const canEdit = online && snapshot?.active && !snapshot.locked && !pending;
  const nextPick = (snapshot?.picks.length || 0) + 1;
  const onClock = snapshot ? pickOwner(nextPick, snapshot.teams, snapshot.snake) : 1;
  const teamName = (slot: number) => snapshot?.mySlot === slot ? 'You' : snapshot?.teamNames[String(slot)] || `Team ${slot}`;
  const skipped = snapshot?.picks.filter((p) => p.skipped) || [];
  const filling = skipped.find((p) => p.pick === fillPick);
  const activeFill = filling?.pick;

  const act = (action: Omit<PickAction, 'revision'>, message: string) => {
    if (!canEdit || !snapshot || pendingRequest.current) return;
    const id = crypto.randomUUID();
    pendingRequest.current = { id, message, sent: Date.now() };
    setPending(true);
    send({ channel: 'draft-companion', type: 'command', requestId: id, action: { ...action, revision: draftRevision(snapshot) } });
  };
  const record = (player = selectedPlayer) => {
    if (player) act({ kind: 'pick', playerId: player.id, fillPick: activeFill }, `${player.name} recorded at pick ${activeFill || nextPick}.`);
  };
  useEffect(() => { selection.current?.scrollIntoView({ block: 'nearest' }); }, [highlighted, query]);

  return <main className="companion-shell" onKeyDown={(event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') { setQuery(''); setSelected(0); setFillPick(undefined); input.current?.focus(); }
    const target = event.target as HTMLElement;
    if (target === input.current) {
      if (event.key === 'ArrowDown') { event.preventDefault(); setSelected(Math.min(highlighted + 1, results.length - 1)); }
      if (event.key === 'ArrowUp') { event.preventDefault(); setSelected(Math.max(0, highlighted - 1)); }
      if (event.key === 'Enter' && !event.repeat) { event.preventDefault(); record(); }
    } else if (event.key.length === 1 && event.key !== ' ' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) {
      event.preventDefault(); setQuery(event.key); setSelected(0); input.current?.focus();
    }
  }}>
    <header className="companion-header"><div><span className="companion-brand">THE PROGRAM</span><h1>Quick picks</h1></div><span className={`companion-connection ${online ? 'connected' : ''}`}><i />{online ? 'Connected' : 'Disconnected'}</span></header>
    <div className="companion-draft-name">{snapshot?.name || 'Your draft companion'}</div>
    <section className={`companion-clock ${snapshot?.mySlot === onClock ? 'your-turn' : ''}`} aria-label="Current pick">
      <div><span>{filling ? `FILL PICK ${filling.pick}` : 'ON THE CLOCK'}</span><strong>{filling ? teamName(filling.roster) : teamName(onClock)}</strong></div>
      <div><b>{filling ? filling.pick : nextPick}</b><span>Round {snapshot ? Math.ceil((activeFill || nextPick) / snapshot.teams) : 1}</span></div>
    </section>
    {!online && <p className="companion-warning">Keep the full program open. If it was reloaded or closed, reopen Quick picks from the draft room.</p>}
    {online && !snapshot?.active && <p className="companion-warning">Return to the draft room in the full program to record picks.</p>}
    {snapshot?.locked && <p className="companion-warning">Sleeper sync is on. Switch to manual in the full program to record picks here.</p>}
    <section className="companion-search-area">
      <label htmlFor="quick-player">Find a player</label>
      <div className="companion-search"><span aria-hidden="true">⌕</span><input id="quick-player" ref={input} type="search" placeholder="Name, initials, or team…" autoComplete="off" value={query} onChange={(e) => { setQuery(e.target.value); setSelected(0); }} role="combobox" aria-expanded={true} aria-autocomplete="list" aria-activedescendant={selectedPlayer ? `quick-player-${highlighted}` : undefined} aria-describedby="quick-search-help" aria-controls="quick-results" />{query && <button aria-label="Clear search" onClick={() => { setQuery(''); setSelected(0); input.current?.focus(); }}>×</button>}</div>
      <p id="quick-search-help">↑ ↓ to choose · Enter to record · Esc to clear</p>
      <div className="companion-filters" aria-label="Position filter">{['ALL', ...new Set((snapshot?.players || []).map((p) => p.position))].map((pos) => <button key={pos} aria-pressed={position === pos} className={position === pos ? 'selected' : ''} onClick={() => { setPosition(pos); setSelected(0); input.current?.focus(); }}>{pos === 'ALL' ? 'All' : pos}</button>)}</div>
    </section>
    {skipped.length > 0 && <div className="companion-skipped"><label htmlFor="fill-pick">{skipped.length} skipped · fill later</label><select id="fill-pick" value={activeFill || ''} onChange={(e) => { setFillPick(e.target.value ? Number(e.target.value) : undefined); setQuery(''); setSelected(0); input.current?.focus(); }}><option value="">Record next pick</option>{skipped.map((p) => <option value={p.pick} key={p.pick}>Fill pick {p.pick} · {teamName(p.roster)}</option>)}</select></div>}
    <div className="companion-results-heading"><span>{query ? `${available.length} matches` : 'Available players'}</span><span>Your rank</span></div>
    <div className="companion-results" id="quick-results" role="listbox" aria-label="Available players">
      {results.map((player, index) => <button role="option" id={`quick-player-${index}`} aria-selected={index === highlighted} ref={index === highlighted ? selection : undefined} key={player.id} className={`companion-player ${index === highlighted ? 'highlighted' : ''}`} disabled={!canEdit} onClick={() => record(player)} aria-label={`Record ${player.name}${activeFill ? ` at skipped pick ${activeFill}` : ''}`}>
        <span className={`companion-position pos-${player.position.toLowerCase()}`}>{player.position}</span><span className="companion-player-name"><strong>{player.name}</strong><small>{player.team} · {player.tier === null ? 'No tier' : `Tier ${player.tier}`}</small></span><span className="companion-rank">{player.rank}</span><span className="companion-add" aria-hidden="true">＋</span>
      </button>)}
      {!results.length && <div className="companion-empty"><strong>{snapshot ? 'No available players found' : 'Waiting for your draft'}</strong><p>{snapshot ? 'Try a last name, clear the filter, or skip this pick and fill it later.' : 'Open Quick picks from the full draft room.'}</p></div>}
      {available.length > results.length && <p className="companion-more">Showing the first 60. Type a name to narrow the list.</p>}
    </div>
    <footer className="companion-footer">
      <div className="companion-last"><span>LAST PICK</span><strong>{snapshot?.picks.length ? `#${snapshot.picks.at(-1)!.pick} · ${snapshot.picks.at(-1)!.name}` : 'No picks yet'}</strong></div>
      <div className="companion-actions"><button disabled={!canEdit || !snapshot?.picks.length} onClick={() => act({ kind: 'undo' }, 'Last pick undone.')}><span aria-hidden="true">↶</span> Undo</button><button disabled={!canEdit || Boolean(activeFill)} onClick={() => act({ kind: 'skip' }, `Pick ${nextPick} skipped. You can fill it later.`)}>Skip pick <span aria-hidden="true">→</span></button></div>
      <p role="status" className="companion-feedback">{pending ? 'Recording…' : feedback}</p><small className="companion-save">{snapshot?.saveStatus || 'Saved by the full program'} · Manual entry</small>
    </footer>
  </main>;
}
