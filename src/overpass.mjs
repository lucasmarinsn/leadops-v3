import { CAPTURE, NICHE_QUERIES } from "./config.mjs";
import { phonesFromOsmTags } from "./phone.mjs";
import { overpassLimiter } from "./core/limits.mjs";
import { withRetry } from "./core/async.mjs";

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function areaFilter(bbox, lat, lon, radiusMeters) {
  if (bbox) {
    return `(${bbox.south},${bbox.west},${bbox.north},${bbox.east})`;
  }
  return `(around:${radiusMeters},${lat},${lon})`;
}

function expandNwr(clause, area) {
  const m = clause.match(/^nwr(\[.*)$/);
  if (!m) return `${clause}${area};`;
  const tags = m[1];
  return `node${tags}${area};\n  way${tags}${area};\n  relation${tags}${area};`;
}

function buildQuery({ niche, lat, lon, radiusMeters, bbox, limit }) {
  const area = areaFilter(bbox, lat, lon, radiusMeters);
  const presets = NICHE_QUERIES[niche];
  let clauses;
  if (presets) {
    clauses = presets.map((c) => expandNwr(c, area)).join("\n  ");
  } else {
    const pattern = escapeRegex(niche).slice(0, 40);
    clauses = [
      `node["name"~"${pattern}",i]${area};`,
      `way["name"~"${pattern}",i]${area};`,
      `node["shop"~"${pattern}",i]${area};`,
      `node["office"~"${pattern}",i]${area};`,
      `node["craft"~"${pattern}",i]${area};`,
    ].join("\n  ");
  }

  const outCount = Math.min(Math.max(limit * 4, 60), 250);
  return `
[out:json][timeout:90];
(
  ${clauses}
);
out center tags ${outCount};
`.trim();
}

async function postOverpass(url, query) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": CAPTURE.userAgent,
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: new URLSearchParams({ data: query }).toString(),
    signal: AbortSignal.timeout(CAPTURE.requestTimeoutMs),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Overpass HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Overpass JSON invalido: ${text.slice(0, 200)}`);
  }
}

function elementCoords(el) {
  if (typeof el.lat === "number" && typeof el.lon === "number") {
    return { lat: el.lat, lon: el.lon };
  }
  if (el.center && typeof el.center.lat === "number") {
    return { lat: el.center.lat, lon: el.center.lon };
  }
  return { lat: null, lon: null };
}

function websiteFromTags(tags = {}) {
  const raw = tags.website || tags["contact:website"] || tags.url || "";
  const v = String(raw).trim();
  if (!v) return "";
  if (v.startsWith("http://") || v.startsWith("https://")) return v;
  return `https://${v}`;
}

function addressFromTags(tags = {}) {
  const parts = [
    [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(", "),
    tags["addr:suburb"] || tags["addr:neighbourhood"],
    tags["addr:city"],
    tags["addr:state"],
    tags["addr:postcode"],
  ].filter(Boolean);
  return parts.join(" — ");
}

function categoryFromTags(tags = {}) {
  return (
    tags.amenity ||
    tags.shop ||
    tags.office ||
    tags.leisure ||
    tags.tourism ||
    tags.healthcare ||
    tags.craft ||
    ""
  );
}

function contactScore(tags = {}) {
  let s = 0;
  if (tags.phone || tags["contact:phone"] || tags.mobile) s += 3;
  if (tags.website || tags["contact:website"] || tags.url) s += 2;
  if (tags.email || tags["contact:email"]) s += 1;
  if (tags["addr:street"]) s += 1;
  return s;
}

export function mapElement(el, niche, city) {
  const tags = el.tags || {};
  const name = String(tags.name || tags.brand || "").trim();
  if (!name) return null;
  const { lat, lon } = elementCoords(el);
  const phone = phonesFromOsmTags(tags);
  return {
    id: `${el.type}/${el.id}`,
    name,
    niche,
    city,
    category: categoryFromTags(tags),
    address: addressFromTags(tags),
    phone,
    phoneSource: phone ? "osm" : "",
    website: websiteFromTags(tags),
    email: tags.email || tags["contact:email"] || "",
    lat,
    lon,
    osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    source: "osm",
    osmContactScore: contactScore(tags),
  };
}

export async function fetchOverpassLeads({ niche, lat, lon, radiusMeters, bbox, limit }) {
  const query = buildQuery({ niche, lat, lon, radiusMeters, bbox, limit });
  let lastError;
  for (const url of CAPTURE.overpassUrls) {
    try {
      const data = await overpassLimiter.call(() =>
        withRetry(() => postOverpass(url, query), {
          retries: 1,
          delayMs: 1000,
          label: "overpass",
        })()
      );
      const elements = Array.isArray(data.elements) ? data.elements : [];
      elements.sort((a, b) => contactScore(b.tags || {}) - contactScore(a.tags || {}));
      return { query, elements, url };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("Todos os servidores Overpass falharam");
}
