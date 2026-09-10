import { CAPTURE } from "./config.mjs";
import { nominatimLimiter } from "./core/limits.mjs";

export async function geocodeCity(city) {
  const q = String(city || "").trim();
  if (!q) throw new Error("Cidade vazia");
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q.includes("Brasil") ? q : `${q}, Brasil`);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "0");

  return nominatimLimiter.call(async () => {
    const res = await fetch(url, {
      headers: { "User-Agent": CAPTURE.userAgent, Accept: "application/json" },
      signal: AbortSignal.timeout(CAPTURE.requestTimeoutMs),
    });
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data) || !data[0]) throw new Error(`Cidade nao encontrada: ${q}`);
    const hit = data[0];
    const bb = Array.isArray(hit.boundingbox) ? hit.boundingbox.map(Number) : null;
    return {
      lat: Number(hit.lat),
      lon: Number(hit.lon),
      displayName: hit.display_name,
      bbox: bb
        ? { south: bb[0], north: bb[1], west: bb[2], east: bb[3] }
        : null,
    };
  });
}

export function radiusForCity(city) {
  const key = String(city || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(",")[0]
    .trim();
  return CAPTURE.cityRadiusMeters[key] || CAPTURE.cityRadiusMeters.default;
}

export function shrinkBbox(bbox, maxSpanDegrees = 0.28) {
  if (!bbox) return null;
  let { south, north, west, east } = bbox;
  const latMid = (south + north) / 2;
  const lonMid = (west + east) / 2;
  const latSpan = Math.min(north - south, maxSpanDegrees);
  const lonSpan = Math.min(east - west, maxSpanDegrees);
  return {
    south: latMid - latSpan / 2,
    north: latMid + latSpan / 2,
    west: lonMid - lonSpan / 2,
    east: lonMid + lonSpan / 2,
  };
}
