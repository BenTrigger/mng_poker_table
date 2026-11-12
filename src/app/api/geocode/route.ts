import { NextResponse } from "next/server";

/**
 * Address -> coordinates, so the Waze button can open navigation to an exact
 * point. Waze's app often ignores a free-text (Hebrew) "q=" search and just
 * opens the map; "ll=lat,lng" is reliable. Uses OpenStreetMap Nominatim,
 * cached at the edge for a day so each address is looked up rarely.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim().slice(0, 200);
  if (!q) return NextResponse.json({ error: "missing q" }, { status: 400 });
  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=il&accept-language=he&q=" +
    encodeURIComponent(q);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "pokertable-app/1.0 (home poker table manager)" },
      signal: AbortSignal.timeout(5000),
    });
    const rows = res.ok ? ((await res.json()) as { lat: string; lon: string }[]) : [];
    const hit = rows[0];
    const body = hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : { lat: null, lng: null };
    return NextResponse.json(body, {
      headers: { "Cache-Control": hit ? "public, s-maxage=86400, stale-while-revalidate=604800" : "public, s-maxage=600" },
    });
  } catch {
    return NextResponse.json({ lat: null, lng: null }, { headers: { "Cache-Control": "no-store" } });
  }
}
