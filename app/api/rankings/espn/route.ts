const rankTypes: Record<string, string> = { standard: "STANDARD", ppr: "PPR", superflex: "SUPERFLEX" };
const positions: Record<number, string> = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DEF" };
const teams: Record<number, string> = { 1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET", 9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WAS", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU" };

type EspnEntry = { player?: { id: number; fullName: string; defaultPositionId: number; proTeamId: number; draftRanksByRankType?: Record<string, { rank?: number }> } };

export async function GET(request: Request) {
  const format = new URL(request.url).searchParams.get("format") || "ppr";
  const rankType = rankTypes[format];
  if (!rankType) return new Response("Unsupported rankings format.", { status: 400 });

  try {
    const filter = JSON.stringify({ players: { limit: 500, sortDraftRanks: { sortPriority: 100, sortAsc: true, value: rankType } } });
    const response = await fetch(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${new Date().getFullYear()}/segments/0/leaguedefaults/1?view=kona_player_info`, {
      headers: { Accept: "application/json", "User-Agent": "The Program fantasy draft app", "x-fantasy-filter": filter },
    });
    if (!response.ok) return new Response("The rankings provider is unavailable.", { status: 502 });
    const data = await response.json() as { players?: EspnEntry[] };
    const players = (data.players || [])
      .map((entry) => ({ entry, rank: Number(entry.player?.draftRanksByRankType?.[rankType]?.rank) }))
      .filter(({ entry, rank }) => Boolean(positions[entry.player?.defaultPositionId || 0]) && rank > 0 && rank <= 500)
      .sort((a, b) => a.rank - b.rank)
      .map(({ entry, rank }) => ({ player_id: entry.player!.id, name: entry.player!.fullName, position: positions[entry.player!.defaultPositionId], team: teams[entry.player!.proTeamId] || "FA", adp: rank }));
    return Response.json({ status: "Success", meta: { type: format }, players }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return new Response("The rankings provider could not be reached.", { status: 502 });
  }
}
