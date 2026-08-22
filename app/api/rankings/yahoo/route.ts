type YahooPlayer = {
  player?: {
    player_id?: string;
    name?: { full?: string };
    editorial_team_abbr?: string;
    display_position?: string;
    primary_position?: string;
    draft_analysis?: { average_pick?: string | number };
  };
};

export async function GET(request: Request) {
  const format = new URL(request.url).searchParams.get("format") || "standard";
  if (format !== "standard") return new Response("Yahoo currently publishes this public ADP feed for Standard scoring only.", { status: 400 });

  try {
    const headers = { Accept: "application/json", "User-Agent": "The Program fantasy draft app" };
    const gameResponse = await fetch("https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/game/nfl?format=json_f", { headers });
    if (!gameResponse.ok) return new Response("The rankings provider is unavailable.", { status: 502 });
    const gameData = await gameResponse.json() as { fantasy_content?: { game?: { game_key?: string; season?: string } } };
    const gameKey = gameData.fantasy_content?.game?.game_key;
    if (!gameKey) return new Response("Yahoo did not return a current fantasy football season.", { status: 502 });

    const path = `league/${gameKey}.l.public;out=settings/players;position=ALL;start=0;count=400;sort=average_pick;search=;out=auction_values,ranks;ranks=o-rank;out=expert_ranks;expert_ranks.rank_type=projected_season_remaining/draft_analysis;cut_types=diamond;slices=last7days`;
    const response = await fetch(`https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/${path}?format=json_f`, { headers });
    if (!response.ok) return new Response("The rankings provider is unavailable.", { status: 502 });
    const data = await response.json() as { fantasy_content?: { league?: { players?: YahooPlayer[] } } };
    const players = (data.fantasy_content?.league?.players || [])
      .map((entry) => ({ entry, adp: Number(entry.player?.draft_analysis?.average_pick) }))
      .filter(({ entry, adp }) => Boolean(entry.player?.name?.full && entry.player?.player_id && Number.isFinite(adp) && adp > 0))
      .sort((a, b) => a.adp - b.adp)
      .map(({ entry, adp }) => ({
        player_id: entry.player!.player_id!,
        name: entry.player!.name!.full!,
        position: entry.player!.primary_position || entry.player!.display_position || "FLEX",
        team: entry.player!.editorial_team_abbr || "FA",
        adp,
      }));

    return Response.json({ status: "Success", meta: { type: format, season: gameData.fantasy_content?.game?.season }, players }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return new Response("The rankings provider could not be reached.", { status: 502 });
  }
}
