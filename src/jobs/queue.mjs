import { RUNTIME } from "../config.mjs";
import { log } from "../core/logger.mjs";
import {
  claimNextJob,
  countJobsByStatus,
  createCampaign,
  createJob,
  getJob,
  replaceCampaignLeads,
  updateCampaignMeta,
  updateJob,
  getCampaignBundle,
  resolveCampaignId,
  upsertLead,
} from "../db/store.mjs";
import { runCapture } from "../pipeline.mjs";
import { enrichLeadSmart, enrichPhoneFromWebsite } from "../enrich.mjs";
import { qualifyAll, qualifyLead } from "../qualify-lib.mjs";
import { scrapegraphAvailable } from "../scrapegraph.mjs";
import { CAPTURE } from "../config.mjs";

const running = new Set();

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    percent: job.percent,
    step: job.step,
    message: job.message,
    detail: job.detail || "",
    error: job.error || null,
    summary: job.result?.summary || job.summary || null,
    file: job.campaignId || job.result?.campaignId || null,
    campaignId: job.campaignId || job.result?.campaignId || null,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    createdAt: job.createdAt,
  };
}

async function runCaptureJob(job) {
  const input = job.input || {};
  try {
    const result = await runCapture(input, {
      onProgress: (p) => {
        updateJob(job.id, {
          percent: p.percent ?? 0,
          step: p.step || "run",
          message: p.message || "",
          detail: p.detail || "",
        });
      },
    });

    const campaign = createCampaign({
      niche: result.meta.niche,
      city: result.meta.city,
      quality: result.meta.quality !== false,
      sources: result.meta.sources || [],
      meta: result.meta,
      fileExport: result.summary.file,
    });
    replaceCampaignLeads(campaign.id, result.leads);
    updateCampaignMeta(campaign.id, result.meta, result.summary.file);

    const summary = {
      ...result.summary,
      campaignId: campaign.id,
      file: campaign.id,
    };

    updateJob(job.id, {
      status: "done",
      percent: 100,
      step: "done",
      message: "Captura concluida",
      campaignId: campaign.id,
      result: { summary, meta: result.meta },
      finishedAt: new Date().toISOString(),
    });
    log.info("capture_done", { jobId: job.id, campaignId: campaign.id, total: summary.total });
  } catch (err) {
    updateJob(job.id, {
      status: "error",
      message: "Falha na captura",
      error: err.message || String(err),
      finishedAt: new Date().toISOString(),
    });
    log.error("capture_failed", { jobId: job.id, error: err.message });
  }
}

async function runEnrichJob(job) {
  const input = job.input || {};
  const campaignId = resolveCampaignId(input.file || input.campaignId);
  if (!campaignId) {
    updateJob(job.id, {
      status: "error",
      error: "Campanha nao encontrada",
      message: "Falha no enriquecimento",
      finishedAt: new Date().toISOString(),
    });
    return;
  }

  const smart = input.mode === "smart" || input.mode === "ai";
  if (smart && !scrapegraphAvailable()) {
    updateJob(job.id, {
      status: "error",
      error: "ScrapeGraph nao disponivel",
      message: "Falha no enriquecimento",
      finishedAt: new Date().toISOString(),
    });
    return;
  }

  const bundle = getCampaignBundle(campaignId);
  let targets = (bundle.leads || []).filter((l) => l.website);
  if (!input.force) {
    targets = smart
      ? targets.filter((l) => !l.phone || !l.aiSummary)
      : targets.filter((l) => !l.phone);
  }
  if (input.id) targets = targets.filter((l) => l.id === input.id);
  const max = smart
    ? Math.min(CAPTURE.scrapegraphMaxLimit, Math.max(1, input.limit || CAPTURE.scrapegraphDefaultLimit))
    : Math.min(40, Math.max(1, input.limit || 20));
  targets = targets.slice(0, max);

  let updated = 0;
  let phonesFound = 0;
  let junkMarked = 0;
  const errors = [];

  for (let i = 0; i < targets.length; i += 1) {
    const lead = targets[i];
    updateJob(job.id, {
      percent: Math.round(((i + 1) / Math.max(targets.length, 1)) * 100),
      step: "enrich",
      message: `Enriquecendo ${i + 1}/${targets.length}…`,
      detail: lead.name,
      campaignId,
    });
    try {
      const enriched = smart ? await enrichLeadSmart(lead) : await enrichPhoneFromWebsite(lead);
      const next = qualifyLead({
        ...enriched,
        status: lead.status,
        notes: lead.notes,
        calledAt: lead.calledAt,
      });
      upsertLead(campaignId, next);
      updated += 1;
      if (next.phone && !lead.phone) phonesFound += 1;
      if (next.aiJunk) junkMarked += 1;
    } catch (err) {
      errors.push({ id: lead.id, name: lead.name, error: err.message || String(err) });
    }
  }

  const fresh = getCampaignBundle(campaignId);
  const leads = qualifyAll(fresh.leads || []);
  replaceCampaignLeads(campaignId, leads);

  updateJob(job.id, {
    status: "done",
    percent: 100,
    step: "done",
    message: "Enriquecimento concluido",
    campaignId,
    result: {
      summary: {
        mode: smart ? "smart" : "free",
        checked: targets.length,
        updated,
        phonesFound,
        junkMarked,
        errors,
        campaignId,
        file: campaignId,
      },
    },
    finishedAt: new Date().toISOString(),
  });
}

async function tick() {
  const captureRunning = countJobsByStatus("capture", "running");
  const enrichRunning = countJobsByStatus("enrich", "running");

  if (captureRunning < RUNTIME.maxConcurrentCaptures) {
    const job = claimNextJob(["capture"]);
    if (job && !running.has(job.id)) {
      running.add(job.id);
      void runCaptureJob(job).finally(() => running.delete(job.id));
    }
  }

  if (enrichRunning < RUNTIME.maxConcurrentEnrich) {
    const job = claimNextJob(["enrich"]);
    if (job && !running.has(job.id)) {
      running.add(job.id);
      void runEnrichJob(job).finally(() => running.delete(job.id));
    }
  }
}

let timer = null;

export function startWorkers() {
  if (timer) return;
  timer = setInterval(() => {
    void tick();
  }, RUNTIME.jobPollMs);
  log.info("workers_started", {
    capture: RUNTIME.maxConcurrentCaptures,
    enrich: RUNTIME.maxConcurrentEnrich,
  });
}

export function enqueueCapture(input) {
  return createJob({ type: "capture", input });
}

export function enqueueEnrich(input) {
  const campaignId = resolveCampaignId(input.file || input.campaignId);
  return createJob({ type: "enrich", input, campaignId });
}

export { publicJob, getJob };
