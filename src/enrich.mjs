import { CAPTURE } from "./config.mjs";
import { extractPhonesFromText, pickBestPhone } from "./phone.mjs";

const SKIP_HOST =
  /facebook\.com|instagram\.com|twitter\.com|x\.com|linkedin\.com|youtube\.com|tiktok\.com|google\.|wa\.me|api\.whatsapp/i;

function sameOriginPaths(website) {
  let base;
  try {
    base = new URL(website);
  } catch {
    return [];
  }
  if (SKIP_HOST.test(base.hostname)) return [];
  const roots = [
    base.href,
    new URL("/contato", base).href,
    new URL("/contact", base).href,
    new URL("/fale-conosco", base).href,
    new URL("/faleconosco", base).href,
    new URL("/sobre", base).href,
    new URL("/about", base).href,
    new URL("/quem-somos", base).href,
    new URL("/empresa", base).href,
  ];
  return [...new Set(roots)];
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": CAPTURE.userAgent,
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(CAPTURE.websiteTimeoutMs),
  });
  if (!res.ok) return "";
  const ctype = res.headers.get("content-type") || "";
  if (!/text\/html|application\/xhtml/i.test(ctype) && ctype && !ctype.includes("text/")) {
    return "";
  }
  const buf = await res.arrayBuffer();
  const slice = buf.byteLength > CAPTURE.maxWebsiteBytes ? buf.slice(0, CAPTURE.maxWebsiteBytes) : buf;
  return new TextDecoder("utf-8", { fatal: false }).decode(slice);
}

function stripNoise(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

export async function enrichPhoneFromWebsite(lead) {
  if (lead.phone) return lead;
  if (!lead.website) return lead;

  const phones = [];
  const emails = [];
  for (const url of sameOriginPaths(lead.website)) {
    try {
      const html = await fetchText(url);
      if (!html) continue;
      const telMatches = [...html.matchAll(/href=["']tel:([^"']+)["']/gi)].map((m) => m[1]);
      const waMatches = [...html.matchAll(/wa\.me\/(\d{10,13})/gi)].map((m) => m[1]);
      const mailMatches = [...html.matchAll(/mailto:([^\s"'?]+)/gi)].map((m) => m[1]);
      phones.push(...telMatches, ...waMatches, ...extractPhonesFromText(stripNoise(html)));
      emails.push(...mailMatches);
      if (pickBestPhone(phones)) break;
    } catch {
      continue;
    }
  }

  const phone = pickBestPhone(phones);
  const email = emails.find((e) => e && e.includes("@")) || lead.email || "";
  if (!phone && !email) return lead;
  return {
    ...lead,
    phone: phone || lead.phone || "",
    phoneSource: phone ? "website" : lead.phoneSource || "",
    email: email || lead.email || "",
  };
}

export async function enrichLeadSmart(lead) {
  const { applyScrapegraphToLead, scrapegraphEnrich } = await import("./scrapegraph.mjs");
  if (!lead.website) return lead;
  let base = lead;
  if (!lead.phone) {
    base = await enrichPhoneFromWebsite(lead);
  }
  const data = await scrapegraphEnrich(base.website);
  return applyScrapegraphToLead(base, data);
}

export async function enrichLeads(
  leads,
  { concurrency = CAPTURE.enrichConcurrency, onItem, quiet = false } = {}
) {
  const out = [];
  let i = 0;
  let done = 0;
  async function worker() {
    while (i < leads.length) {
      const idx = i;
      i += 1;
      const lead = leads[idx];
      out[idx] = await enrichPhoneFromWebsite(lead);
      done += 1;
      if (typeof onItem === "function") onItem(done, leads.length);
      else if (!quiet) process.stdout.write(`\rEnriquecendo telefone ${done}/${leads.length}...`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, leads.length || 1) }, () => worker()));
  if (!quiet && typeof onItem !== "function") process.stdout.write("\n");
  return out;
}
