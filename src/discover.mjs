import { CAPTURE, NICHE_NOMINATIM, NICHE_WEB_QUERIES } from "./config.mjs";
import { stableId } from "./dedupe.mjs";
import { phonesFromOsmTags, normalizePhone } from "./phone.mjs";
import { searchWeb } from "./websearch.mjs";
import { nominatimLimiter, webSearchLimiter } from "./core/limits.mjs";

function websiteFromExtras(extra = {}) {
  const raw = extra.website || extra.url || extra["contact:website"] || "";
  const v = String(raw).trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}

function phoneFromExtras(extra = {}) {
  return phonesFromOsmTags(extra) || normalizePhone(extra.phone || extra["contact:phone"] || "");
}

export async function nominatimSearch(query, { limit = 20 } = {}) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("extratags", "1");
  url.searchParams.set("namedetails", "1");
  url.searchParams.set("countrycodes", "br");
  url.searchParams.set("limit", String(Math.min(limit, 40)));

  return nominatimLimiter.call(async () => {
    const res = await fetch(url, {
      headers: { "User-Agent": CAPTURE.userAgent, Accept: "application/json" },
      signal: AbortSignal.timeout(CAPTURE.requestTimeoutMs),
    });
    if (!res.ok) throw new Error(`Nominatim search HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  });
}

function mapNominatimHit(hit, niche, city) {
  const name = String(hit.namedetails?.name || hit.display_name?.split(",")[0] || "").trim();
  if (!name || name.length < 2) return null;
  const extra = hit.extratags || {};
  const phone = phoneFromExtras(extra);
  const website = websiteFromExtras(extra);
  const osmType = hit.osm_type === "node" ? "node" : hit.osm_type === "way" ? "way" : "relation";
  const addr = hit.address || {};
  const address = [
    [addr.road, addr.house_number].filter(Boolean).join(", "),
    addr.suburb || addr.neighbourhood,
    addr.city || addr.town || addr.municipality || city,
  ]
    .filter(Boolean)
    .join(" — ");

  return {
    id: hit.osm_id ? `${osmType}/${hit.osm_id}` : stableId({ name, city, website }),
    name,
    niche,
    city,
    category: hit.type || hit.class || "",
    address,
    phone,
    phoneSource: phone ? "nominatim" : "",
    website,
    email: extra.email || extra["contact:email"] || "",
    lat: Number(hit.lat) || null,
    lon: Number(hit.lon) || null,
    osmUrl: hit.osm_id ? `https://www.openstreetmap.org/${osmType}/${hit.osm_id}` : "",
    source: "nominatim",
  };
}

export async function discoverNominatim({ niche, city, limit }) {
  const terms = NICHE_NOMINATIM[niche] || [niche];
  const leads = [];
  for (const term of terms.slice(0, 3)) {
    const q = `${term} ${city} Brasil`;
    try {
      const hits = await nominatimSearch(q, { limit: Math.min(25, limit) });
      for (const hit of hits) {
        const lead = mapNominatimHit(hit, niche, city);
        if (lead) leads.push(lead);
      }
    } catch {
      /* continue */
    }
  }
  return leads;
}

function mapWebHit(hit, niche, city) {
  const name = String(hit.title || "")
    .replace(new RegExp(city, "ig"), "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\-|–|—|:]\s*/, "")
    .slice(0, 80);
  if (!name || name.length < 3) return null;
  const website = hit.url;
  return {
    id: stableId({ name, city, website }),
    name,
    niche,
    city,
    category: "web",
    address: city,
    phone: "",
    phoneSource: "",
    website,
    email: "",
    lat: null,
    lon: null,
    osmUrl: "",
    source: "web",
  };
}

export async function discoverWeb({ niche, city, limit }) {
  const templates = NICHE_WEB_QUERIES[niche] || [
    `"${niche}" "${city}" telefone`,
    `"${niche}" "${city}" contato site`,
  ];
  const leads = [];
  for (const tpl of templates.slice(0, 3)) {
    const q = tpl.replaceAll("{city}", city);
    try {
      const { hits } = await webSearchLimiter.call(() =>
        searchWeb(q, { max: Math.min(14, Math.ceil(limit / 2)) })
      );
      for (const hit of hits) {
        const lead = mapWebHit(hit, niche, city);
        if (lead) leads.push(lead);
      }
    } catch {
      /* continue */
    }
  }
  return leads;
}
