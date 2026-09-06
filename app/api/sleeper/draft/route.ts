const sleeperHeaders = { Accept: "application/json", "User-Agent": "The Program fantasy draft app" };

async function sleeperJson(path: string) {
  const response = await fetch(`https://api.sleeper.app/v1${path}`, { headers: sleeperHeaders });
  if (!response.ok) throw new Error(`Sleeper returned ${response.status}.`);
  return response.json();
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const draftId = url.searchParams.get("draftId")?.trim();
  const picksOnly = url.searchParams.get("picksOnly") === "1";
  if (!draftId || !/^\d+$/.test(draftId)) return new Response("Enter a valid Sleeper draft link or draft ID.", { status: 400 });
  try {
    if (picksOnly) {
      const picks = await sleeperJson(`/draft/${draftId}/picks`);
      return Response.json({ draft: { draft_id: draftId }, picks, users: [] }, { headers: { "Cache-Control": "no-store" } });
    }
    const [draft, picks] = await Promise.all([sleeperJson(`/draft/${draftId}`), sleeperJson(`/draft/${draftId}/picks`)]);
    const users = draft.league_id ? await sleeperJson(`/league/${draft.league_id}/users`) : [];
    return Response.json({ draft, picks, users }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Sleeper could not be reached.", { status: 502 });
  }
}
