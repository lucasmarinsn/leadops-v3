import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CAPTURE, NICHE_QUERIES } from "./config.mjs";
import { toCsv, stamp } from "./csv.mjs";
import { dedupeLeads, isJunkLead, stableId } from "./dedupe.mjs";
import { discoverNominatim, discoverWeb } from "./discover.mjs";
import { enrichLeads } from "./enrich.mjs";
import { geocodeCity, radiusForCity, shrinkBbox } from "./geocode.mjs";
import { buildHtml } from "./html.mjs";
import { fetchOverpassLeads, mapElement } from "./overpass.mjs";
import { qualifyAll } from "./qualify-lib.mjs";
import { outDir } from "./db/store.mjs";
import { log } from "./core/logger.mjs";

export { outDir };

const NICHE_ALIASES = {
  "representante comercial": "representante",
  representantes: "representante",
  imobiliária: "imobiliaria",
  imobiliarias: "imobiliaria",
  academias: "academia",
  agência: "agencia",
  agencias: "agencia",
  clínica: "clinica",
  clinicas: "clinica",
  restaurantes: "restaurante",
  hotéis: "hotel",
  hoteis: "hotel",
  "salão": "salao",
  saloes: "salao",
  oficinas: "oficina",
};

function resolveNiche(raw) {
  const clean = String(raw || "").trim().toLowerCase();
  if (!clean) return "";
  if (NICHE_QUERIES[clean]) return clean;
  if (NICHE_ALIASES[clean]) return NICHE_ALIASES[clean];
  for (const key of Object.keys(NICHE_QUERIES)) {
    if (clean.includes(key)) return key;
  }
  return clean;
}

const CSV_COLUMNS = [
  "grade",
  "score",
  "name",
  "phone",
  "phoneSource",
  "website",
  "email",
  "address",
  "source",
  "category",
  "city",
  "niche",
  "why",
  "nextAction",
  "callScript",
  "osmUrl",
  "lat",
  "lon",
];

function emit(onProgress, payload) {
  if (typeof onProgress === "function") onProgress(payload);
}

function rankCandidate(lead) {
  let s = 0;
  if (lead.phone) s += 50;
  if (lead.website) s += 25;
  if (lead.email) s += 8;
  if (lead.address && lead.address !== lead.city) s += 8;
  if (lead.lat != null) s += 4;
  if (String(lead.source || "").includes("web")) s += 6;
  if (String(lead.source || "").includes("nominatim")) s += 4;
  if (String(lead.source || "").includes("osm")) s += 3;
  s += Number(lead.osmContactScore || 0);
  return s;
}

function qualityFilter(leads, { quality, limit }) {
  const usable = leads.filter((l) => !isJunkLead(l));
  if (!quality) {
    return usable.sort((a, b) => rankCandidate(b) - rankCandidate(a)).slice(0, limit);
  }
  const withContact = usable.filter((l) => l.phone || l.website);
  const ranked = withContact.sort((a, b) => rankCandidate(b) - rankCandidate(a));
  if (ranked.length >= Math.min(8, limit)) return ranked.slice(0, limit);
  const rest = usable
    .filter((l) => !ranked.includes(l))
    .sort((a, b) => rankCandidate(b) - rankCandidate(a));
  return [...ranked, ...rest].slice(0, limit);
}

function finalizeIds(leads) {
  return leads.map((l) => ({ ...l, id: stableId(l) }));
}

export async function runCapture(
  { niche, city, limit, quality = CAPTURE.qualityDefault, sources = ["osm", "nominatim", "web"] },
  { onProgress } = {}
) {
  const cleanNiche = resolveNiche(niche);
  const cleanCity = String(city || "").trim();
  const cleanLimit = Math.min(
    Math.max(Number(limit) || CAPTURE.defaultLimit, 5),
    CAPTURE.maxLimit
  );
  const wantQuality = quality !== false && quality !== "false";
  const src = new Set(sources?.length ? sources : ["osm", "nominatim", "web"]);
  const candidateTarget = Math.min(
    cleanLimit * CAPTURE.candidateMultiplier,
    CAPTURE.maxLimit * 2
  );

  if (!cleanNiche) throw new Error("Informe o nicho");
  if (!cleanCity) throw new Error("Informe a cidade");

  mkdirSync(outDir, { recursive: true });
  const bucket = [];

  emit(onProgress, { step: "geocode", message: "Localizando cidade…", percent: 5 });
  const geo = await geocodeCity(cleanCity);
  const radiusMeters = radiusForCity(cleanCity);
  const bbox = shrinkBbox(geo.bbox, 0.28);

  emit(onProgress, {
    step: "geocode",
    message: "Cidade localizada",
    percent: 12,
    detail: geo.displayName,
  });

  if (src.has("nominatim")) {
    emit(onProgress, {
      step: "nominatim",
      message: "Buscando empresas no Nominatim (com telefone/site)…",
      percent: 18,
    });
    try {
      const nom = await discoverNominatim({
        niche: cleanNiche,
        city: cleanCity,
        limit: candidateTarget,
      });
      bucket.push(...nom);
      emit(onProgress, {
        step: "nominatim",
        message: `Nominatim: ${nom.length} candidatos`,
        percent: 28,
        detail: `${bucket.length} no total`,
      });
    } catch (err) {
      emit(onProgress, {
        step: "nominatim",
        message: `Nominatim falhou: ${err.message}`,
        percent: 28,
      });
    }
  }

  if (src.has("osm")) {
    emit(onProgress, {
      step: "overpass",
      message: "Buscando no OpenStreetMap (Overpass)…",
      percent: 35,
    });
    try {
      const { elements } = await fetchOverpassLeads({
        niche: cleanNiche,
        lat: geo.lat,
        lon: geo.lon,
        radiusMeters,
        bbox,
        limit: candidateTarget,
      });
      for (const el of elements) {
        const lead = mapElement(el, cleanNiche, cleanCity);
        if (lead) bucket.push(lead);
      }
      emit(onProgress, {
        step: "overpass",
        message: `OSM: ${elements.length} pontos`,
        percent: 48,
        detail: `${bucket.length} candidatos brutos`,
      });
    } catch (err) {
      emit(onProgress, {
        step: "overpass",
        message: `OSM falhou: ${err.message}`,
        percent: 48,
      });
    }
  }

  if (src.has("web")) {
    emit(onProgress, {
      step: "web",
      message: "Descobrindo empresas na busca web (gratis)…",
      percent: 55,
    });
    try {
      const web = await discoverWeb({
        niche: cleanNiche,
        city: cleanCity,
        limit: candidateTarget,
      });
      bucket.push(...web);
      emit(onProgress, {
        step: "web",
        message: `Web: ${web.length} sites`,
        percent: 65,
        detail: `${bucket.length} candidatos brutos`,
      });
    } catch (err) {
      emit(onProgress, {
        step: "web",
        message: `Busca web falhou: ${err.message}`,
        percent: 65,
      });
    }
  }

  let merged = dedupeLeads(bucket);
  emit(onProgress, {
    step: "dedupe",
    message: `Unificando fontes: ${merged.length} unicos`,
    percent: 70,
  });

  const enrichPool = qualityFilter(merged, {
    quality: false,
    limit: Math.max(candidateTarget, cleanLimit),
  });

  emit(onProgress, {
    step: "enrich",
    message: `Extraindo telefones dos sites (${enrichPool.length})…`,
    percent: 72,
    found: enrichPool.length,
  });

  const enriched = await enrichLeads(enrichPool, {
    onItem: (idx, total) => {
      const span = 18;
      const percent = 72 + Math.round((idx / Math.max(total, 1)) * span);
      emit(onProgress, {
        step: "enrich",
        message: `Telefone ${idx}/${total}…`,
        percent,
      });
    },
  });

  const filtered = finalizeIds(
    qualityFilter(enriched, { quality: wantQuality, limit: cleanLimit })
  );

  emit(onProgress, { step: "qualify", message: "Qualificando A / B / C…", percent: 93 });
  const qualified = qualifyAll(filtered);
  const withPhone = qualified.filter((l) => l.phone).length;
  const withWebsite = qualified.filter((l) => l.website).length;

  const id = stamp();
  const slug = cleanNiche.replace(/\s+/g, "-");
  const base = `leads-${slug}-${id}`;
  const jsonPath = resolve(outDir, `${base}.json`);
  const csvPath = resolve(outDir, `${base}.csv`);
  const htmlPath = resolve(outDir, `fila-${slug}.html`);

  const meta = {
    niche: cleanNiche,
    city: cleanCity,
    limit: cleanLimit,
    quality: wantQuality,
    sources: [...src],
    withPhone,
    withWebsite,
    candidatesRaw: bucket.length,
    candidatesUnique: merged.length,
    place: geo.displayName,
    generatedAt: new Date().toISOString(),
    scriptVersion: 3,
  };

  writeFileSync(jsonPath, JSON.stringify({ meta, leads: qualified }, null, 2));
  writeFileSync(csvPath, toCsv(qualified, CSV_COLUMNS));
  writeFileSync(
    htmlPath,
    buildHtml(qualified, {
      niche: cleanNiche,
      city: cleanCity,
      generatedAt: new Date().toLocaleString("pt-BR"),
    })
  );

  const summary = {
    total: qualified.length,
    withPhone,
    withWebsite,
    withoutPhone: qualified.length - withPhone,
    grades: {
      A: qualified.filter((l) => l.grade === "A").length,
      B: qualified.filter((l) => l.grade === "B").length,
      C: qualified.filter((l) => l.grade === "C").length,
    },
    sources: meta.sources,
    quality: wantQuality,
    file: `${base}.json`,
    files: { json: jsonPath, csv: csvPath, html: htmlPath },
  };

  emit(onProgress, { step: "done", message: "Pronto", percent: 100, summary });
  log.info("capture_pipeline_done", {
    niche: cleanNiche,
    city: cleanCity,
    total: summary.total,
    withPhone: summary.withPhone,
  });
  return { meta, leads: qualified, summary };
}
