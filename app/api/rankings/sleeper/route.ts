const statFields: Record<string, string> = {
  standard: "adp_std",
  "half-ppr": "adp_half_ppr",
  ppr: "adp_ppr",
  "2qb": "adp_2qb",
};
const positions = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

type SleeperEntry = {
  player_id: string;
  team?: string;
  player?: { first_name?: string; last_name?: string; position?: string; team?: string };
  stats?: Record<string, number>;
};

export async function GET(request: Request) {
  const format = new URL(request.url).searchParams.get("format") || "half-ppr";
  const statField = statFields[format];
  if (!statField) return new Response("Unsupported rankings format.", { status: 400 });

  try {
    const response = await fetch(`https://api.sleeper.app/projections/nfl/${new Date().getFullYear()}?season_type=regular&order_by=${statField}`, {
      headers: { Accept: "application/json", "User-Agent": "The Program fantasy draft app" },
    });
    if (!response.ok) return new Response("The rankings provider is unavailable.", { status: 502 });
    const data = await response.json() as SleeperEntry[];
    const players = data
      .filter((entry) => positions.has(entry.player?.position || "") && Number(entry.stats?.[statField]) > 0 && Number(entry.stats?.[statField]) <= 400)
      .sort((a, b) => Number(a.stats?.[statField]) - Number(b.stats?.[statField]))
      .map((entry) => ({
        player_id: entry.player_id,
        name: [entry.player?.first_name, entry.player?.last_name].filter(Boolean).join(" "),
        position: entry.player?.position,
        team: entry.player?.team || entry.team || "FA",
        adp: Number(entry.stats?.[statField]),
      }));
    return Response.json({ status: "Success", meta: { type: format }, players }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return new Response("The rankings provider could not be reached.", { status: 502 });
  }
}
