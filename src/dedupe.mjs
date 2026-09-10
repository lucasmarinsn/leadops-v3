import { createHash } from "node:crypto";
import { JUNK_HOSTS, JUNK_NAME } from "./config.mjs";

export function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\b(ltda|me|eireli|ss|sa|s\/a|comercio|comércio)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function hostFromUrl(url) {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function isJunkHost(urlOrHost) {
  const h = urlOrHost.includes("/") ? hostFromUrl(urlOrHost) : String(urlOrHost || "");
  if (!h) return false;
  return JUNK_HOSTS.test(h);
}

export function isJunkName(name) {
  return JUNK_NAME.test(String(name || ""));
}

export function isJunkLead(lead) {
  if (!lead?.name) return true;
  if (isJunkName(lead.name)) return true;
  if (lead.website && isJunkHost(lead.website)) return true;
  return false;
}

export function leadKey(lead) {
  const host = hostFromUrl(lead.website || "");
  if (host) return `host:${host}`;
  const phone = String(lead.phone || "").replace(/\D/g, "");
  if (phone.length >= 10) return `phone:${phone.slice(-10)}`;
  return `name:${normalizeName(lead.name)}|${normalizeName(lead.city)}`;
}

export function mergeLeads(a, b) {
  const sources = new Set([
    ...(a.sources || [a.source].filter(Boolean)),
    ...(b.sources || [b.source].filter(Boolean)),
  ]);
  return {
    ...a,
    ...Object.fromEntries(
      Object.entries(b).filter(([, v]) => v !== "" && v != null && v !== false)
    ),
    name: a.name?.length >= (b.name?.length || 0) ? a.name : b.name,
    phone: a.phone || b.phone || "",
    phoneSource: a.phone ? a.phoneSource : b.phoneSource || "",
    website: a.website || b.website || "",
    email: a.email || b.email || "",
    address: a.address || b.address || "",
    lat: a.lat ?? b.lat ?? null,
    lon: a.lon ?? b.lon ?? null,
    osmUrl: a.osmUrl || b.osmUrl || "",
    source: [...sources].join("+") || a.source || b.source || "",
    sources: [...sources],
  };
}

export function dedupeLeads(leads) {
  const map = new Map();
  for (const lead of leads) {
    if (!lead?.name || isJunkLead(lead)) continue;
    const key = leadKey(lead);
    const prev = map.get(key);
    map.set(key, prev ? mergeLeads(prev, lead) : { ...lead, sources: lead.sources || [lead.source].filter(Boolean) });
  }
  return [...map.values()];
}

export function stableId(lead) {
  if (lead.id && !String(lead.id).startsWith("tmp:")) return lead.id;
  const raw = leadKey(lead);
  return `web:${createHash("sha1").update(raw).digest("hex").slice(0, 12)}`;
}
