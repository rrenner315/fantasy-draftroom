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
  tier: number | null;
};

type RankingFile = { id: string; name: string; players: Player[] };
type DraftPick = Player & { pick: number; roster: number };
type DraftSession = { id: string; name: string; teams: number; mySlot: number; snake: boolean; picks: DraftPick[] };
type RankingSet = { id: string; name: string; files: RankingFile[]; players: Player[]; drafts: DraftSession[] };
type NameAction = { kind: "create-set" } | { kind: "create-draft"; setId: string } | { kind: "rename-set"; setId: string } | { kind: "rename-draft"; setId: string; draftId: string };
type DeleteAction = { kind: "set"; setId: string; name: string } | { kind: "draft"; setId: string; draftId: string; name: string };
type DesktopApi = {
  loadState: () => Promise<Record<string, unknown> | null>;
  saveState: (state: Record<string, unknown>) => Promise<string>;
  exportBackup: () => Promise<{ canceled: boolean; filePath?: string }>;
  importBackup: () => Promise<{ canceled: boolean }>;
  getStorageInfo: () => Promise<{ databasePath: string; backupsPath: string }>;
};

declare global { interface Window { draftroomDesktop?: DesktopApi } }

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

const tierValue = (player: Player) => player.tier ?? Number.MAX_SAFE_INTEGER;
const tierLabel = (player: Player) => player.tier === null ? "N/A" : player.tier;

export default function Home() {
  const hydrated = useRef(false);
  const [files, setFiles] = useState<RankingFile[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [step, setStep] = useState<"home" | "rankings" | "setup" | "draft">("home");
  const [teams, setTeams] = useState(12);
  const [mySlot, setMySlot] = useState(4);
  const [snake, setSnake] = useState(true);
  const [picks, setPicks] = useState<DraftPick[]>([]);
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState("ALL");
  const [showAllRankings, setShowAllRankings] = useState(false);
  const [notice, setNotice] = useState("Upload your first rankings file to get started.");
  const [rankingSets, setRankingSets] = useState<RankingSet[]>([]);
  const [activeSetId, setActiveSetId] = useState("");
  const [activeDraftId, setActiveDraftId] = useState("");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [nameAction, setNameAction] = useState<NameAction | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [deleteAction, setDeleteAction] = useState<DeleteAction | null>(null);
  const [desktopMode, setDesktopMode] = useState(false);
  const [saveStatus, setSaveStatus] = useState("Saved locally");

  useEffect(() => {
    let canceled = false;
    let timer = 0;
    const restore = async () => {
      try {
        const isDesktop = Boolean(window.draftroomDesktop);
        setDesktopMode(isDesktop);
        const storedState = isDesktop ? await window.draftroomDesktop!.loadState() : JSON.parse(localStorage.getItem("draftroom-state") || "null");
        if (canceled) return;
        if (storedState) {
          const state = storedState as { rankingSets?: RankingSet[]; activeSetId?: string; activeDraftId?: string; teams?: number; mySlot?: number; snake?: boolean; picks?: DraftPick[]; files?: RankingFile[]; players?: Player[] };
        if (state.rankingSets?.length) {
          const savedSet = state.rankingSets.find((set: RankingSet) => set.id === state.activeSetId) || state.rankingSets[0];
          const savedDraft = savedSet.drafts.find((draft: DraftSession) => draft.id === state.activeDraftId) || savedSet.drafts[0];
          setRankingSets(state.rankingSets);
          setActiveSetId(savedSet.id);
          setFiles(savedSet.files || []);
          setPlayers(savedSet.players || []);
          if (savedDraft) {
            setActiveDraftId(savedDraft.id);
            setTeams(savedDraft.teams);
            setMySlot(savedDraft.mySlot);
            setSnake(savedDraft.snake);
            setPicks(savedDraft.picks || []);
          }
        } else {
          const setId = `set-${Date.now()}`;
          const draftId = `draft-${Date.now()}`;
          const legacyDraft: DraftSession = { id: draftId, name: "My first draft", teams: state.teams || 12, mySlot: state.mySlot || 4, snake: state.snake ?? true, picks: state.picks || [] };
          const legacySet: RankingSet = { id: setId, name: "My rankings", files: state.files || [], players: state.players || [], drafts: [legacyDraft] };
          setRankingSets([legacySet]);
          setActiveSetId(setId);
          setActiveDraftId(draftId);
          setFiles(legacySet.files);
          setPlayers(legacySet.players);
          setTeams(legacyDraft.teams);
          setMySlot(legacyDraft.mySlot);
          setSnake(legacyDraft.snake);
          setPicks(legacyDraft.picks);
        }
        setStep("home");
        setNotice(isDesktop ? "Your ranking sets and drafts were restored from the local database." : "Your saved ranking sets and drafts were restored.");
      } else {
        const setId = `set-${Date.now()}`;
        setRankingSets([{ id: setId, name: "My rankings", files: [], players: [], drafts: [] }]);
        setActiveSetId(setId);
      }
      } catch { setNotice("Your saved board could not be restored, so we started fresh."); }
      timer = window.setTimeout(() => { hydrated.current = true; }, 0);
    };
    restore();
    return () => { canceled = true; window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    setRankingSets((current) => current.map((set) => set.id !== activeSetId ? set : {
      ...set,
      files,
      players,
      drafts: set.drafts.map((draft) => draft.id !== activeDraftId ? draft : { ...draft, teams, mySlot, snake, picks }),
    }));
  }, [files, players, teams, mySlot, snake, picks, activeSetId, activeDraftId]);

  useEffect(() => {
    if (!hydrated.current) return;
    const state = { version: 2, rankingSets, activeSetId, activeDraftId, step };
    if (window.draftroomDesktop) {
      setSaveStatus("Saving…");
      window.draftroomDesktop.saveState(state).then((savedAt) => setSaveStatus(`Saved ${new Date(savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`)).catch(() => setSaveStatus("Save failed"));
    } else {
      localStorage.setItem("draftroom-state", JSON.stringify(state));
      setSaveStatus("Saved locally");
    }
  }, [rankingSets, activeSetId, activeDraftId, step]);

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

  const updateTier = (id: string, tier: number | null) => setPlayers((current) => current.map((p) => p.id === id ? { ...p, tier: tier === null ? null : Math.max(1, tier || 1) } : p));
  const updateRank = (id: string, rank: number) => setPlayers((current) => current.map((p) => p.id === id ? { ...p, rank: Math.max(1, rank || 1) } : p));
  const resetRanks = () => setPlayers((current) => current.map((player, index) => ({ ...player, rank: index + 1 })));

  const draftedIds = new Set(picks.map((pick) => pick.id));
  const available = useMemo(() => players.filter((player) => !draftedIds.has(player.id)), [players, picks]);
  const filtered = available.filter((player) => (position === "ALL" || player.position === position) && player.name.toLowerCase().includes(search.toLowerCase())).sort((a, b) => tierValue(a) - tierValue(b) || a.rank - b.rank);
  const nextPick = picks.length + 1;
  const onClock = ownerForPick(nextPick, teams, snake);
  const round = Math.ceil(nextPick / teams);
  const recommendations = [...available].sort((a, b) => tierValue(a) - tierValue(b) || a.rank - b.rank).slice(0, 5);

  const draftPlayer = (player: Player) => {
    setPicks((current) => [...current, { ...player, pick: nextPick, roster: onClock }]);
    setSearch("");
  };

  const undo = () => setPicks((current) => current.slice(0, -1));

  const openRankingSet = (set: RankingSet, mode: "rankings" | "draft", draft?: DraftSession) => {
    setActiveSetId(set.id);
    setFiles(set.files);
    setPlayers(set.players);
    if (draft) {
      setActiveDraftId(draft.id);
      setTeams(draft.teams);
      setMySlot(draft.mySlot);
      setSnake(draft.snake);
      setPicks(draft.picks);
    } else {
      setActiveDraftId("");
      setTeams(12);
      setMySlot(4);
      setSnake(true);
      setPicks([]);
    }
    setStep(mode);
    setWorkspaceOpen(false);
  };

  const createRankingSet = () => {
    setNameInput(`Rankings set ${rankingSets.length + 1}`);
    setNameAction({ kind: "create-set" });
  };

  const createDraft = (set = rankingSets.find((item) => item.id === activeSetId)) => {
    if (!set || !set.players.length) {
      setNotice("Upload rankings before creating a draft.");
      setStep("rankings");
      setWorkspaceOpen(false);
      return;
    }
    setNameInput(`Draft ${set.drafts.length + 1}`);
    setNameAction({ kind: "create-draft", setId: set.id });
    setWorkspaceOpen(false);
  };

  const renameSet = (set: RankingSet) => {
    setNameInput(set.name);
    setNameAction({ kind: "rename-set", setId: set.id });
  };

  const renameDraft = (setId: string, draft: DraftSession) => {
    setNameInput(draft.name);
    setNameAction({ kind: "rename-draft", setId, draftId: draft.id });
  };

  const submitName = () => {
    const name = nameInput.trim();
    if (!name || !nameAction) return;
    if (nameAction.kind === "create-set") {
      const next: RankingSet = { id: `set-${Date.now()}`, name, files: [], players: [], drafts: [] };
      setRankingSets((current) => [...current, next]);
      openRankingSet(next, "rankings");
      setNotice(`Upload ranking files for ${name}.`);
    } else if (nameAction.kind === "create-draft") {
      const set = rankingSets.find((item) => item.id === nameAction.setId);
      if (set) {
        const draft: DraftSession = { id: `draft-${Date.now()}`, name, teams: 12, mySlot: 4, snake: true, picks: [] };
        setRankingSets((current) => current.map((item) => item.id === set.id ? { ...item, drafts: [...item.drafts, draft] } : item));
        setActiveSetId(set.id);
        setActiveDraftId(draft.id);
        setFiles(set.files);
        setPlayers(set.players);
        setTeams(draft.teams);
        setMySlot(draft.mySlot);
        setSnake(draft.snake);
        setPicks([]);
        setStep("setup");
      }
    } else if (nameAction.kind === "rename-set") {
      setRankingSets((current) => current.map((item) => item.id === nameAction.setId ? { ...item, name } : item));
    } else {
      setRankingSets((current) => current.map((set) => set.id === nameAction.setId ? { ...set, drafts: set.drafts.map((item) => item.id === nameAction.draftId ? { ...item, name } : item) } : set));
    }
    setNameAction(null);
    setNameInput("");
  };

  const confirmDelete = () => {
    if (!deleteAction) return;
    if (deleteAction.kind === "set") {
      setRankingSets((current) => current.filter((set) => set.id !== deleteAction.setId));
      if (activeSetId === deleteAction.setId) {
        setActiveSetId("");
        setActiveDraftId("");
        setFiles([]);
        setPlayers([]);
        setPicks([]);
      }
    } else {
      setRankingSets((current) => current.map((set) => set.id === deleteAction.setId ? { ...set, drafts: set.drafts.filter((draft) => draft.id !== deleteAction.draftId) } : set));
      if (activeDraftId === deleteAction.draftId) {
        setActiveDraftId("");
        setPicks([]);
      }
    }
    setDeleteAction(null);
    setWorkspaceOpen(false);
    setStep("home");
  };

  const activeSet = rankingSets.find((set) => set.id === activeSetId);
  const activeDraft = activeSet?.drafts.find((draft) => draft.id === activeDraftId);
  const exportBackup = async () => {
    const result = await window.draftroomDesktop?.exportBackup();
    if (result && !result.canceled) setSaveStatus("Backup exported");
    setWorkspaceOpen(false);
  };
  const importBackup = async () => {
    const result = await window.draftroomDesktop?.importBackup();
    if (result && !result.canceled) window.location.reload();
    setWorkspaceOpen(false);
  };
  const workspaceSwitcher = () => <div className="workspace-switcher">
    <button className="workspace-trigger" aria-label="Open navigation" aria-expanded={workspaceOpen} onClick={() => setWorkspaceOpen((open) => !open)}><span className="hamburger" aria-hidden="true"><i /><i /><i /></span></button>
    {workspaceOpen && <div className="workspace-menu">
      <div className="workspace-menu-title"><span>NAVIGATION</span><button onClick={createRankingSet}>＋ Rankings set</button></div>
      <button className={step === "home" ? "menu-home active" : "menu-home"} onClick={() => { setStep("home"); setWorkspaceOpen(false); }}><span>⌂</span><div><strong>Home</strong><small>All rankings and drafts</small></div><b>→</b></button>
      {desktopMode && <div className="backup-tools"><button onClick={exportBackup}><span>⇧</span> Export backup</button><button onClick={importBackup}><span>⇩</span> Restore backup</button></div>}
      <div className="menu-divider"><span>RANKINGS & DRAFTS</span></div>
      {rankingSets.map((set) => <div className={set.id === activeSetId ? "workspace-set active" : "workspace-set"} key={set.id}>
        <div className="workspace-set-head"><strong>{set.name}</strong><div className="workspace-item-actions"><button aria-label={`Rename ${set.name}`} onClick={() => renameSet(set)}>✎</button><button className="delete-icon" aria-label={`Delete ${set.name}`} onClick={() => setDeleteAction({ kind: "set", setId: set.id, name: set.name })}>×</button></div></div>
        <div className="workspace-links"><button onClick={() => openRankingSet(set, "rankings")}><span>✦</span> Edit rankings <small>{set.players.length} players</small></button>
          {set.drafts.map((draft) => <div className={draft.id === activeDraftId ? "workspace-draft selected" : "workspace-draft"} key={draft.id}><button onClick={() => openRankingSet(set, "draft", draft)}><span>▦</span> {draft.name}<small>{draft.picks.length} picks</small></button><div className="workspace-item-actions"><button aria-label={`Rename ${draft.name}`} onClick={() => renameDraft(set.id, draft)}>✎</button><button className="delete-icon" aria-label={`Delete ${draft.name}`} onClick={() => setDeleteAction({ kind: "draft", setId: set.id, draftId: draft.id, name: draft.name })}>×</button></div></div>)}
          <button className="new-draft-link" onClick={() => createDraft(set)}><span>＋</span> New draft</button>
        </div>
      </div>)}
    </div>}
  </div>;

  const nameDialog = nameAction && <div className="name-dialog-backdrop" role="presentation" onMouseDown={() => setNameAction(null)}><form className="name-dialog" role="dialog" aria-modal="true" aria-labelledby="name-dialog-title" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); submitName(); }}>
    <span className="eyebrow">ORGANIZE YOUR DRAFTROOM</span>
    <h2 id="name-dialog-title">{nameAction.kind === "create-set" ? "Name your rankings set" : nameAction.kind === "create-draft" ? "Name your draft" : nameAction.kind === "rename-set" ? "Rename rankings set" : "Rename draft"}</h2>
    <p>{nameAction.kind.includes("set") ? "Use a name that describes the scoring or strategy, like Half PPR or 2QB." : "Use a name that helps you recognize the league or draft date."}</p>
    <label><span>Name</span><input autoFocus maxLength={60} value={nameInput} onChange={(event) => setNameInput(event.target.value)} /></label>
    <div><button type="button" className="dialog-cancel" onClick={() => setNameAction(null)}>Cancel</button><button type="submit" className="primary" disabled={!nameInput.trim()}>Save name</button></div>
  </form></div>;
  const deleteDialog = deleteAction && <div className="name-dialog-backdrop" role="presentation" onMouseDown={() => setDeleteAction(null)}><div className="name-dialog delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
    <span className="delete-warning">!</span><div className="eyebrow">PERMANENTLY DELETE</div>
    <h2 id="delete-dialog-title">Delete “{deleteAction.name}”?</h2>
    <p>{deleteAction.kind === "set" ? "This removes the rankings, custom tiers, and every draft inside this set." : "This removes the draft settings, pick history, and team rosters. Your rankings set will remain."} This cannot be undone.</p>
    <div><button type="button" className="dialog-cancel" onClick={() => setDeleteAction(null)}>Keep it</button><button type="button" className="danger-button" onClick={confirmDelete}>Delete {deleteAction.kind === "set" ? "rankings set" : "draft"}</button></div>
  </div></div>;

  if (step === "home") return (
    <main className="app-shell home-shell">
      {nameDialog}
      {deleteDialog}
      <header className="topbar home-topbar">
        <button className="brand home-brand" onClick={() => setStep("home")}><span className="brand-mark">D</span><span>Draftroom</span></button>
        <span className={saveStatus === "Save failed" ? "home-saved save-error" : "home-saved"}>● {desktopMode ? saveStatus : "Everything saved locally"}</span>
        <div className="home-header-actions"><button className="header-primary" onClick={createRankingSet}>＋ New rankings set</button>{workspaceSwitcher()}</div>
      </header>
      <section className="home-wrap">
        <div className="home-hero"><div><div className="eyebrow">YOUR COMMAND CENTER</div><h1>Welcome to your draftroom.</h1><p className="lede">Build rankings once, then take them into as many drafts as you need.</p></div><div className="home-stats"><span><strong>{rankingSets.length}</strong> ranking {rankingSets.length === 1 ? "set" : "sets"}</span><i /><span><strong>{rankingSets.reduce((total, set) => total + set.drafts.length, 0)}</strong> total drafts</span></div></div>
        <div className="home-section-head"><div><h2>Your rankings</h2><p>Each set keeps its own expert sources, custom order, and tiers.</p></div><button onClick={createRankingSet}>＋ Create rankings set</button></div>
        <div className="ranking-set-grid">
          {rankingSets.map((set) => <article className="ranking-home-card" key={set.id}>
            <div className="ranking-card-head"><div className="set-icon">≡</div><div><h3>{set.name}</h3><p>{set.players.length} players · {set.files.length} source {set.files.length === 1 ? "file" : "files"}</p></div><div className="card-item-actions"><button aria-label={`Rename ${set.name}`} onClick={() => renameSet(set)}>✎</button><button className="delete-icon" aria-label={`Delete ${set.name}`} onClick={() => setDeleteAction({ kind: "set", setId: set.id, name: set.name })}>×</button></div></div>
            <div className="ranking-card-actions"><button onClick={() => openRankingSet(set, "rankings")}><span>✦</span><div><strong>Edit rankings</strong><small>Sources, order & tiers</small></div><b>→</b></button><button onClick={() => createDraft(set)} disabled={!set.players.length}><span>＋</span><div><strong>Start new draft</strong><small>{set.players.length ? "Use this ranking set" : "Add rankings first"}</small></div><b>→</b></button></div>
            <div className="card-drafts-head"><span>DRAFTS</span><small>{set.drafts.length}</small></div>
            <div className="home-draft-list">{set.drafts.map((draft) => <div className="home-draft-row" key={draft.id}><span className="draft-status">{draft.picks.length ? "LIVE" : "NEW"}</span><div><strong>{draft.name}</strong><small>{draft.teams} teams · Pick {draft.picks.length + 1} · {draft.snake ? "Snake" : "Linear"}</small></div><div className="draft-row-actions"><button onClick={() => openRankingSet(set, "draft", draft)}>{draft.picks.length ? "Continue" : "Open"} →</button><button className="delete-icon" aria-label={`Delete ${draft.name}`} onClick={() => setDeleteAction({ kind: "draft", setId: set.id, draftId: draft.id, name: draft.name })}>×</button></div></div>)}{!set.drafts.length && <div className="no-drafts"><span>⌁</span><p>No drafts started with this set yet.</p></div>}</div>
          </article>)}
          <button className="new-set-card" onClick={createRankingSet}><span>＋</span><strong>Create rankings set</strong><small>Upload a different package for 2QB, PPR, dynasty, or another format.</small></button>
        </div>
      </section>
    </main>
  );

  if (step === "rankings") return (
    <main className="app-shell setup-shell">
      {nameDialog}
      {deleteDialog}
      <header className="topbar">
        <button className="brand home-brand" onClick={() => setStep("home")}><span className="brand-mark">D</span><span>Draftroom</span></button>
        <div className="stepper"><span className="active">1 Rankings</span><i /> <span>2 Draft setup</span><i /> <span>3 Draft room</span></div>
        {workspaceSwitcher()}
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
          <div className="section-heading"><div><h2>Make the board yours</h2><p>Edit your personal rank and tiers. Set lower-priority players to N/A and they&apos;ll drop below every numbered tier.</p></div><button className="text-button" onClick={resetRanks}>Reset expert order</button></div>
          <div className="tier-table">
            <div className="tier-table-head"><span>My rank</span><span>Pos</span><span>Player</span><span>Expert source</span><span>My tier</span></div>
            {[...players].sort((a, b) => a.rank - b.rank).slice(0, showAllRankings ? players.length : 12).map((player) => <div className="tier-row" key={player.id}><label className="rank-field"><span className="sr-only">Personal rank for {player.name}</span><input type="number" min="1" value={player.rank} onChange={(event) => updateRank(player.id, Number(event.target.value))} /></label><span className={`pos ${positionColors[player.position] || ""}`}>{player.position}</span><strong>{player.name}</strong><small>{player.team} · {player.source} #{player.sourceRank}</small><div className="tier-control"><label><span className="sr-only">Tier for {player.name}</span><input type="number" min="1" placeholder="—" value={player.tier ?? ""} onChange={(event) => updateTier(player.id, event.target.value === "" ? null : Number(event.target.value))} /></label><button className={player.tier === null ? "selected" : ""} onClick={() => updateTier(player.id, player.tier === null ? 1 : null)}>N/A</button></div></div>)}
          </div>
          {players.length > 12 && <button className="show-more" onClick={() => setShowAllRankings((current) => !current)}>{showAllRankings ? "Show top 12" : `Edit all ${players.length} players`}</button>}
        </div>}
        <div className="setup-footer"><p>{notice}</p><button className="primary" disabled={!players.length} onClick={() => activeDraftId ? setStep("setup") : createDraft()}>Set up a draft <span>→</span></button></div>
      </section>
    </main>
  );

  if (step === "setup") return (
    <main className="app-shell setup-shell">
      {nameDialog}
      {deleteDialog}
      <header className="topbar"><button className="brand home-brand" onClick={() => setStep("home")}><span className="brand-mark">D</span><span>Draftroom</span></button><div className="stepper"><span>✓ Rankings</span><i /><span className="active">2 Draft setup</span><i /><span>3 Draft room</span></div>{workspaceSwitcher()}</header>
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
      {nameDialog}
      {deleteDialog}
      <header className="draft-topbar"><button className="brand home-brand" onClick={() => setStep("home")}><span className="brand-mark">D</span><span>Draftroom</span></button><div className={onClock === mySlot ? "clock my-clock" : "clock"}><span>{onClock === mySlot ? "YOU'RE ON THE CLOCK" : `TEAM ${onClock} IS ON THE CLOCK`}</span><strong>Pick {nextPick}</strong><small>Round {round}</small></div><div className="draft-actions">{workspaceSwitcher()}<button onClick={undo} disabled={!picks.length}>↶ Undo</button><button onClick={() => setStep("setup")}>⚙ Settings</button></div></header>
      <section className="draft-grid">
        <aside className="recommend-panel"><div className="panel-title"><div><span className="eyebrow">YOUR BOARD</span><h2>Best available</h2></div><span>{available.length} left</span></div>
          <div className="recommendations">{recommendations.map((player, index) => <button className="recommend-card" key={player.id} onClick={() => draftPlayer(player)}><span className="recommend-rank">{index + 1}</span><div><strong>{player.name}</strong><small><span className={`pos ${positionColors[player.position] || ""}`}>{player.position}</span> {player.team} · Tier {tierLabel(player)}</small></div><span className="add-pick">Draft +</span></button>)}</div>
          <div className="filters"><div className="search"><span>⌕</span><input aria-label="Search available players" placeholder="Search players" value={search} onChange={(e) => setSearch(e.target.value)} /></div><div className="filter-row">{["ALL","RB","WR","QB","TE"].map(p => <button className={position === p ? "active" : ""} onClick={() => setPosition(p)} key={p}>{p}</button>)}</div></div>
          <div className="player-list">{filtered.slice(0, 60).map((player) => <button key={player.id} onClick={() => draftPlayer(player)}><b>{player.rank}</b><div><strong>{player.name}</strong><small>{player.team} · Tier {tierLabel(player)} · {player.source}</small></div><span className={`pos ${positionColors[player.position] || ""}`}>{player.position}</span><i>+</i></button>)}</div>
        </aside>
        <section className="board-panel"><div className="board-heading"><div><span className="eyebrow">LIVE DRAFT</span><h2>League rosters</h2></div><span>Round {round} of 16</span></div>
          <div className="roster-board">{Array.from({length: teams}, (_, i) => i + 1).map(team => <div className={team === mySlot ? "roster my-roster" : "roster"} key={team}><div className="roster-head"><span>{team === mySlot ? "YOU" : `TEAM ${team}`}</span>{team === onClock && <i>ON CLOCK</i>}</div>{picks.filter(p => p.roster === team).map(p => <div className="roster-player" key={p.pick}><span className={`pos ${positionColors[p.position] || ""}`}>{p.position}</span><div><strong>{p.name}</strong><small>{p.team} · Pick {p.pick}</small></div></div>)}{picks.filter(p => p.roster === team).length === 0 && <div className="empty-roster">No picks yet</div>}</div>)}</div>
        </section>
        <aside className="activity-panel"><div className="panel-title"><div><span className="eyebrow">PICK LOG</span><h2>Latest picks</h2></div><button onClick={undo} disabled={!picks.length}>Undo</button></div><div className="pick-log">{[...picks].reverse().map(p => <div key={p.pick}><b>{p.pick}</b><span className={`pos ${positionColors[p.position] || ""}`}>{p.position}</span><div><strong>{p.name}</strong><small>Team {p.roster} · {p.team}</small></div></div>)}{!picks.length && <div className="empty-log"><span>⌁</span><strong>The board is clean</strong><small>Select a player to record pick 1.</small></div>}</div></aside>
      </section>
    </main>
  );
}
