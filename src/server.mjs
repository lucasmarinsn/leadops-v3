import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CAPTURE, COMPANY, RUNTIME, nicheKeys, NICHE_CATALOG } from "./config.mjs";
import { STATUS_OPTIONS } from "./qualify-lib.mjs";
import { toCsv } from "./csv.mjs";
import { scrapegraphAvailable } from "./scrapegraph.mjs";
import { normalizePhone } from "./phone.mjs";
import { log } from "./core/logger.mjs";
import {
  getCampaignBundle,
  importLegacyJsonFiles,
  importSeedQualified,
  listCampaigns,
  listRecentJobs,
  metrics,
  patchLead as dbPatchLead,
  replaceCampaignLeads,
  resolveCampaignId,
  getJob,
} from "./db/store.mjs";
import {
  enqueueCapture,
  enqueueEnrich,
  publicJob,
  startWorkers,
} from "./jobs/queue.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const publicDir = resolve(root, "public");
const PORT = RUNTIME.port;
const HOST = RUNTIME.host;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".ico": "image/x-icon",
};

const EXPORT_COLUMNS = [
  "grade",
  "score",
  "status",
  "name",
  "phone",
  "phoneSource",
  "whatsapp",
  "address",
  "website",
  "email",
  "category",
  "city",
  "niche",
  "source",
  "why",
  "nextAction",
  "aiSummary",
  "aiHook",
  "aiFit",
  "aiFitWhy",
  "aiJunk",
  "aiJunkReason",
  "notes",
  "callScript",
  "follow",
  "osmUrl",
];

function send(res, status, body, type = "text/plain; charset=utf-8", extra = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Length": buf.length,
    "Cache-Control": "no-store",
    ...extra,
  });
  res.end(buf);
}

function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data), "application/json; charset=utf-8");
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("JSON invalido");
  }
}

function serveStatic(reqPath, res) {
  const clean = reqPath === "/" ? "/index.html" : reqPath.split("?")[0];
  const filePath = resolve(publicDir, "." + clean);
  if (!filePath.startsWith(publicDir)) {
    send(res, 403, "Forbidden");
    return;
  }
  if (!existsSync(filePath)) {
    send(res, 404, "Not found");
    return;
  }
  send(res, 200, readFileSync(filePath), MIME[extname(filePath)] || "application/octet-stream");
}

function loadCampaign(fileOrId) {
  const id = resolveCampaignId(fileOrId);
  if (!id) return null;
  return getCampaignBundle(id);
}

importLegacyJsonFiles();
importSeedQualified();
startWorkers();

const startedAt = new Date().toISOString();

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
  const { pathname } = url;
  const method = req.method || "GET";

  try {
    if (method === "GET" && pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        app: RUNTIME.appName,
        version: RUNTIME.appVersion,
        startedAt,
        metrics: metrics(),
      });
      return;
    }

    if (method === "GET" && pathname === "/api/metrics") {
      sendJson(res, 200, metrics());
      return;
    }

    if (method === "GET" && pathname === "/api/meta") {
      const ai = scrapegraphAvailable();
      sendJson(res, 200, {
        app: RUNTIME.appName,
        version: RUNTIME.appVersion,
        niches: nicheKeys(),
        catalog: NICHE_CATALOG,
        statuses: STATUS_OPTIONS,
        company: COMPANY,
        scrapegraph: {
          available: ai,
          defaultLimit: CAPTURE.scrapegraphDefaultLimit,
          maxLimit: CAPTURE.scrapegraphMaxLimit,
        },
        defaults: {
          limit: CAPTURE.defaultLimit,
          maxLimit: CAPTURE.maxLimit,
          city: "Porto Alegre",
          quality: CAPTURE.qualityDefault,
        },
        runtime: {
          maxConcurrentCaptures: RUNTIME.maxConcurrentCaptures,
          maxConcurrentEnrich: RUNTIME.maxConcurrentEnrich,
        },
        cost: ai
          ? "Captura multi-fonte gratis. IA (MiMo) so no enriquecimento."
          : "Captura multi-fonte gratis: OSM + Nominatim + busca web",
        captureModes: {
          quality: true,
          sources: ["osm", "nominatim", "web"],
        },
      });
      return;
    }

    if (method === "GET" && (pathname === "/api/batches" || pathname === "/api/campaigns")) {
      sendJson(res, 200, { batches: listCampaigns(), campaigns: listCampaigns() });
      return;
    }

    if (method === "GET" && pathname === "/api/leads") {
      const data = loadCampaign(url.searchParams.get("file") || url.searchParams.get("campaignId") || "");
      if (!data) {
        sendJson(res, 404, { error: "Campanha nao encontrada" });
        return;
      }
      sendJson(res, 200, {
        meta: data.meta,
        leads: data.leads,
        campaign: data.campaign,
      });
      return;
    }

    if (method === "PATCH" && pathname === "/api/leads") {
      const body = await readBody(req);
      const campaignId = resolveCampaignId(body.file || body.campaignId);
      if (!campaignId) throw new Error("Campanha nao encontrada");
      const patch = { ...(body.patch || {}) };
      if (patch.phone !== undefined) {
        patch.phone = normalizePhone(patch.phone) || String(patch.phone || "").trim();
        patch.phoneSource = patch.phone ? "manual" : "";
      }
      const lead = dbPatchLead(campaignId, body.id, patch);
      sendJson(res, 200, { lead });
      return;
    }

    if (method === "POST" && pathname === "/api/leads/enrich") {
      const body = await readBody(req);
      const job = enqueueEnrich({
        file: body.file || body.campaignId,
        campaignId: body.campaignId || body.file,
        id: body.id || null,
        limit: body.limit,
        mode: body.mode || "free",
        force: Boolean(body.force),
      });
      sendJson(res, 202, publicJob(job));
      return;
    }

    if (method === "POST" && pathname === "/api/leads/skip-no-phone") {
      const body = await readBody(req);
      const campaignId = resolveCampaignId(body.file || body.campaignId);
      if (!campaignId) throw new Error("Campanha nao encontrada");
      const bundle = getCampaignBundle(campaignId);
      let changed = 0;
      const leads = (bundle.leads || []).map((l) => {
        if (l.phone) return l;
        if ((l.status || "todo") === "skip") return l;
        changed += 1;
        return { ...l, status: "skip", grade: l.grade || "C", calledAt: new Date().toISOString() };
      });
      replaceCampaignLeads(campaignId, leads);
      sendJson(res, 200, { changed, leads, meta: bundle.meta, file: campaignId });
      return;
    }

    if (method === "GET" && pathname === "/api/export") {
      const data = loadCampaign(url.searchParams.get("file") || url.searchParams.get("campaignId") || "");
      if (!data) {
        sendJson(res, 404, { error: "Campanha nao encontrada" });
        return;
      }
      const grade = url.searchParams.get("grade");
      const onlyPhone = url.searchParams.get("phone") === "1";
      let leads = data.leads || [];
      if (grade && grade !== "all") leads = leads.filter((l) => l.grade === grade);
      if (onlyPhone) leads = leads.filter((l) => l.phone);
      const csv = toCsv(leads, EXPORT_COLUMNS);
      const name = `${data.campaign.niche}-${data.campaign.city}`.replace(/\s+/g, "-") + ".csv";
      send(res, 200, csv, "text/csv; charset=utf-8", {
        "Content-Disposition": `attachment; filename="${name}"`,
      });
      return;
    }

    if (method === "GET" && pathname.startsWith("/api/jobs/")) {
      const id = pathname.slice("/api/jobs/".length);
      const job = getJob(id);
      if (!job) {
        sendJson(res, 404, { error: "Job nao encontrado" });
        return;
      }
      const pub = publicJob(job);
      if (job.status === "done" && job.result?.summary && job.type === "enrich") {
        const bundle = job.campaignId ? getCampaignBundle(job.campaignId) : null;
        sendJson(res, 200, {
          ...pub,
          ...job.result.summary,
          leads: bundle?.leads || [],
          meta: bundle?.meta || null,
        });
        return;
      }
      sendJson(res, 200, pub);
      return;
    }

    if (method === "GET" && pathname === "/api/jobs") {
      const recent = listRecentJobs(30).map(publicJob);
      const active = recent.find((j) => j.status === "running" || j.status === "queued") || null;
      sendJson(res, 200, { active, recent });
      return;
    }

    if (method === "POST" && pathname === "/api/capture") {
      const body = await readBody(req);
      const job = enqueueCapture({
        niche: body.niche,
        city: body.city,
        limit: body.limit,
        quality: body.quality !== false,
        sources: body.sources || ["osm", "nominatim", "web"],
      });
      sendJson(res, 202, publicJob(job));
      return;
    }

    if (method === "GET" || method === "HEAD") {
      serveStatic(pathname, res);
      return;
    }

    sendJson(res, 404, { error: "Rota nao encontrada" });
  } catch (err) {
    log.error("api_error", { path: pathname, error: err.message });
    sendJson(res, 400, { error: err.message || String(err) });
  }
});

server.listen(PORT, HOST, () => {
  log.info("server_listen", { url: `http://${HOST}:${PORT}`, app: RUNTIME.appName });
  console.log(`${RUNTIME.appName} v${RUNTIME.appVersion} → http://${HOST}:${PORT}`);
  console.log("SQLite + fila de jobs ativos. Deixe este terminal aberto.");
});
