import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { RUNTIME } from "../config.mjs";
import { log } from "../core/logger.mjs";
import { qualifyAll, qualifyLead } from "../qualify-lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
export const dataDir = RUNTIME.dataDir || resolve(root, "data");
export const outDir = resolve(root, "output");

mkdirSync(dataDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

const dbPath = join(dataDir, "leadops.sqlite");
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  niche TEXT NOT NULL,
  city TEXT NOT NULL,
  label TEXT NOT NULL,
  quality INTEGER NOT NULL DEFAULT 1,
  sources_json TEXT NOT NULL,
  meta_json TEXT NOT NULL,
  file_export TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  website TEXT,
  email TEXT,
  grade TEXT,
  score INTEGER,
  status TEXT,
  source TEXT,
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  percent INTEGER NOT NULL DEFAULT 0,
  step TEXT,
  message TEXT,
  detail TEXT,
  error TEXT,
  input_json TEXT NOT NULL,
  result_json TEXT,
  campaign_id TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_leads_campaign ON leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_leads_grade ON leads(campaign_id, grade);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_updated ON campaigns(updated_at);
`);

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function createCampaign({ niche, city, quality, sources, meta = {}, fileExport = "" }) {
  const id = `camp_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const ts = nowIso();
  const label = `${niche} · ${city}`;
  db.prepare(
    `INSERT INTO campaigns (id, niche, city, label, quality, sources_json, meta_json, file_export, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    niche,
    city,
    label,
    quality ? 1 : 0,
    JSON.stringify(sources || []),
    JSON.stringify(meta),
    fileExport || "",
    ts,
    ts
  );
  return getCampaign(id);
}

export function updateCampaignMeta(id, patch = {}, fileExport) {
  const camp = getCampaign(id);
  if (!camp) throw new Error("Campanha nao encontrada");
  const meta = { ...camp.meta, ...patch };
  const ts = nowIso();
  db.prepare(
    `UPDATE campaigns SET meta_json = ?, file_export = COALESCE(?, file_export), updated_at = ? WHERE id = ?`
  ).run(JSON.stringify(meta), fileExport ?? null, ts, id);
  return getCampaign(id);
}

export function getCampaign(id) {
  const row = db.prepare(`SELECT * FROM campaigns WHERE id = ?`).get(id);
  if (!row) return null;
  return {
    id: row.id,
    niche: row.niche,
    city: row.city,
    label: row.label,
    quality: Boolean(row.quality),
    sources: parseJson(row.sources_json, []),
    meta: parseJson(row.meta_json, {}),
    file: row.file_export || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listCampaigns() {
  const rows = db.prepare(`SELECT * FROM campaigns ORDER BY updated_at DESC`).all();
  return rows.map((row) => {
    const stats = db
      .prepare(
        `SELECT
           COUNT(*) AS count,
           SUM(CASE WHEN phone IS NOT NULL AND phone != '' THEN 1 ELSE 0 END) AS withPhone,
           SUM(CASE WHEN grade = 'A' THEN 1 ELSE 0 END) AS gradeA,
           SUM(CASE WHEN grade = 'B' THEN 1 ELSE 0 END) AS gradeB,
           SUM(CASE WHEN grade = 'C' THEN 1 ELSE 0 END) AS gradeC,
           SUM(CASE WHEN status = 'todo' OR status IS NULL OR status = '' THEN 1 ELSE 0 END) AS todo,
           SUM(CASE WHEN status = 'interested' THEN 1 ELSE 0 END) AS interested
         FROM leads WHERE campaign_id = ?`
      )
      .get(row.id);
    return {
      id: row.id,
      file: row.file_export || row.id,
      niche: row.niche,
      city: row.city,
      label: row.label,
      count: Number(stats.count || 0),
      withPhone: Number(stats.withPhone || 0),
      grades: {
        A: Number(stats.gradeA || 0),
        B: Number(stats.gradeB || 0),
        C: Number(stats.gradeC || 0),
      },
      statuses: {
        todo: Number(stats.todo || 0),
        interested: Number(stats.interested || 0),
      },
      mtime: Date.parse(row.updated_at) || 0,
      mtimeLabel: new Date(row.updated_at).toLocaleString("pt-BR"),
      updatedAt: row.updated_at,
      createdAt: row.created_at,
    };
  });
}

export function replaceCampaignLeads(campaignId, leads) {
  const ts = nowIso();
  const del = db.prepare(`DELETE FROM leads WHERE campaign_id = ?`);
  const ins = db.prepare(
    `INSERT INTO leads (id, campaign_id, name, phone, website, email, grade, score, status, source, data_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  db.exec("BEGIN");
  try {
    del.run(campaignId);
    for (const lead of leads) {
      ins.run(
        lead.id,
        campaignId,
        lead.name || "",
        lead.phone || "",
        lead.website || "",
        lead.email || "",
        lead.grade || "",
        Number(lead.score || 0),
        lead.status || "todo",
        lead.source || "",
        JSON.stringify(lead),
        ts
      );
    }
    db.prepare(`UPDATE campaigns SET updated_at = ? WHERE id = ?`).run(ts, campaignId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function getCampaignBundle(campaignId) {
  const campaign = getCampaign(campaignId);
  if (!campaign) return null;
  const rows = db.prepare(`SELECT data_json FROM leads WHERE campaign_id = ?`).all(campaignId);
  let leads = rows.map((r) => parseJson(r.data_json, null)).filter(Boolean);
  leads = qualifyAll(leads);
  return {
    meta: {
      ...campaign.meta,
      niche: campaign.niche,
      city: campaign.city,
      campaignId: campaign.id,
      quality: campaign.quality,
      sources: campaign.sources,
      file: campaign.file,
      updatedAt: campaign.updatedAt,
    },
    leads,
    campaign,
  };
}

export function resolveCampaignId(fileOrId) {
  if (!fileOrId) return null;
  if (getCampaign(fileOrId)) return fileOrId;
  const byFile = db.prepare(`SELECT id FROM campaigns WHERE file_export = ? LIMIT 1`).get(fileOrId);
  return byFile?.id || null;
}

export function upsertLead(campaignId, lead) {
  const ts = nowIso();
  const q = qualifyLead(lead);
  db.prepare(
    `INSERT INTO leads (id, campaign_id, name, phone, website, email, grade, score, status, source, data_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(campaign_id, id) DO UPDATE SET
       name=excluded.name,
       phone=excluded.phone,
       website=excluded.website,
       email=excluded.email,
       grade=excluded.grade,
       score=excluded.score,
       status=excluded.status,
       source=excluded.source,
       data_json=excluded.data_json,
       updated_at=excluded.updated_at`
  ).run(
    q.id,
    campaignId,
    q.name || "",
    q.phone || "",
    q.website || "",
    q.email || "",
    q.grade || "",
    Number(q.score || 0),
    q.status || "todo",
    q.source || "",
    JSON.stringify(q),
    ts
  );
  db.prepare(`UPDATE campaigns SET updated_at = ? WHERE id = ?`).run(ts, campaignId);
  return q;
}

export function patchLead(campaignId, leadId, patch) {
  const row = db
    .prepare(`SELECT data_json FROM leads WHERE campaign_id = ? AND id = ?`)
    .get(campaignId, leadId);
  if (!row) throw new Error("Lead nao encontrado");
  const current = parseJson(row.data_json, {});
  let next = { ...current, ...patch };
  if (patch.phone !== undefined || patch.grade !== undefined) {
    const kept = {
      status: patch.status ?? next.status,
      notes: patch.notes ?? next.notes,
      calledAt: patch.calledAt ?? next.calledAt,
    };
    next = { ...qualifyLead(next), ...kept };
  }
  if (patch.status && patch.status !== "todo") {
    next.calledAt = next.calledAt || nowIso();
  }
  if (patch.status === "todo") next.calledAt = "";
  return upsertLead(campaignId, next);
}

export function createJob({ type, input, campaignId = null }) {
  const id = randomUUID();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO jobs (id, type, status, percent, step, message, detail, error, input_json, result_json, campaign_id, created_at)
     VALUES (?, ?, 'queued', 0, 'queued', 'Na fila', '', NULL, ?, NULL, ?, ?)`
  ).run(id, type, JSON.stringify(input || {}), campaignId, ts);
  return getJob(id);
}

export function getJob(id) {
  const row = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id);
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    percent: row.percent,
    step: row.step,
    message: row.message,
    detail: row.detail || "",
    error: row.error || null,
    input: parseJson(row.input_json, {}),
    result: parseJson(row.result_json, null),
    campaignId: row.campaign_id,
    file: row.campaign_id || null,
    summary: parseJson(row.result_json, null)?.summary || null,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function updateJob(id, patch) {
  const job = getJob(id);
  if (!job) return null;
  const next = {
    status: patch.status ?? job.status,
    percent: patch.percent ?? job.percent,
    step: patch.step ?? job.step,
    message: patch.message ?? job.message,
    detail: patch.detail ?? job.detail,
    error: patch.error === undefined ? job.error : patch.error,
    result: patch.result === undefined ? job.result : patch.result,
    campaignId: patch.campaignId ?? job.campaignId,
    startedAt: patch.startedAt ?? job.startedAt,
    finishedAt: patch.finishedAt ?? job.finishedAt,
  };
  db.prepare(
    `UPDATE jobs SET status=?, percent=?, step=?, message=?, detail=?, error=?, result_json=?, campaign_id=?, started_at=?, finished_at=?
     WHERE id=?`
  ).run(
    next.status,
    next.percent,
    next.step,
    next.message,
    next.detail || "",
    next.error,
    next.result ? JSON.stringify(next.result) : null,
    next.campaignId,
    next.startedAt,
    next.finishedAt,
    id
  );
  return getJob(id);
}

export function claimNextJob(types) {
  const placeholders = types.map(() => "?").join(",");
  const row = db
    .prepare(
      `SELECT id FROM jobs WHERE status = 'queued' AND type IN (${placeholders})
       ORDER BY created_at ASC LIMIT 1`
    )
    .get(...types);
  if (!row) return null;
  const ts = nowIso();
  const info = db
    .prepare(
      `UPDATE jobs SET status='running', started_at=?, message='Iniciando…', step='start', percent=1 WHERE id=? AND status='queued'`
    )
    .run(ts, row.id);
  if (!info.changes) return null;
  return getJob(row.id);
}

export function countJobsByStatus(type, status) {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM jobs WHERE type = ? AND status = ?`)
    .get(type, status);
  return Number(row?.n || 0);
}

export function listRecentJobs(limit = 20) {
  return db
    .prepare(`SELECT id FROM jobs ORDER BY created_at DESC LIMIT ?`)
    .all(limit)
    .map((r) => getJob(r.id));
}

export function metrics() {
  const campaigns = db.prepare(`SELECT COUNT(*) AS n FROM campaigns`).get().n;
  const leads = db.prepare(`SELECT COUNT(*) AS n FROM leads`).get().n;
  const withPhone = db
    .prepare(`SELECT COUNT(*) AS n FROM leads WHERE phone IS NOT NULL AND phone != ''`)
    .get().n;
  const queued = db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE status='queued'`).get().n;
  const running = db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE status='running'`).get().n;
  return {
    campaigns: Number(campaigns),
    leads: Number(leads),
    withPhone: Number(withPhone),
    jobsQueued: Number(queued),
    jobsRunning: Number(running),
    dbPath,
  };
}

export function importLegacyJsonFiles() {
  if (!existsSync(outDir)) return { imported: 0 };
  let imported = 0;
  for (const file of readdirSync(outDir)) {
    if (!file.startsWith("leads-") || !file.endsWith(".json")) continue;
    const exists = db.prepare(`SELECT id FROM campaigns WHERE file_export = ?`).get(file);
    if (exists) continue;
    try {
      const raw = JSON.parse(readFileSync(join(outDir, file), "utf8"));
      const meta = raw.meta || {};
      const leads = Array.isArray(raw.leads) ? raw.leads : [];
      if (!leads.length) continue;
      const camp = createCampaign({
        niche: meta.niche || "legado",
        city: meta.city || "",
        quality: meta.quality !== false,
        sources: meta.sources || ["legacy"],
        meta: { ...meta, importedFrom: file },
        fileExport: file,
      });
      replaceCampaignLeads(camp.id, qualifyAll(leads));
      imported += 1;
    } catch (err) {
      log.warn("legacy_import_failed", { file, error: err.message });
    }
  }
  if (imported) log.info("legacy_imported", { imported });
  return { imported };
}

export function importSeedQualified() {
  const seedPath = resolve(root, "seed", "qualified.json");
  if (!existsSync(seedPath)) return { imported: false };
  const existing = db
    .prepare(`SELECT id FROM campaigns WHERE niche = 'unificado' AND city = 'Porto Alegre' LIMIT 1`)
    .get();
  if (existing && process.env.LEADS_FORCE_SEED !== "1") {
    return { imported: false, campaignId: existing.id };
  }
  try {
    const raw = JSON.parse(readFileSync(seedPath, "utf8"));
    const leads = Array.isArray(raw.leads) ? raw.leads : [];
    if (!leads.length) return { imported: false };
    let campId = existing?.id;
    if (!campId) {
      const camp = createCampaign({
        niche: "unificado",
        city: "Porto Alegre",
        quality: true,
        sources: ["leadops", "garimpo"],
        meta: { ...(raw.meta || {}), seed: true },
        fileExport: "seed-qualified.json",
      });
      campId = camp.id;
    }
    replaceCampaignLeads(campId, qualifyAll(leads));
    updateCampaignMeta(campId, { ...(raw.meta || {}), seed: true, seededAt: nowIso() }, "seed-qualified.json");
    log.info("seed_imported", { campaignId: campId, leads: leads.length });
    return { imported: true, campaignId: campId, leads: leads.length };
  } catch (err) {
    log.warn("seed_import_failed", { error: err.message });
    return { imported: false };
  }
}

log.info("db_ready", { dbPath });
