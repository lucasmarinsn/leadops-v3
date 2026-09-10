import { CAPTURE } from "./config.mjs";
import { hostFromUrl, isJunkHost } from "./dedupe.mjs";

function decodeDdg(href) {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    if (href.startsWith("http")) return href;
  } catch {
    /* ignore */
  }
  return href;
}

function cleanTitle(title) {
  return String(title || "")
    .replace(/\s*[\-|–|—|:]\s*(telefone|contato|oficial|home|in[ií]cio).*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}

function extractLinks(html, { max = 20 } = {}) {
  const out = [];
  const seen = new Set();
  const re =
    /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(html || "").matchAll(re)) {
    let href = match[1];
    const text = cleanTitle(match[2].replace(/<[^>]+>/g, " "));
    if (!href || !text || text.length < 3) continue;
    href = decodeDdg(href);
    if (!/^https?:\/\//i.test(href)) continue;
    if (isJunkHost(href)) continue;
    const host = hostFromUrl(href);
    if (!host || seen.has(host)) continue;
    if (/duckduckgo\.|bing\.com|google\./i.test(host)) continue;
    seen.add(host);
    out.push({ title: text, url: href.split("#")[0], host });
    if (out.length >= max) break;
  }
  return out;
}

async function fetchText(url, { method = "GET", body } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      "User-Agent": CAPTURE.userAgent,
      Accept: "text/html,application/xhtml+xml",
      "Content-Type": method === "POST" ? "application/x-www-form-urlencoded" : undefined,
    },
    body,
    redirect: "follow",
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Search HTTP ${res.status}`);
  return res.text();
}

export async function searchDuckDuckGo(query, { max = 12 } = {}) {
  const html = await fetchText("https://html.duckduckgo.com/html/", {
    method: "POST",
    body: new URLSearchParams({ q: query }).toString(),
  });
  return extractLinks(html, { max });
}

export async function searchBing(query, { max = 12 } = {}) {
  const url = new URL("https://www.bing.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(max, 30)));
  url.searchParams.set("setlang", "pt-BR");
  const html = await fetchText(url.toString());
  return extractLinks(html, { max });
}

export async function searchWeb(query, { max = 12 } = {}) {
  try {
    const hits = await searchDuckDuckGo(query, { max });
    if (hits.length) return { engine: "duckduckgo", hits };
  } catch {
    /* fallback */
  }
  const hits = await searchBing(query, { max });
  return { engine: "bing", hits };
}
