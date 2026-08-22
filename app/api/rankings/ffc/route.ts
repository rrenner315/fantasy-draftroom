const allowedFormats = new Set(["standard", "half-ppr", "ppr", "2qb"]);
const allowedTeams = new Set([8, 10, 12, 14]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const format = url.searchParams.get("format") || "half-ppr";
  const teams = Number(url.searchParams.get("teams") || 12);
  if (!allowedFormats.has(format) || !allowedTeams.has(teams)) {
    return new Response("Unsupported rankings format.", { status: 400 });
  }

  try {
    const response = await fetch(`https://fantasyfootballcalculator.com/api/v1/adp/${format}?teams=${teams}&year=${new Date().getFullYear()}`, {
      headers: { Accept: "application/json", "User-Agent": "The Program fantasy draft app" },
    });
    if (!response.ok) return new Response("The rankings provider is unavailable.", { status: 502 });
    return Response.json(await response.json(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return new Response("The rankings provider could not be reached.", { status: 502 });
  }
}
