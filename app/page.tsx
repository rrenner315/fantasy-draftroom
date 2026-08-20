"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Player = {
  id: string;
  name: string;
  position: string;
  team: string;
  rank: number;
  source: string;
  sourceRank: number;
  tier: number;
};

type RankingFile = { id: string; name: string; players: Player[] };
type DraftPick = Player & { pick: number; roster: number };

const positionColors: Record<string, string> = {
  RB: "pos-rb",
  WR: "pos-wr",
  QB: "pos-qb",
  TE: "pos-te",
  K: "pos-k",
  DST: "pos-dst",
  DEF: "pos-dst",
};

function parseCsv(text: string, fileName: string): Player[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const clean = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    if (char === '"' && quoted && clean[i + 1] === '"') {
      cell += '"';
      i++;
    } else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  if (rows.length < 2) return [];

  const headers = rows[0].map((h) => h.toLowerCase());
  const find = (terms: string[]) => headers.findIndex((h) => terms.some((t) => h === t || h.includes(t)));
  const nameIndex = find(["player", "name"]);
  const positionIndex = find(["position", "pos"]);
  const teamIndex = find(["team"]);
  let rankIndex = headers.findIndex((h) => h.includes("rank") && !h.includes("diff") && !h.includes("pos"));
  if (rankIndex < 0) rankIndex = find(["overall", "rk"]);
  if (nameIndex < 0) throw new Error("No player/name column found");

  return rows.slice(1).map((values, index) => {
    const sourceRank = Number(values[rankIndex]) || index + 1;
    const name = values[nameIndex]?.trim();
    return {
      id: `${fileName}-${name}-${index}`,
      name,
      position: (values[positionIndex] || "FLEX").toUpperCase(),
      team: (values[teamIndex] || "FA").toUpperCase(),
      rank: sourceRank,
      source: fileName.replace(/\.csv$/i, ""),
      sourceRank,
      tier: Math.ceil(sourceRank / 12),
    };
  }).filter((player) => player.name);
}

function ownerForPick(pick: number, teams: number, snake: boolean) {
  const round = Math.floor((pick - 1) / teams);
  const withinRound = (pick - 1) % teams;
  return snake && round % 2 === 1 ? teams - withinRound : withinRound + 1;
}

export default function Home() {
  const hydrated = useRef(false);
  const [files, setFiles] = useState<RankingFile[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [step, setStep] = useState<"rankings" | "setup" | "draft">("rankings");
  const [teams, setTeams] = useState(12);
  const [mySlot, setMySlot] = useState(4);
  const [snake, setSnake] = useState(true);
  const [picks, setPicks] = useState<DraftPick[]>([]);
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState("ALL");
  const [showAllRankings, setShowAllRankings] = useState(false);
  const [notice, setNotice] = useState("Upload your first rankings file to get started.");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("draftroom-state");
      if (saved) {
        const state = JSON.parse(saved);
        setFiles(state.files || []);
        setPlayers(state.players || []);
        setTeams(state.teams || 12);
        setMySlot(state.mySlot || 4);
        setSnake(state.snake ?? true);
        setPicks(state.picks || []);
        setStep(state.step || "rankings");
        setNotice("Your previous draft board was restored.");
      }
    } catch { setNotice("Your saved board could not be restored, so we started fresh."); }
    const timer = window.setTimeout(() => { hydrated.current = true; }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    localStorage.setItem("draftroom-state", JSON.stringify({ files, players, teams, mySlot, snake, picks, step }));
  }, [files, players, teams, mySlot, snake, picks, step]);

  const mergeFiles = (nextFiles: RankingFile[]) => {
    const seen = new Set<string>();
    const merged: Player[] = [];
    nextFiles.forEach((file) => file.players.forEach((player) => {
      const key = player.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!seen.has(key)) {
        seen.add(key);
        merged.push({ ...player, id: key });
      }
    }));
    setPlayers(merged.map((player, index) => ({ ...player, rank: index + 1 })));
  };

  const addFiles = async (incoming: FileList | null) => {
    if (!incoming) return;
    const parsed: RankingFile[] = [];
    for (const file of Array.from(incoming)) {
      try {
        const filePlayers = parseCsv(await file.text(), file.name);
        if (filePlayers.length) parsed.push({ id: `${file.name}-${Date.now()}`, name: file.name, players: filePlayers });
      } catch (error) {
        setNotice(`${file.name}: ${error instanceof Error ? error.message : "Could not read this file"}`);
      }
    }
    const next = [...files, ...parsed];
    setFiles(next);
    mergeFiles(next);
    if (parsed.length) setNotice(`${parsed.length} file${parsed.length === 1 ? "" : "s"} added. Earlier files take priority.`);
  };

  const moveFile = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= files.length) return;
    const next = [...files];
    [next[index], next[target]] = [next[target], next[index]];
    setFiles(next);
    mergeFiles(next);
  };

  const removeFile = (id: string) => {
    const next = files.filter((file) => file.id !== id);
    setFiles(next);
    mergeFiles(next);
  };

  const updateTier = (id: string, tier: number) => setPlayers((current) => current.map((p) => p.id === id ? { ...p, tier: Math.max(1, tier || 1) } : p));
  const updateRank = (id: string, rank: number) => setPlayers((current) => current.map((p) => p.id === id ? { ...p, rank: Math.max(1, rank || 1) } : p));
  const resetRanks = () => setPlayers((current) => current.map((player, index) => ({ ...player, rank: index + 1 })));

  const draftedIds = new Set(picks.map((pick) => pick.id));
  const available = useMemo(() => players.filter((player) => !draftedIds.has(player.id)), [players, picks]);
  const filtered = available.filter((player) => (position === "ALL" || player.position === position) && player.name.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.rank - b.rank);
  const nextPick = picks.length + 1;
  const onClock = ownerForPick(nextPick, teams, snake);
  const round = Math.ceil(nextPick / teams);
  const recommendations = [...available].sort((a, b) => a.tier - b.tier || a.rank - b.rank).slice(0, 5);

  const draftPlayer = (player: Player) => {
    setPicks((current) => [...current, { ...player, pick: nextPick, roster: onClock }]);
    setSearch("");
  };

  const undo = () => setPicks((current) => current.slice(0, -1));

  if (step === "rankings") return (
    <main className="app-shell setup-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">D</span><span>Draftroom</span></div>
        <div className="stepper"><span className="active">1 Rankings</span><i /> <span>2 Draft setup</span><i /> <span>3 Draft room</span></div>
        <span className="saved">● Saved locally</span>
      </header>
      <section className="setup-wrap">
        <div className="eyebrow">BUILD YOUR BOARD</div>
        <h1>Your rankings. Your edge.</h1>
        <p className="lede">Stack expert lists in the order you trust them. We&apos;ll use every player from your first source, then fill the gaps from the next.</p>

        <label className="dropzone">
          <input type="file" accept=".csv,text/csv" multiple onChange={(event) => addFiles(event.target.files)} />
          <span className="upload-icon">↑</span>
          <strong>Drop ranking CSVs here</strong>
          <small>or click to choose files · Player, position and team columns recommended</small>
          <span className="choose-button">Choose CSV files</span>
        </label>

        <div className="section-heading"><div><h2>Source priority</h2><p>Top source wins when a player appears in more than one list.</p></div><span>{players.length} unique players</span></div>
        <div className="source-list">
          {files.length === 0 && <div className="empty-source">No ranking files yet</div>}
          {files.map((file, index) => (
            <div className="source-card" key={file.id}>
              <span className="drag">⋮⋮</span><span className="priority">{index + 1}</span>
              <div className="source-copy"><strong>{file.name.replace(/\.csv$/i, "")}</strong><small>{file.players.length} players · Priority {index + 1}</small></div>
              <div className="source-actions"><button aria-label="Move up" onClick={() => moveFile(index, -1)}>↑</button><button aria-label="Move down" onClick={() => moveFile(index, 1)}>↓</button><button aria-label="Remove" onClick={() => removeFile(file.id)}>×</button></div>
            </div>
          ))}
        </div>

        {players.length > 0 && <div className="tier-preview">
          <div className="section-heading"><div><h2>Make the board yours</h2><p>Edit your personal rank and tiers. The original expert rank stays visible for reference.</p></div><button className="text-button" onClick={resetRanks}>Reset expert order</button></div>
          <div className="tier-table">
            <div className="tier-table-head"><span>My rank</span><span>Pos</span><span>Player</span><span>Expert source</span><span>My tier</span></div>
            {[...players].sort((a, b) => a.rank - b.rank).slice(0, showAllRankings ? players.length : 12).map((player) => <div className="tier-row" key={player.id}><label className="rank-field"><span className="sr-only">Personal rank for {player.name}</span><input type="number" min="1" value={player.rank} onChange={(event) => updateRank(player.id, Number(event.target.value))} /></label><span className={`pos ${positionColors[player.position] || ""}`}>{player.position}</span><strong>{player.name}</strong><small>{player.team} · {player.source} #{player.sourceRank}</small><label>Tier <input type="number" min="1" value={player.tier} onChange={(event) => updateTier(player.id, Number(event.target.value))} /></label></div>)}
          </div>
          {players.length > 12 && <button className="show-more" onClick={() => setShowAllRankings((current) => !current)}>{showAllRankings ? "Show top 12" : `Edit all ${players.length} players`}</button>}
        </div>}
        <div className="setup-footer"><p>{notice}</p><button className="primary" disabled={!players.length} onClick={() => setStep("setup")}>Set up my draft <span>→</span></button></div>
      </section>
    </main>
  );

  if (step === "setup") return (
    <main className="app-shell setup-shell">
      <header className="topbar"><div className="brand"><span className="brand-mark">D</span><span>Draftroom</span></div><div className="stepper"><span>✓ Rankings</span><i /><span className="active">2 Draft setup</span><i /><span>3 Draft room</span></div><span className="saved">● Saved locally</span></header>
      <section className="draft-setup-card">
        <button className="back" onClick={() => setStep("rankings")}>← Back to rankings</button>
        <div className="eyebrow">LEAGUE SETTINGS</div><h1>Set the room.</h1><p className="lede">Tell us the table size and where you&apos;re sitting. You can change this before the first pick.</p>
        <div className="settings-grid">
          <label><span>Number of teams</span><select value={teams} onChange={(e) => { setTeams(Number(e.target.value)); setMySlot(Math.min(mySlot, Number(e.target.value))); }}>{[8,10,12,14,16].map(n => <option key={n}>{n}</option>)}</select><small>Common formats: 10 or 12 teams</small></label>
          <label><span>Your draft position</span><select value={mySlot} onChange={(e) => setMySlot(Number(e.target.value))}>{Array.from({length: teams}, (_, i) => i + 1).map(n => <option key={n} value={n}>Pick {n}</option>)}</select><small>Where you&apos;ll pick in round one</small></label>
        </div>
        <fieldset><legend>Draft order</legend><button className={snake ? "choice selected" : "choice"} onClick={() => setSnake(true)}><span className="choice-icon">↝</span><span><strong>Snake draft</strong><small>Order reverses every round</small></span><b>✓</b></button><button className={!snake ? "choice selected" : "choice"} onClick={() => setSnake(false)}><span className="choice-icon">→</span><span><strong>Linear draft</strong><small>Same order every round</small></span><b>✓</b></button></fieldset>
        <div className="seat-preview"><span>Your seat</span><strong>{mySlot}</strong><small>of {teams}</small><i>Round 1: pick {mySlot} · Round 2: pick {snake ? teams * 2 - mySlot + 1 : teams + mySlot}</i></div>
        <button className="primary full" onClick={() => setStep("draft")}>Enter draft room <span>→</span></button>
      </section>
    </main>
  );

  return (
    <main className="app-shell draft-shell">
      <header className="draft-topbar"><div className="brand"><span className="brand-mark">D</span><span>Draftroom</span></div><div className={onClock === mySlot ? "clock my-clock" : "clock"}><span>{onClock === mySlot ? "YOU'RE ON THE CLOCK" : `TEAM ${onClock} IS ON THE CLOCK`}</span><strong>Pick {nextPick}</strong><small>Round {round}</small></div><div className="draft-actions"><button onClick={undo} disabled={!picks.length}>↶ Undo</button><button onClick={() => setStep("setup")}>⚙ Settings</button></div></header>
      <section className="draft-grid">
        <aside className="recommend-panel"><div className="panel-title"><div><span className="eyebrow">YOUR BOARD</span><h2>Best available</h2></div><span>{available.length} left</span></div>
          <div className="recommendations">{recommendations.map((player, index) => <button className="recommend-card" key={player.id} onClick={() => draftPlayer(player)}><span className="recommend-rank">{index + 1}</span><div><strong>{player.name}</strong><small><span className={`pos ${positionColors[player.position] || ""}`}>{player.position}</span> {player.team} · Tier {player.tier}</small></div><span className="add-pick">Draft +</span></button>)}</div>
          <div className="filters"><div className="search"><span>⌕</span><input aria-label="Search available players" placeholder="Search players" value={search} onChange={(e) => setSearch(e.target.value)} /></div><div className="filter-row">{["ALL","RB","WR","QB","TE"].map(p => <button className={position === p ? "active" : ""} onClick={() => setPosition(p)} key={p}>{p}</button>)}</div></div>
          <div className="player-list">{filtered.slice(0, 60).map((player) => <button key={player.id} onClick={() => draftPlayer(player)}><b>{player.rank}</b><div><strong>{player.name}</strong><small>{player.team} · Tier {player.tier} · {player.source}</small></div><span className={`pos ${positionColors[player.position] || ""}`}>{player.position}</span><i>+</i></button>)}</div>
        </aside>
        <section className="board-panel"><div className="board-heading"><div><span className="eyebrow">LIVE DRAFT</span><h2>League rosters</h2></div><span>Round {round} of 16</span></div>
          <div className="roster-board">{Array.from({length: teams}, (_, i) => i + 1).map(team => <div className={team === mySlot ? "roster my-roster" : "roster"} key={team}><div className="roster-head"><span>{team === mySlot ? "YOU" : `TEAM ${team}`}</span>{team === onClock && <i>ON CLOCK</i>}</div>{picks.filter(p => p.roster === team).map(p => <div className="roster-player" key={p.pick}><span className={`pos ${positionColors[p.position] || ""}`}>{p.position}</span><div><strong>{p.name}</strong><small>{p.team} · Pick {p.pick}</small></div></div>)}{picks.filter(p => p.roster === team).length === 0 && <div className="empty-roster">No picks yet</div>}</div>)}</div>
        </section>
        <aside className="activity-panel"><div className="panel-title"><div><span className="eyebrow">PICK LOG</span><h2>Latest picks</h2></div><button onClick={undo} disabled={!picks.length}>Undo</button></div><div className="pick-log">{[...picks].reverse().map(p => <div key={p.pick}><b>{p.pick}</b><span className={`pos ${positionColors[p.position] || ""}`}>{p.position}</span><div><strong>{p.name}</strong><small>Team {p.roster} · {p.team}</small></div></div>)}{!picks.length && <div className="empty-log"><span>⌁</span><strong>The board is clean</strong><small>Select a player to record pick 1.</small></div>}</div></aside>
      </section>
    </main>
  );
}
