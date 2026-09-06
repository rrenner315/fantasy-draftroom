"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import readXlsxFile, { readSheetNames } from "read-excel-file";
import { findAutomaticPlayerMatch, normalizePlayerName, rankPlayerMatches } from "./name-matching.mjs";
import { parseDelimitedText, parseRankingRows } from "./ranking-parser.mjs";
import { parseTierRows } from "./tier-parser.mjs";

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
type LeagueProvider = "none" | "espn" | "sleeper" | "yahoo";
type DraftSession = { id: string; name: string; teams: number; mySlot: number; snake: boolean; picks: DraftPick[]; teamNames?: Record<string, string>; leagueProvider?: LeagueProvider; leagueFormat?: string; platformRanks?: Record<string, number>; watchlistIds?: string[] };
type RankingSet = { id: string; name: string; files: RankingFile[]; players: Player[]; drafts: DraftSession[] };
type NameAction = { kind: "create-set" } | { kind: "create-draft"; setId: string } | { kind: "rename-set"; setId: string } | { kind: "rename-draft"; setId: string; draftId: string } | { kind: "rename-team"; team: number };
type DeleteAction = { kind: "set"; setId: string; name: string } | { kind: "draft"; setId: string; draftId: string; name: string };
type DesktopApi = {
  loadState: () => Promise<Record<string, unknown> | null>;
  saveState: (state: Record<string, unknown>) => Promise<string>;
  exportBackup: () => Promise<{ canceled: boolean; filePath?: string }>;
  importBackup: () => Promise<{ canceled: boolean }>;
  getStorageInfo: () => Promise<{ databasePath: string; backupsPath: string }>;
  loadFfcRankings: (format: string, teams: number) => Promise<FfcResponse>;
  loadSleeperRankings: (format: string) => Promise<FfcResponse>;
  loadEspnRankings: (format: string) => Promise<FfcResponse>;
  loadYahooRankings: (format: string) => Promise<FfcResponse>;
};

type FfcPlayer = { player_id: number | string; name: string; position: string; team: string; adp: number };
type FfcResponse = { status: string; meta?: { type?: string; teams?: number; total_drafts?: number; start_date?: string; end_date?: string }; players: FfcPlayer[] };
type TierAssignment = { name: string; position: string; team: string; tier: number };
type UnresolvedTierMatch = TierAssignment & { id: string; candidates: { id: string; name: string; position: string; team: string; score: number }[] };
type OnlineProvider = "ffc" | "sleeper" | "espn" | "yahoo";

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

const expertSources: { id: OnlineProvider; name: string; description: string }[] = [
  { id: "ffc", name: "Fantasy Football Calculator", description: "Draft ADP with league-size options" },
  { id: "sleeper", name: "Sleeper", description: "Platform ADP across four scoring formats" },
  { id: "espn", name: "ESPN", description: "ESPN's current preseason draft ranks" },
  { id: "yahoo", name: "Yahoo", description: "Public Standard-scoring draft ADP" },
];

const formatNames: Record<string, string> = { standard: "Standard", "half-ppr": "Half-PPR", ppr: "PPR", "2qb": "2QB", superflex: "Superflex" };

function rankingRecordsToPlayers(records: { name: string; position: string; team: string; sourceRank: number }[], sourceName: string): Player[] {
  return records.map((record, index) => ({
    id: `${sourceName}-${record.name}-${index}`,
    name: record.name,
    position: record.position,
    team: record.team,
    rank: record.sourceRank,
    source: sourceName.replace(/\.(csv|tsv|xlsx)$/i, ""),
    sourceRank: record.sourceRank,
    tier: Math.ceil(record.sourceRank / 12),
  }));
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
  const [teamNames, setTeamNames] = useState<Record<string, string>>({});
  const [pickTimerSeconds, setPickTimerSeconds] = useState(0);
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState("ALL");
  const [draftCenterView, setDraftCenterView] = useState<"rosters" | "tiers">("rosters");
  const [sidePanelMode, setSidePanelMode] = useState<"none" | "signals" | "watchlist">("signals");
  const [watchlistIds, setWatchlistIds] = useState<string[]>([]);
  const [showAllRankings, setShowAllRankings] = useState(false);
  const [rankInputs, setRankInputs] = useState<Record<string, string>>({});
  const [draggedPlayerId, setDraggedPlayerId] = useState<string | null>(null);
  const [dragOverPlayerId, setDragOverPlayerId] = useState<string | null>(null);
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
  const [onlineFormat, setOnlineFormat] = useState("half-ppr");
  const [onlineTeams, setOnlineTeams] = useState(12);
  const [onlineProvider, setOnlineProvider] = useState<OnlineProvider>("ffc");
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [leagueProvider, setLeagueProvider] = useState<LeagueProvider>("none");
  const [leagueFormat, setLeagueFormat] = useState("half-ppr");
  const [platformRanks, setPlatformRanks] = useState<Record<string, number>>({});
  const [leagueRanksLoading, setLeagueRanksLoading] = useState(false);
  const [expertImporterOpen, setExpertImporterOpen] = useState(false);
  const [tierImporterOpen, setTierImporterOpen] = useState(false);
  const [tierFileName, setTierFileName] = useState("");
  const [unresolvedTierMatches, setUnresolvedTierMatches] = useState<UnresolvedTierMatch[]>([]);
  const [tierMatchSelections, setTierMatchSelections] = useState<Record<string, string>>( {} );

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
            setTeamNames(savedDraft.teamNames || {});
            setLeagueProvider(savedDraft.leagueProvider || "none");
            setLeagueFormat(savedDraft.leagueFormat || "half-ppr");
            setPlatformRanks(savedDraft.platformRanks || {});
            setWatchlistIds(savedDraft.watchlistIds || []);
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
      drafts: set.drafts.map((draft) => draft.id !== activeDraftId ? draft : { ...draft, teams, mySlot, snake, picks, teamNames, leagueProvider, leagueFormat, platformRanks, watchlistIds }),
    }));
  }, [files, players, teams, mySlot, snake, picks, teamNames, leagueProvider, leagueFormat, platformRanks, watchlistIds, activeSetId, activeDraftId]);

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

  useEffect(() => {
    setPickTimerSeconds(0);
    if (step !== "draft") return;
    const timer = window.setInterval(() => setPickTimerSeconds((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(timer);
  }, [step, picks.length]);

  const mergeFiles = (nextFiles: RankingFile[]) => {
    const merged: Player[] = [];
    nextFiles.forEach((file) => file.players.forEach((player) => {
      if (findAutomaticPlayerMatch(player, merged)) return;
      const baseId = normalizePlayerName(player.name) || `player-${merged.length + 1}`;
      const id = merged.some((existing) => existing.id === baseId) ? `${baseId}-${player.position}-${merged.length + 1}` : baseId;
      merged.push({ ...player, id });
    }));
    setPlayers(merged.map((player, index) => ({ ...player, rank: index + 1 })));
  };

  const applyTierWorkbook = async (incoming: FileList | null) => {
    const file = incoming?.[0];
    if (!file) return;
    try {
      let assignments: TierAssignment[] = [];
      if (/\.xlsx$/i.test(file.name)) {
        const sheetNames = await readSheetNames(file);
        const candidates: TierAssignment[][] = [];
        for (const sheetName of sheetNames) {
          try { candidates.push(parseTierRows(await readXlsxFile(file, { sheet: sheetName }) as unknown[][])); } catch { /* Skip notes and cover sheets. */ }
        }
        candidates.sort((left, right) => right.length - left.length);
        if (!candidates.length) throw new Error("No worksheet contained a recognizable tier layout.");
        assignments = candidates[0];
      } else {
        assignments = parseTierRows(parseDelimitedText(await file.text())) as TierAssignment[];
      }
      const usedPlayerIds = new Set<string>();
      const matchedTiers = new Map<string, number>();
      const unresolved: UnresolvedTierMatch[] = [];
      assignments.forEach((assignment, index) => {
        const automatic = findAutomaticPlayerMatch(assignment, players, usedPlayerIds) as Player | null;
        if (automatic) {
          usedPlayerIds.add(automatic.id);
          matchedTiers.set(automatic.id, assignment.tier);
          return;
        }
        const samePosition = players.filter((player) => player.position === assignment.position && !usedPlayerIds.has(player.id));
        const ranked = rankPlayerMatches(assignment, samePosition).slice(0, 8) as { player: Player; score: number }[];
        if (ranked[0]?.score >= 0.62) unresolved.push({ ...assignment, id: `tier-match-${index}-${normalizePlayerName(assignment.name)}`, candidates: ranked.map(({ player, score }) => ({ id: player.id, name: player.name, position: player.position, team: player.team, score })) });
      });
      if (!matchedTiers.size && !unresolved.length) throw new Error("None of the spreadsheet players matched the players on this board.");
      setPlayers((current) => current.map((player) => ({ ...player, tier: matchedTiers.get(player.id) ?? null })));
      setTierFileName(file.name);
      setTierImporterOpen(false);
      setUnresolvedTierMatches(unresolved);
      setTierMatchSelections({});
      setNotice(unresolved.length ? `${matchedTiers.size} players matched automatically. Review ${unresolved.length} possible name ${unresolved.length === 1 ? "mismatch" : "mismatches"}.` : `${matchedTiers.size} players received tiers from ${file.name}. ${players.length - matchedTiers.size} unlisted players were set to N/A.`);
    } catch (error) {
      setNotice(`${file.name}: ${error instanceof Error ? error.message : "Could not read this tier workbook"}`);
    }
  };

  const finishTierMatching = () => {
    const selectedTiers = new Map(unresolvedTierMatches.flatMap((match) => tierMatchSelections[match.id] ? [[tierMatchSelections[match.id], match.tier] as [string, number]] : []));
    setPlayers((current) => current.map((player) => selectedTiers.has(player.id) ? { ...player, tier: selectedTiers.get(player.id)! } : player));
    const matchedCount = selectedTiers.size;
    setUnresolvedTierMatches([]);
    setTierMatchSelections({});
    setNotice(`${matchedCount} additional ${matchedCount === 1 ? "name was" : "names were"} matched manually. Unlisted players remain N/A.`);
  };

  const downloadTierTemplate = (layout: "table" | "positions") => {
    const csv = layout === "table"
      ? "Player Name,Position,Team,Tier Number\r\n"
      : "QB,,,RB,,,WR,,,TE,,\r\nPlayer Name,Team,Tier Number,Player Name,Team,Tier Number,Player Name,Team,Tier Number,Player Name,Team,Tier Number\r\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = layout === "table" ? "The-Program-Tier-Template-Player-Table.csv" : "The-Program-Tier-Template-By-Position.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const addFiles = async (incoming: FileList | null) => {
    if (!incoming) return;
    const parsed: RankingFile[] = [];
    for (const file of Array.from(incoming)) {
      try {
        let sourceName = file.name;
        let parsedRows: { records: { name: string; position: string; team: string; sourceRank: number }[]; columns: Record<string, number> };
        if (/\.xlsx$/i.test(file.name)) {
          const sheetNames = await readSheetNames(file);
          const candidates: { sheetName: string; parsedRows: typeof parsedRows }[] = [];
          for (const sheetName of sheetNames) {
            try {
              candidates.push({ sheetName, parsedRows: parseRankingRows(await readXlsxFile(file, { sheet: sheetName }) as unknown[][]) as typeof parsedRows });
            } catch { /* A workbook may contain cover or notes sheets without rankings. */ }
          }
          candidates.sort((left, right) => right.parsedRows.records.length - left.parsedRows.records.length || Object.keys(right.parsedRows.columns).length - Object.keys(left.parsedRows.columns).length);
          if (!candidates.length) throw new Error("No worksheet contained a recognizable player-name header and ranking table.");
          parsedRows = candidates[0].parsedRows;
          if (sheetNames.length > 1) sourceName = `${file.name} · ${candidates[0].sheetName}`;
        } else {
          parsedRows = parseRankingRows(parseDelimitedText(await file.text())) as typeof parsedRows;
        }
        const filePlayers = rankingRecordsToPlayers(parsedRows.records, sourceName);
        parsed.push({ id: `${file.name}-${Date.now()}-${parsed.length}`, name: sourceName, players: filePlayers });
      } catch (error) {
        setNotice(`${file.name}: ${error instanceof Error ? error.message : "Could not read this file"}`);
      }
    }
    const next = [...files, ...parsed];
    setFiles(next);
    mergeFiles(next);
    if (parsed.length) setNotice(`${parsed.length} ranking ${parsed.length === 1 ? "sheet" : "sheets"} added. Headers were detected automatically; earlier sources take priority.`);
  };

  const fetchPlatformDefaults = async (provider: Exclude<LeagueProvider, "none">, format: string) => {
    const endpoint = `/api/rankings/${provider}?format=${encodeURIComponent(format)}`;
    if (window.draftroomDesktop) {
      if (provider === "yahoo") return window.draftroomDesktop.loadYahooRankings(format);
      if (provider === "espn") return window.draftroomDesktop.loadEspnRankings(format);
      return window.draftroomDesktop.loadSleeperRankings(format);
    }
    return fetch(endpoint).then(async (result) => {
      if (!result.ok) throw new Error(await result.text());
      return result.json() as Promise<FfcResponse>;
    });
  };

  const enterDraftRoom = async () => {
    if (leagueProvider === "none") {
      setPlatformRanks({});
      setStep("draft");
      return;
    }
    setLeagueRanksLoading(true);
    setNotice(`Loading ${leagueProvider === "espn" ? "ESPN" : leagueProvider === "yahoo" ? "Yahoo" : "Sleeper"} default ranks…`);
    try {
      const response = await fetchPlatformDefaults(leagueProvider, leagueFormat);
      if (!Array.isArray(response.players) || !response.players.length) throw new Error("No default rankings were returned.");
      const ranks: Record<string, number> = {};
      response.players.forEach((defaultPlayer) => {
        const match = findAutomaticPlayerMatch(defaultPlayer, players) as Player | null;
        if (match) ranks[match.id] = Math.round(Number(defaultPlayer.adp));
      });
      setPlatformRanks(ranks);
      setNotice(`${Object.keys(ranks).length} players matched to the platform's default draft order.`);
    } catch (error) {
      setPlatformRanks({});
      setNotice(`Default rankings could not be loaded: ${error instanceof Error ? error.message : "provider unavailable"}. You can still use the draft room.`);
    } finally {
      setLeagueRanksLoading(false);
      setStep("draft");
    }
  };

  const loadOnlineRankings = async () => {
    setOnlineLoading(true);
    setNotice("Loading the latest draft data…");
    try {
      const endpoint = onlineProvider === "yahoo"
        ? `/api/rankings/yahoo?format=${encodeURIComponent(onlineFormat)}`
        : onlineProvider === "espn"
        ? `/api/rankings/espn?format=${encodeURIComponent(onlineFormat)}`
        : onlineProvider === "sleeper"
          ? `/api/rankings/sleeper?format=${encodeURIComponent(onlineFormat)}`
          : `/api/rankings/ffc?format=${encodeURIComponent(onlineFormat)}&teams=${onlineTeams}`;
      const response = window.draftroomDesktop
        ? onlineProvider === "yahoo"
          ? await window.draftroomDesktop.loadYahooRankings(onlineFormat)
          : onlineProvider === "espn"
          ? await window.draftroomDesktop.loadEspnRankings(onlineFormat)
          : onlineProvider === "sleeper"
            ? await window.draftroomDesktop.loadSleeperRankings(onlineFormat)
            : await window.draftroomDesktop.loadFfcRankings(onlineFormat, onlineTeams)
        : await fetch(endpoint).then(async (result) => {
            if (!result.ok) throw new Error(await result.text());
            return result.json() as Promise<FfcResponse>;
          });
      if (!Array.isArray(response.players) || !response.players.length) throw new Error("No players were returned.");

      const formatLabel = ({ standard: "Standard", "half-ppr": "Half-PPR", ppr: "PPR", "2qb": "2QB", superflex: "Superflex" } as Record<string, string>)[onlineFormat] || onlineFormat;
      const loadedAt = new Date();
      const providerLabel = onlineProvider === "yahoo" ? "Yahoo ADP" : onlineProvider === "espn" ? "ESPN Rankings" : onlineProvider === "sleeper" ? "Sleeper ADP" : "FFC ADP";
      const leagueLabel = onlineProvider === "ffc" ? ` · ${onlineTeams} teams` : "";
      const sourceName = `${providerLabel} · ${formatLabel}${leagueLabel} · ${loadedAt.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`;
      const importedPlayers: Player[] = response.players.map((player, index) => ({
        id: `${onlineProvider}-${player.player_id}`,
        name: player.name,
        position: player.position === "PK" ? "K" : player.position.toUpperCase(),
        team: (player.team || "FA").toUpperCase(),
        rank: index + 1,
        source: sourceName,
        sourceRank: index + 1,
        tier: Math.ceil((index + 1) / 12),
      }));
      const rankingFile: RankingFile = { id: `${onlineProvider}-${onlineFormat}-${onlineTeams}-${loadedAt.getTime()}`, name: sourceName, players: importedPlayers };
      const next = [...files, rankingFile];
      setFiles(next);
      mergeFiles(next);
      const draftCount = response.meta?.total_drafts ? ` from ${response.meta.total_drafts.toLocaleString()} drafts` : "";
      setNotice(`${importedPlayers.length} players loaded${draftCount}. This snapshot will stay unchanged until you load a new one.`);
      setExpertImporterOpen(false);
    } catch {
      const providerName = onlineProvider === "yahoo" ? "Yahoo" : onlineProvider === "espn" ? "ESPN" : onlineProvider === "sleeper" ? "Sleeper" : "Fantasy Football Calculator";
      setNotice(`We couldn't reach ${providerName}. Check your internet connection and try again; your current rankings were not changed.`);
    } finally {
      setOnlineLoading(false);
    }
  };

  const chooseExpertSource = (provider: OnlineProvider) => {
    setOnlineProvider(provider);
    if (provider === "yahoo") setOnlineFormat("standard");
    else if (provider === "espn" && !["standard", "ppr", "superflex"].includes(onlineFormat)) setOnlineFormat("ppr");
    else if (provider !== "espn" && onlineFormat === "superflex") setOnlineFormat("2qb");
  };

  const chooseLeagueProvider = (provider: LeagueProvider) => {
    setLeagueProvider(provider);
    setPlatformRanks({});
    if (provider === "yahoo") setLeagueFormat("standard");
    else if (provider === "espn" && !["standard", "ppr", "superflex"].includes(leagueFormat)) setLeagueFormat("ppr");
    else if (provider === "sleeper" && leagueFormat === "superflex") setLeagueFormat("2qb");
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
  const movePlayerToRank = (id: string, requestedRank: number) => setPlayers((current) => {
    const ordered = [...current].sort((a, b) => a.rank - b.rank);
    const movingIndex = ordered.findIndex((player) => player.id === id);
    if (movingIndex < 0) return current;

    const [moving] = ordered.splice(movingIndex, 1);
    const destination = Math.min(Math.max(requestedRank, 1), ordered.length + 1) - 1;
    ordered.splice(destination, 0, moving);

    const ranks = new Map(ordered.map((player, index) => [player.id, index + 1]));
    return current.map((player) => ({ ...player, rank: ranks.get(player.id) ?? player.rank }));
  });
  const commitRank = (player: Player) => {
    const draft = rankInputs[player.id];
    if (draft !== undefined) {
      const nextRank = Number.parseInt(draft, 10);
      if (Number.isFinite(nextRank) && nextRank > 0) movePlayerToRank(player.id, nextRank);
      setRankInputs((current) => { const next = { ...current }; delete next[player.id]; return next; });
    }
  };
  const reorderPlayer = (movingId: string, targetId: string) => {
    if (movingId === targetId) return;
    setPlayers((current) => {
      const ordered = [...current].sort((a, b) => a.rank - b.rank);
      const movingIndex = ordered.findIndex((player) => player.id === movingId);
      if (movingIndex < 0) return current;
      const [moving] = ordered.splice(movingIndex, 1);
      const targetIndex = ordered.findIndex((player) => player.id === targetId);
      if (targetIndex < 0) return current;
      ordered.splice(targetIndex, 0, moving);
      const ranks = new Map(ordered.map((player, index) => [player.id, index + 1]));
      return current.map((player) => ({ ...player, rank: ranks.get(player.id) || player.rank }));
    });
    setDraggedPlayerId(null);
    setDragOverPlayerId(null);
    setRankInputs({});
  };
  const resetRanks = () => setPlayers((current) => current.map((player, index) => ({ ...player, rank: index + 1 })));

  const draftedIds = new Set(picks.map((pick) => pick.id));
  const available = useMemo(() => players.filter((player) => !draftedIds.has(player.id)), [players, picks]);
  const watchlist = available.filter((player) => watchlistIds.includes(player.id)).sort((a, b) => a.rank - b.rank);
  const filtered = available.filter((player) => (position === "ALL" || player.position === position || (position === "FLEX" && ["RB", "WR", "TE"].includes(player.position))) && player.name.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.rank - b.rank);
  const nextPick = picks.length + 1;
  const onClock = ownerForPick(nextPick, teams, snake);
  const round = Math.ceil(nextPick / teams);
  const pickTimerLabel = `${Math.floor(pickTimerSeconds / 60)}:${String(pickTimerSeconds % 60).padStart(2, "0")}`;
  const leagueProviderName = leagueProvider === "espn" ? "ESPN" : leagueProvider === "yahoo" ? "Yahoo" : leagueProvider === "sleeper" ? "Sleeper" : "Platform";
  const teamDisplayName = (team: number) => team === mySlot ? "YOU" : teamNames[String(team)] || `TEAM ${team}`;
  const marketInsight = (player: Player) => {
    const platformRank = platformRanks[player.id];
    if (!platformRank) return null;
    const difference = platformRank - player.rank;
    if (Math.abs(difference) < teams) return null;
    return difference > 0
      ? { kind: "wait", label: "May last", detail: `${leagueProviderName} #${platformRank}` }
      : { kind: "early", label: "Going early", detail: `${leagueProviderName} #${platformRank}` };
  };
  const strategyBadge = (player: Player) => {
    const insight = marketInsight(player);
    return insight ? <span className={`strategy-badge strategy-${insight.kind}`}><b>{insight.label}</b><i>{insight.detail}</i></span> : null;
  };
  let nextUserPick = nextPick;
  while (ownerForPick(nextUserPick, teams, snake) !== mySlot && nextUserPick < nextPick + teams) nextUserPick++;
  const picksUntilMine = nextUserPick - nextPick;
  const draftSignals: { kind: string; title: string; detail: string }[] = [];
  const tierCliffs = ["RB", "WR", "QB", "TE"].flatMap((signalPosition) => {
    const positionPlayers = available.filter((player) => player.position === signalPosition && player.tier !== null).sort((a, b) => tierValue(a) - tierValue(b) || a.rank - b.rank);
    if (!positionPlayers.length) return [];
    const topTier = positionPlayers[0].tier;
    const remaining = positionPlayers.filter((player) => player.tier === topTier);
    return remaining.length <= 3 ? [{ position: signalPosition, tier: topTier, remaining }] : [];
  }).sort((left, right) => left.remaining.length - right.remaining.length).slice(0, 2);
  tierCliffs.forEach((cliff) => draftSignals.push({ kind: "cliff", title: `${cliff.remaining.length === 1 ? "Last" : cliff.remaining.length} Tier ${cliff.tier} ${cliff.position}${cliff.remaining.length === 1 ? "" : "s"}`, detail: cliff.remaining.map((player) => player.name).join(" · ") }));
  const myRosterPicks = picks.filter((pick) => pick.roster === mySlot);
  const upcomingPlayers = [...available].sort((left, right) => left.rank - right.rank).slice(0, Math.max(teams * 2, 20));
  const stackOpportunity = upcomingPlayers.map((candidate) => {
    const partner = myRosterPicks.find((owned) => owned.team && owned.team === candidate.team && ((owned.position === "QB" && ["WR", "TE"].includes(candidate.position)) || (candidate.position === "QB" && ["WR", "TE"].includes(owned.position))));
    return partner ? { candidate, partner } : null;
  }).find((pair) => pair !== null);
  if (stackOpportunity) draftSignals.push({ kind: "stack", title: `Stack ${stackOpportunity.candidate.name}`, detail: `${stackOpportunity.candidate.position} pairs with your ${stackOpportunity.partner.name} · ${stackOpportunity.candidate.team}` });
  const recentPicks = picks.slice(-8);
  const recentRun = ["RB", "WR", "QB", "TE"].map((runPosition) => ({ position: runPosition, count: recentPicks.filter((pick) => pick.position === runPosition).length })).sort((left, right) => right.count - left.count)[0];
  if (recentRun?.count >= 3) draftSignals.push({ kind: "run", title: `${recentRun.position} run`, detail: `${recentRun.count} selected in the last ${recentPicks.length} picks` });
  const valueOpportunity = available.filter((player) => platformRanks[player.id] - player.rank >= teams).sort((left, right) => (platformRanks[right.id] - right.rank) - (platformRanks[left.id] - left.rank))[0];
  if (valueOpportunity) draftSignals.push({ kind: "value", title: `${valueOpportunity.name} may last`, detail: `Your rank #${valueOpportunity.rank} · ${leagueProviderName} #${platformRanks[valueOpportunity.id]}` });
  draftSignals.push({ kind: "clock", title: picksUntilMine === 0 ? "You are on the clock" : `${picksUntilMine} ${picksUntilMine === 1 ? "pick" : "picks"} until your turn`, detail: picksUntilMine === 0 ? `Pick ${nextPick} · Round ${round}` : `Your next selection is pick ${nextUserPick}` });
  const tierBoardColumns = ["QB", "RB", "WR", "TE"].map((boardPosition) => {
    const positionPlayers = available.filter((player) => player.position === boardPosition).sort((a, b) => tierValue(a) - tierValue(b) || a.rank - b.rank);
    const tiers = Array.from(new Set(positionPlayers.map((player) => player.tier))).sort((left, right) => (left ?? Number.MAX_SAFE_INTEGER) - (right ?? Number.MAX_SAFE_INTEGER));
    return { position: boardPosition, groups: tiers.map((tier) => ({ tier, players: positionPlayers.filter((player) => player.tier === tier) })) };
  });

  const draftPlayer = (player: Player) => {
    setPicks((current) => [...current, { ...player, pick: nextPick, roster: onClock }]);
    setWatchlistIds((current) => current.filter((id) => id !== player.id));
    setSearch("");
  };

  const toggleWatchlist = (player: Player) => setWatchlistIds((current) => current.includes(player.id) ? current.filter((id) => id !== player.id) : [...current, player.id]);

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
      setTeamNames(draft.teamNames || {});
      setLeagueProvider(draft.leagueProvider || "none");
      setLeagueFormat(draft.leagueFormat || "half-ppr");
      setPlatformRanks(draft.platformRanks || {});
      setWatchlistIds(draft.watchlistIds || []);
    } else {
      setActiveDraftId("");
      setTeams(12);
      setMySlot(4);
      setSnake(true);
      setPicks([]);
      setTeamNames({});
      setLeagueProvider("none");
      setLeagueFormat("half-ppr");
      setPlatformRanks({});
      setWatchlistIds([]);
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

  const renameTeam = (team: number) => {
    setNameInput(teamNames[String(team)] || `Team ${team}`);
    setNameAction({ kind: "rename-team", team });
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
        const draft: DraftSession = { id: `draft-${Date.now()}`, name, teams: 12, mySlot: 4, snake: true, picks: [], teamNames: {}, leagueProvider: "none", leagueFormat: "half-ppr", platformRanks: {}, watchlistIds: [] };
        setRankingSets((current) => current.map((item) => item.id === set.id ? { ...item, drafts: [...item.drafts, draft] } : item));
        setActiveSetId(set.id);
        setActiveDraftId(draft.id);
        setFiles(set.files);
        setPlayers(set.players);
        setTeams(draft.teams);
        setMySlot(draft.mySlot);
        setSnake(draft.snake);
        setPicks([]);
        setTeamNames({});
        setLeagueProvider("none");
        setLeagueFormat("half-ppr");
        setPlatformRanks({});
        setWatchlistIds([]);
        setStep("setup");
      }
    } else if (nameAction.kind === "rename-set") {
      setRankingSets((current) => current.map((item) => item.id === nameAction.setId ? { ...item, name } : item));
    } else if (nameAction.kind === "rename-draft") {
      setRankingSets((current) => current.map((set) => set.id === nameAction.setId ? { ...set, drafts: set.drafts.map((item) => item.id === nameAction.draftId ? { ...item, name } : item) } : set));
    } else {
      setTeamNames((current) => ({ ...current, [String(nameAction.team)]: name }));
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
        <div className="workspace-set-head"><strong>{set.name}</strong><div className="workspace-item-actions"><button title="Rename rankings set" aria-label={`Rename ${set.name}`} onClick={() => renameSet(set)}>✎</button><button className="delete-icon" title="Delete rankings set" aria-label={`Delete ${set.name}`} onClick={() => setDeleteAction({ kind: "set", setId: set.id, name: set.name })}>×</button></div></div>
        <div className="workspace-links"><button onClick={() => openRankingSet(set, "rankings")}><span>✦</span> Edit rankings <small>{set.players.length} players</small></button>
          {set.drafts.map((draft) => <div className={draft.id === activeDraftId ? "workspace-draft selected" : "workspace-draft"} key={draft.id}><button onClick={() => openRankingSet(set, "draft", draft)}><span>▦</span> {draft.name}<small>{draft.picks.length} picks</small></button><div className="workspace-item-actions"><button title="Rename draft" aria-label={`Rename ${draft.name}`} onClick={() => renameDraft(set.id, draft)}>✎</button><button className="delete-icon" title="Delete draft" aria-label={`Delete ${draft.name}`} onClick={() => setDeleteAction({ kind: "draft", setId: set.id, draftId: draft.id, name: draft.name })}>×</button></div></div>)}
          <button className="new-draft-link" onClick={() => createDraft(set)}><span>＋</span> New draft</button>
        </div>
      </div>)}
    </div>}
  </div>;

  const nameDialog = nameAction && <div className="name-dialog-backdrop" role="presentation" onMouseDown={() => setNameAction(null)}><form className="name-dialog" role="dialog" aria-modal="true" aria-labelledby="name-dialog-title" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); submitName(); }}>
    <span className="eyebrow">ORGANIZE YOUR DRAFTROOM</span>
    <h2 id="name-dialog-title">{nameAction.kind === "create-set" ? "Name your rankings set" : nameAction.kind === "create-draft" ? "Name your draft" : nameAction.kind === "rename-set" ? "Rename rankings set" : nameAction.kind === "rename-team" ? "Name this team" : "Rename draft"}</h2>
    <p>{nameAction.kind === "rename-team" ? "Use the manager's name, team name, or anything else that helps you recognize them." : nameAction.kind.includes("set") ? "Use a name that describes the scoring or strategy, like Half PPR or 2QB." : "Use a name that helps you recognize the league or draft date."}</p>
    <label><span>Name</span><input autoFocus maxLength={60} value={nameInput} onChange={(event) => setNameInput(event.target.value)} /></label>
    <div><button type="button" className="dialog-cancel" onClick={() => setNameAction(null)}>Cancel</button><button type="submit" className="primary" disabled={!nameInput.trim()}>Save name</button></div>
  </form></div>;
  const deleteDialog = deleteAction && <div className="name-dialog-backdrop" role="presentation" onMouseDown={() => setDeleteAction(null)}><div className="name-dialog delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
    <span className="delete-warning">!</span><div className="eyebrow">PERMANENTLY DELETE</div>
    <h2 id="delete-dialog-title">Delete “{deleteAction.name}”?</h2>
    <p>{deleteAction.kind === "set" ? "This removes the rankings, custom tiers, and every draft inside this set." : "This removes the draft settings, pick history, and team rosters. Your rankings set will remain."} This cannot be undone.</p>
    <div><button type="button" className="dialog-cancel" onClick={() => setDeleteAction(null)}>Keep it</button><button type="button" className="danger-button" onClick={confirmDelete}>Delete {deleteAction.kind === "set" ? "rankings set" : "draft"}</button></div>
  </div></div>;
  const availableFormats = onlineProvider === "yahoo" ? ["standard"] : onlineProvider === "espn" ? ["standard", "ppr", "superflex"] : ["standard", "half-ppr", "ppr", "2qb"];
  const selectedSource = expertSources.find((source) => source.id === onlineProvider)!;
  const expertImporterDialog = expertImporterOpen && <div className="expert-import-backdrop" role="presentation" onMouseDown={() => { if (!onlineLoading) setExpertImporterOpen(false); }}><section className="expert-import-dialog" role="dialog" aria-modal="true" aria-labelledby="expert-import-title" onMouseDown={(event) => event.stopPropagation()}>
    <header><div><span className="online-badge">LIVE RANKING SOURCES</span><h2 id="expert-import-title">Import Expert Ranks</h2><p>Choose a source and format. We&apos;ll save a snapshot you can reorder, tier, and use across drafts.</p></div><button className="expert-dialog-close" aria-label="Close expert rankings importer" disabled={onlineLoading} onClick={() => setExpertImporterOpen(false)}>×</button></header>
    <div className="expert-dialog-body">
      <fieldset className="expert-source-step"><legend><span>1</span> Choose a source</legend><div className="expert-source-grid">{expertSources.map((source) => <button type="button" className={source.id === onlineProvider ? "expert-source-option selected" : "expert-source-option"} aria-pressed={source.id === onlineProvider} key={source.id} onClick={() => chooseExpertSource(source.id)}><span className="source-radio" /><div><strong>{source.name}</strong><small>{source.description}</small></div>{source.id === onlineProvider && <b>✓</b>}</button>)}</div></fieldset>
      <fieldset className="expert-settings-step"><legend><span>2</span> Choose your format</legend><div className="expert-format-options">{availableFormats.map((format) => <button type="button" className={format === onlineFormat ? "selected" : ""} aria-pressed={format === onlineFormat} key={format} onClick={() => setOnlineFormat(format)}>{formatNames[format]}</button>)}</div>{onlineProvider === "ffc" && <div className="expert-team-options"><label>League size</label><div>{[8, 10, 12, 14].map((count) => <button type="button" className={count === onlineTeams ? "selected" : ""} aria-pressed={count === onlineTeams} key={count} onClick={() => setOnlineTeams(count)}>{count} teams</button>)}</div></div>}<p className="expert-source-note">{onlineProvider === "espn" ? "Uses ESPN's current preseason draft order." : onlineProvider === "yahoo" ? "Yahoo currently publishes public draft ADP for Standard scoring only." : "ADP reflects where players are being selected in platform drafts."}</p></fieldset>
    </div>
    <footer><div><strong>{selectedSource.name}</strong><small>{formatNames[onlineFormat]}{onlineProvider === "ffc" ? ` · ${onlineTeams} teams` : ""}</small></div><div><button className="dialog-cancel" disabled={onlineLoading} onClick={() => setExpertImporterOpen(false)}>Cancel</button><button className="expert-import-submit" disabled={onlineLoading} onClick={loadOnlineRankings}>{onlineLoading ? "Importing…" : "Import rankings"}<span>↓</span></button></div></footer>
  </section></div>;
  const tierImporterDialog = tierImporterOpen && <div className="expert-import-backdrop" role="presentation" onMouseDown={() => setTierImporterOpen(false)}><section className="tier-import-dialog" role="dialog" aria-modal="true" aria-labelledby="tier-import-title" onMouseDown={(event) => event.stopPropagation()}>
    <header><div><span className="online-badge">CUSTOM TIERS</span><h2 id="tier-import-title">Apply tiers from a sheet</h2><p>Use your own sheet or start with one of our templates. Your player rankings will not be reordered.</p></div><button className="expert-dialog-close" aria-label="Close tier sheet importer" onClick={() => setTierImporterOpen(false)}>×</button></header>
    <div className="tier-import-steps">
      <section className="tier-import-step"><span className="tier-step-number">1</span><div><strong>Prepare your tier sheet</strong><p>Already have one? Skip to step 2. Otherwise, download a blank template and fill in player names and tier numbers.</p><div className="tier-template-options"><button type="button" onClick={() => downloadTierTemplate("table")}><b>↓ Player table</b><small>One list with Player, Position, Team, and Tier columns</small></button><button type="button" onClick={() => downloadTierTemplate("positions")}><b>↓ By position</b><small>Separate Player, Team, and Tier columns for each position</small></button></div></div></section>
      <section className="tier-import-step"><span className="tier-step-number">2</span><div><strong>Upload the completed sheet</strong><p>CSV, TSV, and Excel files are supported. We&apos;ll inspect every worksheet and identify the layout automatically.</p><label className="tier-step-upload"><input type="file" accept=".csv,.tsv,.xlsx,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { applyTierWorkbook(event.target.files); event.currentTarget.value = ""; }} /><span>Choose tier sheet</span><b>↑</b></label></div></section>
      <section className="tier-import-step tier-review-step"><span className="tier-step-number">3</span><div><strong>Review the results</strong><p>Obvious name variations are matched automatically. If any names are uncertain, we&apos;ll ask you to confirm them before finishing. Players not listed become N/A.</p></div></section>
    </div>
  </section></div>;
  const tierMatchDialog = unresolvedTierMatches.length > 0 && <div className="expert-import-backdrop" role="presentation"><section className="tier-match-dialog" role="dialog" aria-modal="true" aria-labelledby="tier-match-title">
    <header><div><span className="online-badge">REVIEW NAME MATCHES</span><h2 id="tier-match-title">A few names need your help</h2><p>We matched obvious differences automatically. Choose the corresponding player for any remaining tier names you recognize, or leave them unmatched.</p></div><span className="match-count">{unresolvedTierMatches.length}</span></header>
    <div className="tier-match-list">{unresolvedTierMatches.map((match) => <div className="tier-match-row" key={match.id}><div className="incoming-tier-name"><span>{match.position} · Tier {match.tier}</span><strong>{match.name}</strong><small>{match.team || "Team not provided"} · From tier workbook</small></div><span className="match-arrow">→</span><label><span className="sr-only">Match {match.name} to a ranked player</span><select value={tierMatchSelections[match.id] || ""} onChange={(event) => setTierMatchSelections((current) => ({ ...current, [match.id]: event.target.value }))}><option value="">Leave unmatched</option>{match.candidates.map((candidate) => <option value={candidate.id} key={candidate.id} disabled={Object.entries(tierMatchSelections).some(([matchId, playerId]) => matchId !== match.id && playerId === candidate.id)}>{candidate.name} · {candidate.team} ({Math.round(candidate.score * 100)}% match)</option>)}</select></label></div>)}</div>
    <footer><button className="dialog-cancel" onClick={() => { setUnresolvedTierMatches([]); setTierMatchSelections({}); setNotice("Unresolved tier names were left unmatched. Unlisted players remain N/A."); }}>Skip these</button><button className="expert-import-submit" onClick={finishTierMatching}>Apply matches <span>✓</span></button></footer>
  </section></div>;

  if (step === "home") return (
    <main className="app-shell home-shell">
      {nameDialog}
      {deleteDialog}
      <header className="topbar home-topbar">
        <button className="brand home-brand" onClick={() => setStep("home")}><span className="brand-mark">P</span><span>The Program</span></button>
        <span className={saveStatus === "Save failed" ? "home-saved save-error" : "home-saved"}>● {desktopMode ? saveStatus : "Everything saved locally"}</span>
        <div className="home-header-actions"><button className="header-primary" onClick={createRankingSet}>＋ New rankings set</button>{workspaceSwitcher()}</div>
      </header>
      <section className="home-wrap">
        <div className="home-hero"><div><div className="eyebrow">THE PROGRAM</div><h1>Rankings and drafts</h1><p className="lede">Manage your ranking sets, customize tiers, and continue active drafts.</p></div><div className="home-stats"><span><strong>{rankingSets.length}</strong> ranking {rankingSets.length === 1 ? "set" : "sets"}</span><i /><span><strong>{rankingSets.reduce((total, set) => total + set.drafts.length, 0)}</strong> total drafts</span></div></div>
        <div className="home-section-head"><div><h2>Ranking sets</h2><p>Each set includes its ranking sources, player order, tiers, and drafts.</p></div><button onClick={createRankingSet}>＋ Create rankings set</button></div>
        <div className="ranking-set-grid">
          {rankingSets.map((set) => <article className="ranking-home-card" key={set.id}>
            <div className="ranking-card-head"><div className="set-icon">≡</div><div><h3>{set.name}</h3><p>{set.players.length} players · {set.files.length} ranking {set.files.length === 1 ? "source" : "sources"}</p></div><div className="card-item-actions"><button title="Rename rankings set" aria-label={`Rename ${set.name}`} onClick={() => renameSet(set)}>✎</button><button className="delete-icon" title="Delete rankings set" aria-label={`Delete ${set.name}`} onClick={() => setDeleteAction({ kind: "set", setId: set.id, name: set.name })}>×</button></div></div>
            <div className="ranking-card-actions"><button onClick={() => openRankingSet(set, "rankings")}><span>✦</span><div><strong>Edit rankings</strong><small>Sources, order & tiers</small></div><b>→</b></button><button onClick={() => createDraft(set)} disabled={!set.players.length}><span>＋</span><div><strong>Start new draft</strong><small>{set.players.length ? "Use this ranking set" : "Add rankings first"}</small></div><b>→</b></button></div>
            <div className="card-drafts-head"><span>DRAFTS</span><small>{set.drafts.length}</small></div>
            <div className="home-draft-list">{set.drafts.map((draft) => <div className="home-draft-row" key={draft.id}><span className="draft-status">{draft.picks.length ? "LIVE" : "NEW"}</span><div><strong>{draft.name}</strong><small>{draft.teams} teams · Pick {draft.picks.length + 1} · {draft.snake ? "Snake" : "Linear"}</small></div><div className="draft-row-actions"><button onClick={() => openRankingSet(set, "draft", draft)}>{draft.picks.length ? "Continue" : "Open"} →</button><button className="delete-icon" title="Delete draft" aria-label={`Delete ${draft.name}`} onClick={() => setDeleteAction({ kind: "draft", setId: set.id, draftId: draft.id, name: draft.name })}>×</button></div></div>)}{!set.drafts.length && <div className="no-drafts"><span>⌁</span><p>No drafts started with this set yet.</p></div>}</div>
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
      {expertImporterDialog}
      {tierImporterDialog}
      {tierMatchDialog}
      <header className="topbar">
        <button className="brand home-brand" onClick={() => setStep("home")}><span className="brand-mark">P</span><span>The Program</span></button>
        <div className="stepper"><span className="active">1 Rankings</span><i /> <span>2 Draft setup</span><i /> <span>3 Draft room</span></div>
        {workspaceSwitcher()}
      </header>
      <section className="setup-wrap">
        <div className="eyebrow">BUILD YOUR BOARD</div>
        <h1>Your rankings. Your edge.</h1>
        <p className="lede">Stack expert lists in the order you trust them. We&apos;ll use every player from your first source, then fill the gaps from the next.</p>

        <div className="ranking-upload-block">
          <label className="dropzone">
            <input type="file" accept=".csv,.tsv,.xlsx,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" multiple onChange={(event) => addFiles(event.target.files)} />
            <span className="upload-icon">↑</span>
            <strong>Drop ranking sheets here</strong>
            <small>CSV, TSV, or Excel · We&apos;ll identify the headers and ranking table automatically</small>
            <span className="choose-button">Choose ranking files</span>
          </label>
          <div className="ranking-help"><button type="button" aria-label="Show ranking file requirements">?</button><div role="tooltip"><strong>What does my sheet need?</strong><p><b>Required:</b> a Player, Player Name, or Name column.</p><p><b>Recommended:</b> Position/Pos and Team/TM columns.</p><p><b>Optional:</b> Rank, RK, Overall, or ADP. If it&apos;s missing, row order becomes the ranking.</p><small>Headers can appear below title or notes rows. In Excel files with multiple worksheets, we&apos;ll select the sheet containing the ranking table.</small></div></div>
        </div>

        <div className="expert-import-launcher">
          <div className="expert-launch-icon">✦</div><div><span className="online-badge">EXPERT RANKINGS</span><h2>Start with a trusted source</h2><p>Import current rankings from ESPN, Yahoo, Sleeper, or Fantasy Football Calculator.</p></div>
          <button onClick={() => setExpertImporterOpen(true)}>Import Expert Ranks <span>→</span></button>
        </div>

        <div className="tier-import-card">
          <div className="tier-launch-icon">≡</div><div><span className="online-badge">CUSTOM TIERS</span><h2>{tierFileName ? "Update tiers from a sheet" : "Apply tiers from a sheet"}</h2><p>Upload your own tier sheet or use a blank template. We&apos;ll guide you through it.</p>{tierFileName && <small>Currently applied: {tierFileName}</small>}</div>
          <button type="button" disabled={!players.length} onClick={() => setTierImporterOpen(true)}>{tierFileName ? "Update tiers" : "Apply tiers"}<span>→</span></button>
        </div>

        <div className="section-heading"><div><h2>Source priority</h2><p>Top source wins when a player appears in more than one list.</p></div><span>{players.length} unique players</span></div>
        <div className="source-list">
          {files.length === 0 && <div className="empty-source">No ranking files yet</div>}
          {files.map((file, index) => (
            <div className="source-card" key={file.id}>
              <span className="drag">⋮⋮</span><span className="priority">{index + 1}</span>
              <div className="source-copy"><strong>{file.name.replace(/\.csv$/i, "")}</strong><small>{file.players.length} players · Priority {index + 1}</small></div>
              <div className="source-actions"><button title="Move source up" aria-label="Move up" onClick={() => moveFile(index, -1)}>↑</button><button title="Move source down" aria-label="Move down" onClick={() => moveFile(index, 1)}>↓</button><button title="Remove source" aria-label="Remove" onClick={() => removeFile(file.id)}>×</button></div>
            </div>
          ))}
        </div>

        {players.length > 0 && <div className="tier-preview">
          <div className="section-heading"><div><h2>Make the board yours</h2><p>Edit your personal rank and tiers. Set lower-priority players to N/A and they&apos;ll drop below every numbered tier.</p></div><button className="text-button" onClick={resetRanks}>Reset expert order</button></div>
          <div className="tier-table">
            <div className="tier-table-head"><span>My rank</span><span>Pos</span><span>Player</span><span>Expert source</span><span>My tier</span></div>
            {[...players].sort((a, b) => a.rank - b.rank).slice(0, showAllRankings ? players.length : 12).map((player) => <div className={`${draggedPlayerId === player.id ? "tier-row dragging" : "tier-row"}${dragOverPlayerId === player.id ? " drag-target" : ""}`} key={player.id} onDragOver={(event) => { event.preventDefault(); if (draggedPlayerId && draggedPlayerId !== player.id) setDragOverPlayerId(player.id); }} onDragLeave={() => setDragOverPlayerId((current) => current === player.id ? null : current)} onDrop={(event) => { event.preventDefault(); if (draggedPlayerId) reorderPlayer(draggedPlayerId, player.id); }}>
              <div className="rank-editor"><button className="player-drag-handle" draggable aria-label={`Drag ${player.name} to reorder`} title="Drag to reorder" onDragStart={(event) => { setDraggedPlayerId(player.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", player.id); const row = event.currentTarget.closest(".tier-row"); if (row instanceof HTMLElement) { const ghost = row.cloneNode(true) as HTMLElement; ghost.classList.remove("dragging", "drag-target"); ghost.classList.add("drag-ghost"); ghost.style.width = `${row.getBoundingClientRect().width}px`; document.body.appendChild(ghost); event.dataTransfer.setDragImage(ghost, 48, row.offsetHeight / 2); window.requestAnimationFrame(() => ghost.remove()); } }} onDragEnd={() => { setDraggedPlayerId(null); setDragOverPlayerId(null); }}>⋮⋮</button><label className="rank-field"><span className="sr-only">Personal rank for {player.name}</span><input inputMode="numeric" min="1" value={rankInputs[player.id] ?? String(player.rank)} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setRankInputs((current) => ({ ...current, [player.id]: event.target.value.replace(/[^0-9]/g, "") }))} onBlur={() => commitRank(player)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { setRankInputs((current) => { const next = { ...current }; delete next[player.id]; return next; }); event.currentTarget.blur(); } }} /></label></div>
              <span className={`pos ${positionColors[player.position] || ""}`}>{player.position}</span><strong>{player.name}</strong><small>{player.team} · {player.source} #{player.sourceRank}</small><div className="tier-control"><label><span className="sr-only">Tier for {player.name}</span><input type="number" min="1" placeholder="—" value={player.tier ?? ""} onChange={(event) => updateTier(player.id, event.target.value === "" ? null : Number(event.target.value))} /></label><button className={player.tier === null ? "selected" : ""} onClick={() => updateTier(player.id, player.tier === null ? 1 : null)}>N/A</button></div>
            </div>)}
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
      <header className="topbar"><button className="brand home-brand" onClick={() => setStep("home")}><span className="brand-mark">P</span><span>The Program</span></button><div className="stepper"><span>✓ Rankings</span><i /><span className="active">2 Draft setup</span><i /><span>3 Draft room</span></div>{workspaceSwitcher()}</header>
      <section className="draft-setup-card">
        <button className="back" onClick={() => setStep("rankings")}>← Back to rankings</button>
        <div className="eyebrow">LEAGUE SETTINGS</div><h1>Set the room.</h1><p className="lede">Tell us the table size and where you&apos;re sitting. You can change this before the first pick.</p>
        <div className="settings-grid">
          <label><span>Number of teams</span><select value={teams} onChange={(e) => { setTeams(Number(e.target.value)); setMySlot(Math.min(mySlot, Number(e.target.value))); }}>{[8,10,12,14,16].map(n => <option key={n}>{n}</option>)}</select><small>Common formats: 10 or 12 teams</small></label>
          <label><span>Your draft position</span><select value={mySlot} onChange={(e) => setMySlot(Number(e.target.value))}>{Array.from({length: teams}, (_, i) => i + 1).map(n => <option key={n} value={n}>Pick {n}</option>)}</select><small>Where you&apos;ll pick in round one</small></label>
        </div>
        <section className="platform-compare-setup"><div className="platform-compare-copy"><span className="online-badge">OPTIONAL DRAFT STRATEGY</span><h2>Compare your board to the room</h2><p>Choose a platform only if you want us to flag players it ranks at least one round earlier or later than you do.</p></div><div className="platform-settings"><label><span>League host</span><select value={leagueProvider} onChange={(event) => chooseLeagueProvider(event.target.value as LeagueProvider)}><option value="none">No comparison</option><option value="sleeper">Sleeper</option><option value="espn">ESPN</option><option value="yahoo">Yahoo</option></select></label>{leagueProvider !== "none" && <label><span>League type</span><select value={leagueFormat} onChange={(event) => { setLeagueFormat(event.target.value); setPlatformRanks({}); }}>{(leagueProvider === "yahoo" ? ["standard"] : leagueProvider === "espn" ? ["standard", "ppr", "superflex"] : ["standard", "half-ppr", "ppr", "2qb"]).map((format) => <option value={format} key={format}>{formatNames[format]}</option>)}</select></label>}</div><small>{leagueProvider === "none" ? "Nothing extra is required—continue with your personal rankings and tiers." : `A snapshot of ${leagueProviderName}'s defaults will be saved with this draft.`}</small></section>
        <fieldset><legend>Draft order</legend><button className={snake ? "choice selected" : "choice"} onClick={() => setSnake(true)}><span className="choice-icon">↝</span><span><strong>Snake draft</strong><small>Order reverses every round</small></span><b>✓</b></button><button className={!snake ? "choice selected" : "choice"} onClick={() => setSnake(false)}><span className="choice-icon">→</span><span><strong>Linear draft</strong><small>Same order every round</small></span><b>✓</b></button></fieldset>
        <div className="seat-preview"><span>Your seat</span><strong>{mySlot}</strong><small>of {teams}</small><i>Round 1: pick {mySlot} · Round 2: pick {snake ? teams * 2 - mySlot + 1 : teams + mySlot}</i></div>
        <button className="primary full" disabled={leagueRanksLoading} onClick={enterDraftRoom}>{leagueRanksLoading ? "Loading league defaults…" : "Enter draft room"} <span>→</span></button>
      </section>
    </main>
  );

  return (
    <main className="app-shell draft-shell">
      {nameDialog}
      {deleteDialog}
      <header className="draft-topbar"><button className="brand home-brand" onClick={() => setStep("home")}><span className="brand-mark">P</span><span>The Program</span></button><div className={onClock === mySlot ? "clock my-clock" : "clock"}><span>{onClock === mySlot ? "YOU'RE ON THE CLOCK" : `${teamDisplayName(onClock).toUpperCase()} IS ON THE CLOCK`}</span><strong>Pick {nextPick}</strong><div className="pick-meta"><small>Round {round}</small><i className="pick-timer" aria-label={`Current pick has taken ${pickTimerLabel}`}><b aria-hidden="true">◷</b>{pickTimerLabel}</i></div></div><div className="draft-actions">{workspaceSwitcher()}<button onClick={undo} disabled={!picks.length}>↶ Undo</button><button onClick={() => setStep("setup")}>⚙ Settings</button></div></header>
      <section className={draftCenterView === "tiers" ? "draft-grid tier-view" : "draft-grid"}>
        <aside className={`recommend-panel side-panel-${sidePanelMode}`}><div className="panel-title player-list-title"><div><span className="eyebrow">YOUR RANKINGS</span><h2>Available players</h2></div><div className="side-panel-toggle" role="group" aria-label="Player list companion panel">{(["none", "signals", "watchlist"] as const).map((mode) => <button className={sidePanelMode === mode ? "active" : ""} aria-pressed={sidePanelMode === mode} onClick={() => setSidePanelMode(mode)} key={mode}>{mode === "none" ? "None" : mode === "signals" ? "Signals" : `Watchlist${watchlist.length ? ` ${watchlist.length}` : ""}`}</button>)}</div></div>
          {sidePanelMode === "signals" && <section className="draft-signals" aria-label="Draft signals"><div className="draft-signals-heading"><strong>Draft signals</strong><small>Live strategy notes</small></div><div className="draft-signal-list">{draftSignals.slice(0, 4).map((signal, index) => <div className={`draft-signal signal-${signal.kind}`} key={`${signal.kind}-${index}`}><span>{signal.kind === "cliff" ? "▾" : signal.kind === "run" ? "↗" : signal.kind === "value" ? "$" : signal.kind === "stack" ? "⌁" : "◷"}</span><div><strong>{signal.title}</strong><small>{signal.detail}</small></div></div>)}</div></section>}
          {sidePanelMode === "watchlist" && <section className="draft-watchlist" aria-label="Player watchlist"><div className="draft-signals-heading"><strong>Watchlist</strong><small>{watchlist.length} available</small></div>{watchlist.length ? <div className="watchlist-players">{watchlist.map((player) => <div className="watchlist-player" key={player.id}><button className="watchlist-draft" onClick={() => draftPlayer(player)}><b>{player.rank}</b><span><strong>{player.name}</strong><small>{player.position} · {player.team} · Tier {tierLabel(player)}</small></span><i>＋</i></button><button className="watch-toggle active" title="Remove from watchlist" aria-label={`Remove ${player.name} from watchlist`} onClick={() => toggleWatchlist(player)}>★</button></div>)}</div> : <div className="watchlist-empty"><span>☆</span><strong>No players watched yet</strong><small>Use the star beside a player to add them.</small></div>}</section>}
          <div className="filters"><div className="search"><span>⌕</span><input aria-label="Search available players" placeholder="Search players" value={search} onChange={(e) => setSearch(e.target.value)} /></div><div className="filter-row">{["ALL","RB","WR","QB","TE","FLEX"].map(p => <button className={position === p ? "active" : ""} onClick={() => setPosition(p)} key={p}>{p}</button>)}</div></div>
          <div className="player-list">{filtered.slice(0, 60).map((player) => <div className="player-list-row" key={player.id}><button className="player-draft-action" onClick={() => draftPlayer(player)}><b>{player.rank}</b><div><strong>{player.name}</strong><small>{player.team} · Tier {tierLabel(player)} · {player.source}</small>{strategyBadge(player)}</div><span className={`pos ${positionColors[player.position] || ""}`}>{player.position}</span><i>＋</i></button><button className={watchlistIds.includes(player.id) ? "watch-toggle active" : "watch-toggle"} title={watchlistIds.includes(player.id) ? "Remove from watchlist" : "Add to watchlist"} aria-label={`${watchlistIds.includes(player.id) ? "Remove" : "Add"} ${player.name} ${watchlistIds.includes(player.id) ? "from" : "to"} watchlist`} onClick={() => toggleWatchlist(player)}>{watchlistIds.includes(player.id) ? "★" : "☆"}</button></div>)}</div>
        </aside>
        <section className={draftCenterView === "tiers" ? "board-panel tier-board-panel" : "board-panel"}><div className="board-heading"><div><span className="eyebrow">LIVE DRAFT</span><h2>{draftCenterView === "rosters" ? "League rosters" : "Available by tier"}</h2></div><div className="board-heading-actions"><div className="board-view-toggle" role="group" aria-label="Draft board view"><button className={draftCenterView === "rosters" ? "active" : ""} aria-pressed={draftCenterView === "rosters"} onClick={() => setDraftCenterView("rosters")}><span>▦</span> Rankings View</button><button className={draftCenterView === "tiers" ? "active" : ""} aria-pressed={draftCenterView === "tiers"} onClick={() => setDraftCenterView("tiers")}><span>≡</span> Tier Board</button></div><span>Round {round} of 16</span></div></div>
          {draftCenterView === "rosters" ? <div className="roster-board">{Array.from({length: teams}, (_, i) => i + 1).map(team => <div className={team === mySlot ? "roster my-roster" : "roster"} key={team}><div className="roster-head"><div className="roster-team-name"><span>{teamDisplayName(team)}</span>{team !== mySlot && <button aria-label={`Rename ${teamDisplayName(team)}`} title="Rename team" onClick={() => renameTeam(team)}>✎</button>}</div>{team === onClock && <i>ON CLOCK</i>}</div>{picks.filter(p => p.roster === team).map(p => <div className="roster-player" key={p.pick}><span className={`pos ${positionColors[p.position] || ""}`}>{p.position}</span><div><strong>{p.name}</strong><small>{p.team} · Pick {p.pick}</small></div></div>)}{picks.filter(p => p.roster === team).length === 0 && <div className="empty-roster">No picks yet</div>}</div>)}</div> : <div className="draft-tier-board">{tierBoardColumns.map((column) => <section className={`draft-tier-column tier-column-${column.position.toLowerCase()}`} key={column.position}><header><strong>{column.position === "QB" ? "QUARTERBACK" : column.position === "RB" ? "RUNNING BACK" : column.position === "WR" ? "WIDE RECEIVER" : "TIGHT END"}</strong><span>{column.groups.reduce((total, group) => total + group.players.length, 0)} left</span></header><div>{column.groups.map((group) => <div className={group.tier === null ? "draft-tier-group na-tier" : "draft-tier-group"} key={group.tier ?? "na"}><div className="draft-tier-label"><span>{group.tier === null ? "N/A" : `TIER ${group.tier}`}</span><i>{group.players.length}</i></div>{group.players.map((player) => <div className="tier-player-row" key={player.id}><button className="tier-draft-action" onClick={() => draftPlayer(player)}><div><strong>{player.name}</strong><small>{player.team} · Rank {player.rank}</small>{strategyBadge(player)}</div><span>＋</span></button><button className={watchlistIds.includes(player.id) ? "watch-toggle active" : "watch-toggle"} title={watchlistIds.includes(player.id) ? "Remove from watchlist" : "Add to watchlist"} aria-label={`${watchlistIds.includes(player.id) ? "Remove" : "Add"} ${player.name} ${watchlistIds.includes(player.id) ? "from" : "to"} watchlist`} onClick={() => toggleWatchlist(player)}>{watchlistIds.includes(player.id) ? "★" : "☆"}</button></div>)}</div>)}</div></section>)}</div>}
        </section>
        <aside className="activity-panel"><div className="panel-title"><div><span className="eyebrow">PICK LOG</span><h2>Latest picks</h2></div><button onClick={undo} disabled={!picks.length}>Undo</button></div><div className="pick-log">{[...picks].reverse().map(p => <div key={p.pick}><b>{p.pick}</b><span className={`pos ${positionColors[p.position] || ""}`}>{p.position}</span><div><strong>{p.name}</strong><small>{teamDisplayName(p.roster)} · {p.team}</small></div></div>)}{!picks.length && <div className="empty-log"><span>⌁</span><strong>The board is clean</strong><small>Select a player to record pick 1.</small></div>}</div></aside>
      </section>
    </main>
  );
}
