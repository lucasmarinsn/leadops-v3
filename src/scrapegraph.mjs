import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { CAPTURE } from "./config.mjs";
import { normalizePhone, pickBestPhone } from "./phone.mjs";

function defaultRoot() {
  return resolve(CAPTURE.scrapegraphRoot);
}

export function scrapegraphAvailable() {
  const root = defaultRoot();
  const py = resolve(root, ".venv", "Scripts", "python.exe");
  const script = resolve(root, "enrich_lead.py");
  return existsSync(py) && existsSync(script);
}

function runPython(args, { timeoutMs = CAPTURE.scrapegraphTimeoutMs } = {}) {
  const root = defaultRoot();
  const py = resolve(root, ".venv", "Scripts", "python.exe");
  return new Promise((resolvePromise, reject) => {
    const child = spawn(py, args, {
      cwd: root,
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: resolve(root, "ms-playwright"),
        SCRAPEGRAPHAI_TELEMETRY_ENABLED: "false",
        PYTHONIOENCODING: "utf-8",
      },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("ScrapeGraph timeout"));
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error((stderr || stdout || `exit ${code}`).slice(0, 400)));
        return;
      }
      const lines = stdout
        .trim()
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const jsonLine = [...lines].reverse().find((l) => l.startsWith("{"));
      if (!jsonLine) {
        reject(new Error("ScrapeGraph sem JSON"));
        return;
      }
      try {
        resolvePromise(JSON.parse(jsonLine));
      } catch {
        reject(new Error("JSON invalido do ScrapeGraph"));
      }
    });
  });
}

export async function scrapegraphEnrich(website) {
  if (!website) return null;
  if (!scrapegraphAvailable()) {
    throw new Error("ScrapeGraph nao instalado em tools/scrapegraphai");
  }
  const data = await runPython(["enrich_lead.py", website]);
  if (data?.error) throw new Error(String(data.error));
  return data;
}

export function applyScrapegraphToLead(lead, data) {
  if (!data || typeof data !== "object") return lead;
  const phones = [data.phone, data.whatsapp, lead.phone].filter(Boolean);
  const phone = pickBestPhone(phones.map((p) => normalizePhone(p) || p)) || lead.phone || "";
  const junk = Boolean(data.junk);
  const people = Array.isArray(data.people) ? data.people : [];
  return {
    ...lead,
    phone: phone || lead.phone || "",
    phoneSource: phone && phone !== lead.phone ? "scrapegraph" : lead.phoneSource || "",
    email: data.email || lead.email || "",
    address: data.address || lead.address || "",
    whatsapp: data.whatsapp || lead.whatsapp || "",
    aiSummary: data.summary || lead.aiSummary || "",
    aiHook: data.hook || lead.aiHook || "",
    aiFit: data.fit || lead.aiFit || "",
    aiFitWhy: data.fitWhy || lead.aiFitWhy || "",
    aiJunk: junk,
    aiJunkReason: data.junkReason || lead.aiJunkReason || "",
    aiPeople: people.length ? people : lead.aiPeople || [],
    aiSignals: data.signals || lead.aiSignals || {},
    aiSourcePage: data.sourcePage || lead.aiSourcePage || "",
    aiPagesTried: data.pagesTried || lead.aiPagesTried || [],
  };
}
