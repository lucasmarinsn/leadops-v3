const STORAGE_KEY = "leads-free-pro-v1";

const state = {
  view: "capture",
  jobId: null,
  pollTimer: null,
  file: null,
  leads: [],
  meta: null,
  selectedId: null,
  grade: "focus",
  query: "",
  catalog: [],
  statuses: [],
  niche: "imobiliaria",
  scrapegraph: { available: false, defaultLimit: 8, maxLimit: 15 },
  company: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const STATUS_LABEL = {
  todo: "Na fila",
  calling: "Ligando",
  no_answer: "Não atendeu",
  answered: "Atendeu",
  interested: "Interessado",
  rejected: "Recusou",
  skip: "Pular",
};

const STATUS_HOTKEYS = ["todo", "calling", "no_answer", "answered", "interested", "rejected", "skip"];

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveSession(patch) {
  const next = { ...loadSession(), ...patch, updatedAt: Date.now() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 2400);
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function api(path, options) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
    ...options,
  });
  const type = res.headers.get("content-type") || "";
  if (type.includes("text/csv")) {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function setView(name) {
  state.view = name;
  $$(".view").forEach((el) => el.classList.toggle("active", el.id === `view-${name}`));
  $$(".nav-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === name));

  const titles = {
    capture: ["Nova captura", "Escolha o mercado"],
    progress: ["Progresso", "Captura em andamento"],
    queue: ["Fila de ligações", state.meta ? `${state.meta.niche} · ${state.meta.city}` : "Qualificação"],
    history: ["Histórico", "Lotes salvos"],
  };
  const [title, eye] = titles[name] || ["Leads Free", ""];
  $("#top-title").textContent = title;
  $("#top-eyebrow").textContent = eye;
  renderTopActions();
  saveSession({ view: name, file: state.file, selectedId: state.selectedId, grade: state.grade });

  if (name === "history") loadHistory();
  if (name === "queue") {
    renderQueue();
    renderDetail();
  }
  if (name === "capture") renderRecent();
}

function renderTopActions() {
  const el = $("#top-actions");
  if (state.view !== "queue" || !state.file) {
    el.innerHTML = "";
    return;
  }
  const ai = state.scrapegraph?.available;
  el.innerHTML = `
    <button type="button" class="btn ghost" id="btn-enrich">Tel. gratis</button>
    ${ai ? `<button type="button" class="btn ghost" id="btn-enrich-ai">IA enriquecer</button>` : ""}
    <button type="button" class="btn ghost" id="btn-skip-nophone">Pular sem tel.</button>
    <button type="button" class="btn ghost" id="btn-export">Exportar CSV</button>
    <button type="button" class="btn ghost" id="btn-export-phone">CSV com telefone</button>
    <button type="button" class="btn primary" id="btn-new-capture">Nova captura</button>
  `;
  $("#btn-enrich").onclick = () => enrichBatch("free");
  $("#btn-enrich-ai")?.addEventListener("click", () => enrichBatch("smart"));
  $("#btn-skip-nophone").onclick = () => skipNoPhone();
  $("#btn-export").onclick = () => exportCsv(false);
  $("#btn-export-phone").onclick = () => exportCsv(true);
  $("#btn-new-capture").onclick = () => setView("capture");
}

function mapsUrl(lead) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lead.name} ${lead.city || ""}`)}`;
}

function telHref(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  return d ? `tel:+55${d}` : "#";
}

function waHref(lead) {
  const d = String(lead.phone || "").replace(/\D/g, "");
  if (d.length < 10) return "#";
  const full = d.startsWith("55") ? d : `55${d}`;
  const text = encodeURIComponent(lead.follow || `Oi! Vi a ${lead.name}. Podemos falar 2 min?`);
  return `https://wa.me/${full}?text=${text}`;
}

function filteredLeads() {
  const q = state.query.trim().toLowerCase();
  return state.leads.filter((l) => {
    if (state.grade === "A" || state.grade === "B" || state.grade === "C") {
      if (l.grade !== state.grade) return false;
    }
    if (state.grade === "phone" && !l.phone) return false;
    if (state.grade === "todo" && (l.status || "todo") !== "todo") return false;
    if (state.grade === "interested" && l.status !== "interested") return false;
    if (state.grade === "focus") {
      if (l.grade !== "A" || !l.phone || (l.status || "todo") !== "todo") return false;
    }
    if (
      q &&
      !`${l.name} ${l.address || ""} ${l.phone || ""}`.toLowerCase().includes(q)
    ) {
      return false;
    }
    return true;
  });
}

function selectedLead() {
  return state.leads.find((l) => l.id === state.selectedId) || null;
}

function nextCallable(fromId) {
  const list = state.leads.filter(
    (l) => l.phone && (l.status || "todo") === "todo" && (l.grade === "A" || l.grade === "B")
  );
  if (!list.length) return null;
  const idx = list.findIndex((l) => l.id === fromId);
  if (idx < 0) return list[0];
  return list[idx + 1] || list[0];
}

function renderKpis() {
  const leads = state.leads;
  const grades = { A: 0, B: 0, C: 0 };
  let withPhone = 0;
  let interested = 0;
  let todo = 0;
  let done = 0;
  for (const l of leads) {
    grades[l.grade] = (grades[l.grade] || 0) + 1;
    if (l.phone) withPhone += 1;
    if (l.status === "interested") interested += 1;
    if ((l.status || "todo") === "todo") todo += 1;
    else done += 1;
  }
  $("#kpi-row").innerHTML = `
    <div class="kpi"><b>${leads.length}</b><span>Leads</span></div>
    <div class="kpi"><b>${withPhone}</b><span>Telefone</span></div>
    <div class="kpi"><b>${grades.A}</b><span>Nota A</span></div>
    <div class="kpi"><b>${todo}</b><span>Na fila</span></div>
    <div class="kpi"><b>${done}</b><span>Tratados</span></div>
    <div class="kpi"><b>${interested}</b><span>Interessados</span></div>
  `;

  const pct = leads.length ? Math.round((done / leads.length) * 100) : 0;
  $("#queue-progress").innerHTML = `
    <div class="bar"><i style="width:${pct}%"></i></div>
    <p>${done} de ${leads.length} tratados · ${pct}% da fila</p>
  `;
}

function renderQueue() {
  renderKpis();
  const list = filteredLeads();
  const el = $("#lead-list");
  $("#queue-empty").classList.toggle("hidden", list.length > 0);

  if (!state.leads.length) {
    el.innerHTML = "";
    $("#queue-empty").classList.remove("hidden");
    $("#queue-empty").textContent =
      "Nenhum lead neste lote. Capture de novo com um nicho da grade.";
    return;
  }

  if (!list.length) {
    el.innerHTML = "";
    $("#queue-empty").classList.remove("hidden");
    $("#queue-empty").textContent =
      state.grade === "focus"
        ? "Fila “Ligar agora” vazia. Todos os A com telefone já foram tratados — ou use filtro Todos."
        : "Nenhum lead neste filtro.";
    return;
  }

  if (!list.some((l) => l.id === state.selectedId)) {
    state.selectedId = list[0].id;
  }

  el.innerHTML = list
    .map((l) => {
      const active = l.id === state.selectedId ? "active" : "";
      return `<button type="button" class="lead-row ${active}" data-id="${esc(l.id)}">
        <div class="lead-row-top">
          <h3>${esc(l.name)}</h3>
          <div class="badges">
            <span class="badge ${esc(l.grade)}">${esc(l.grade)}</span>
            <span class="badge status">${esc(STATUS_LABEL[l.status || "todo"] || l.status)}</span>
          </div>
        </div>
        <p>${esc(l.phone || "Sem telefone")} · score ${esc(l.score ?? "—")}${l.source ? ` · ${esc(l.source)}` : ""}</p>
        <p>${esc(l.nextAction || l.why || "")}</p>
      </button>`;
    })
    .join("");

  el.querySelectorAll(".lead-row").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedId = btn.dataset.id;
      saveSession({ selectedId: state.selectedId });
      renderQueue();
      renderDetail();
    });
  });
}

function renderDetail() {
  const lead = selectedLead();
  const empty = $("#detail-empty");
  const body = $("#detail-body");
  if (!lead) {
    empty.classList.remove("hidden");
    body.classList.add("hidden");
    return;
  }
  empty.classList.add("hidden");
  body.classList.remove("hidden");

  const statusButtons = (
    state.statuses.length
      ? state.statuses
      : Object.keys(STATUS_LABEL).map((id) => ({ id, label: STATUS_LABEL[id] }))
  )
    .map(
      (s) =>
        `<button type="button" class="btn sm status-btn ${(lead.status || "todo") === s.id ? "active" : ""}" data-status="${esc(s.id)}">${esc(s.label)}</button>`
    )
    .join("");

  const people = Array.isArray(lead.aiPeople) ? lead.aiPeople : [];
  const peopleHtml = people.length
    ? `<p><strong>Pessoas:</strong> ${esc(people.map((p) => `${p.name}${p.role ? ` (${p.role})` : ""}`).join(", "))}</p>`
    : "";

  body.innerHTML = `
    <div class="badges">
      <span class="badge ${esc(lead.grade)}">Nota ${esc(lead.grade)}</span>
      <span class="badge status">Score ${esc(lead.score ?? "—")}</span>
      ${lead.aiFit ? `<span class="badge status">Fit IA ${esc(lead.aiFit)}</span>` : ""}
      ${lead.aiJunk ? `<span class="badge C">Lixo IA</span>` : ""}
    </div>
    <h2>${esc(lead.name)}</h2>
    <div class="phone-edit">
      <input id="phone-input" type="text" value="${esc(lead.phone || "")}" placeholder="(51) 99999-9999" />
      <button type="button" class="btn sm" id="btn-save-phone">Salvar tel.</button>
    </div>
    <div class="detail-grid">
      <p><strong>Fonte:</strong> ${esc(lead.source || "—")}</p>
      <p><strong>Fonte tel.:</strong> ${esc(lead.phoneSource || "—")}</p>
      <p><strong>E-mail:</strong> ${esc(lead.email || "—")}</p>
      <p><strong>WhatsApp:</strong> ${esc(lead.whatsapp || "—")}</p>
      <p><strong>Endereço:</strong> ${esc(lead.address || "—")}</p>
      <p><strong>Por que:</strong> ${esc(lead.why || "—")}</p>
      <p><strong>Próximo passo:</strong> ${esc(lead.nextAction || "—")}</p>
      ${lead.aiSummary ? `<p><strong>Resumo IA:</strong> ${esc(lead.aiSummary)}</p>` : ""}
      ${lead.aiHook ? `<p><strong>Gancho:</strong> ${esc(lead.aiHook)}</p>` : ""}
      ${lead.aiFitWhy ? `<p><strong>Fit IA:</strong> ${esc(lead.aiFitWhy)}</p>` : ""}
      ${lead.aiJunkReason ? `<p><strong>Lixo:</strong> ${esc(lead.aiJunkReason)}</p>` : ""}
      ${peopleHtml}
    </div>
    <div class="action-row">
      ${lead.phone ? `<a class="btn primary" id="btn-call" href="${telHref(lead.phone)}">Ligar</a>` : ""}
      ${lead.phone ? `<a class="btn" href="${waHref(lead)}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
      <a class="btn" href="${mapsUrl(lead)}" target="_blank" rel="noopener">Maps</a>
      ${lead.website ? `<a class="btn" href="${esc(lead.website)}" target="_blank" rel="noopener">Site</a>` : ""}
      ${lead.website && !lead.phone ? `<button type="button" class="btn" id="btn-enrich-one">Tel. gratis</button>` : ""}
      ${lead.website && state.scrapegraph?.available ? `<button type="button" class="btn" id="btn-enrich-one-ai">IA neste lead</button>` : ""}
      <button type="button" class="btn" id="btn-copy-script">Copiar script</button>
      <button type="button" class="btn" id="btn-copy-follow">Copiar follow</button>
      <button type="button" class="btn" id="btn-next">Próximo na fila</button>
    </div>
    <div>
      <label><span>Status da ligação</span></label>
      <div class="status-row">${statusButtons}</div>
    </div>
    <div>
      <label><span>Script (sistemas sob medida)</span></label>
      <div class="script-box" id="script-box">${esc(lead.callScript || "")}</div>
    </div>
    <div>
      <label><span>Notas</span></label>
      <textarea id="notes-box" rows="4" placeholder="Anotações da ligação…">${esc(lead.notes || "")}</textarea>
      <div class="action-row" style="margin-top:8px">
        <button type="button" class="btn primary sm" id="btn-save-notes">Salvar notas</button>
      </div>
    </div>
  `;

  body.querySelectorAll("[data-status]").forEach((btn) => {
    btn.addEventListener("click", () => setStatus(lead.id, btn.dataset.status));
  });
  $("#btn-copy-script")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(lead.callScript || "");
    toast("Script copiado");
  });
  $("#btn-copy-follow")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(lead.follow || "");
    toast("Follow copiado");
  });
  $("#btn-save-notes")?.addEventListener("click", () => {
    patchLead(lead.id, { notes: $("#notes-box").value });
  });
  $("#btn-save-phone")?.addEventListener("click", () => {
    patchLead(lead.id, { phone: $("#phone-input").value });
  });
  $("#btn-enrich-one")?.addEventListener("click", () => enrichOne(lead.id, "free"));
  $("#btn-enrich-one-ai")?.addEventListener("click", () => enrichOne(lead.id, "smart"));
  $("#btn-next")?.addEventListener("click", () => selectNext());
  $("#btn-call")?.addEventListener("click", () => {
    if ((lead.status || "todo") === "todo") setStatus(lead.id, "calling", { stay: true });
  });
}

async function patchLead(id, patch, { advance = false } = {}) {
  if (!state.file) return;
  const { lead } = await api("/api/leads", {
    method: "PATCH",
    body: JSON.stringify({ file: state.file, id, patch }),
  });
  const idx = state.leads.findIndex((l) => l.id === id);
  if (idx >= 0) state.leads[idx] = { ...state.leads[idx], ...lead };
  toast("Atualizado");
  if (advance) selectNext(id);
  else {
    renderQueue();
    renderDetail();
  }
}

async function setStatus(id, status, { stay = false } = {}) {
  await patchLead(id, { status }, { advance: !stay && status !== "todo" && status !== "calling" });
  if (stay) {
    renderQueue();
    renderDetail();
  }
}

function selectNext(fromId = state.selectedId) {
  const next = nextCallable(fromId);
  if (!next) {
    toast("Não há próximo lead com telefone na fila");
    renderQueue();
    renderDetail();
    return;
  }
  state.selectedId = next.id;
  saveSession({ selectedId: state.selectedId });
  renderQueue();
  renderDetail();
  const row = document.querySelector(`.lead-row[data-id="${CSS.escape(next.id)}"]`);
  row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

async function openBatch(file) {
  const data = await api(`/api/leads?file=${encodeURIComponent(file)}`);
  state.file = data.campaign?.id || data.meta?.campaignId || file;
  state.leads = data.leads || [];
  state.meta = data.meta || {};
  const session = loadSession();
  state.selectedId =
    (session.file === state.file && session.selectedId && state.leads.some((l) => l.id === session.selectedId)
      ? session.selectedId
      : null) ||
    nextCallable(null)?.id ||
    state.leads[0]?.id ||
    null;
  saveSession({ file: state.file, selectedId: state.selectedId });
  setView("queue");
  if (!state.leads.length) toast("Captura vazia neste nicho. Tente outro da grade.");
}

async function loadHistory() {
  const { batches } = await api("/api/batches");
  const el = $("#batch-list");
  if (!batches.length) {
    el.innerHTML = `<p class="empty">Nenhum lote ainda.</p>`;
    return;
  }
  el.innerHTML = batches
    .map(
      (b) => `<button type="button" class="batch" data-file="${esc(b.id || b.file)}">
        <div>
          <strong>${esc(b.label || `${b.niche} · ${b.city}`)}</strong>
          <small>${esc(b.mtimeLabel)} · ${b.count} leads · ${b.withPhone} com telefone · A ${b.grades?.A || 0}</small>
        </div>
        <span>Abrir →</span>
      </button>`
    )
    .join("");
  el.querySelectorAll(".batch").forEach((btn) => {
    btn.addEventListener("click", () => openBatch(btn.dataset.file));
  });
}

async function renderRecent() {
  const card = $("#recent-card");
  const { batches } = await api("/api/batches");
  const b = batches.find((x) => x.count > 0);
  if (!b) {
    card.classList.add("hidden");
    return;
  }
  card.classList.remove("hidden");
  card.innerHTML = `
    <div>
      <strong>Continuar: ${esc(b.label || `${b.niche} · ${b.city}`)}</strong>
      <span>${b.count} leads · ${b.withPhone} com telefone · ${esc(b.mtimeLabel)}</span>
    </div>
    <button type="button" class="btn primary" id="btn-open-recent">Abrir fila</button>
  `;
  $("#btn-open-recent").onclick = () => openBatch(b.id || b.file);
}

async function exportCsv(onlyPhone) {
  if (!state.file) return;
  const grade = ["A", "B", "C"].includes(state.grade) ? state.grade : "all";
  const qs = new URLSearchParams({
    file: state.file,
    grade,
    phone: onlyPhone ? "1" : "0",
  });
  const res = await api(`/api/export?${qs}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = state.file.replace(/\.json$/, "") + (onlyPhone ? "-phone.csv" : ".csv");
  a.click();
  URL.revokeObjectURL(url);
  toast("CSV baixado");
}

async function enrichBatch(mode = "free") {
  if (!state.file) return;
  const smart = mode === "smart";
  const limit = smart ? state.scrapegraph?.defaultLimit || 8 : 25;
  toast(smart ? `IA na fila (até ${limit})…` : "Enriquecimento na fila…");
  const job = await api("/api/leads/enrich", {
    method: "POST",
    body: JSON.stringify({ file: state.file, limit, mode }),
  });
  await waitJob(job.id, {
    onDone: async (done) => {
      if (done.leads) state.leads = done.leads;
      else await openBatch(state.file);
      state.meta = done.meta || state.meta;
      toast(
        smart
          ? `IA: ${done.updated || 0} atualizado(s), ${done.phonesFound || 0} tel.`
          : `${done.updated || 0} telefone(s) em ${done.checked || 0} site(s)`
      );
      renderQueue();
      renderDetail();
    },
  });
}

async function enrichOne(id, mode = "free") {
  if (!state.file) return;
  toast(mode === "smart" ? "IA neste lead…" : "Buscando telefone…");
  const job = await api("/api/leads/enrich", {
    method: "POST",
    body: JSON.stringify({ file: state.file, id, limit: 1, mode, force: true }),
  });
  await waitJob(job.id, {
    onDone: async (done) => {
      if (done.errors?.length) toast(done.errors[0].error);
      else toast(mode === "smart" ? "IA concluída" : done.updated ? "Telefone encontrado" : "Sem telefone");
      if (done.leads) state.leads = done.leads;
      else await openBatch(state.file);
      renderQueue();
      renderDetail();
    },
  });
}

async function waitJob(jobId, { onDone } = {}) {
  for (;;) {
    const job = await api(`/api/jobs/${jobId}`);
    if (job.status === "running" || job.status === "queued") {
      await new Promise((r) => setTimeout(r, 700));
      continue;
    }
    if (job.status === "error") throw new Error(job.error || "Job falhou");
    if (onDone) await onDone(job);
    return job;
  }
}

async function skipNoPhone() {
  if (!state.file) return;
  const result = await api("/api/leads/skip-no-phone", {
    method: "POST",
    body: JSON.stringify({ file: state.file }),
  });
  state.leads = result.leads || state.leads;
  toast(`${result.changed} lead(s) sem telefone marcados como Pular`);
  renderQueue();
  renderDetail();
}

function updateProgress(job) {
  $("#progress-fill").style.width = `${job.percent || 0}%`;
  $("#progress-pct").textContent = `${job.percent || 0}%`;
  $("#progress-msg").textContent = job.message || "";
  $("#progress-detail").textContent = job.detail || "";
  const order = ["geocode", "nominatim", "overpass", "web", "enrich", "qualify", "done"];
  const idx = order.indexOf(job.step);
  $$("#progress-steps li").forEach((li) => {
    const i = order.indexOf(li.dataset.step);
    li.classList.toggle("on", li.dataset.step === job.step);
    li.classList.toggle("done", idx > i || job.status === "done");
  });
  const err = $("#progress-error");
  const go = $("#btn-go-qualify");
  if (job.status === "error") {
    err.textContent = job.error || "Erro";
    err.classList.remove("hidden");
    go.classList.add("hidden");
    return;
  }
  err.classList.add("hidden");
  if (job.status === "done" && (job.file || job.campaignId)) {
    go.classList.remove("hidden");
    go.onclick = () => openBatch(job.campaignId || job.file);
  }
}

function stopPoll() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

async function pollOnce(jobId) {
  const job = await api(`/api/jobs/${jobId}`);
  updateProgress(job);
  if (job.status === "done" || job.status === "error") {
    stopPoll();
    if (job.status === "done" && (job.campaignId || job.file)) {
      toast("Captura pronta");
      await openBatch(job.campaignId || job.file);
    }
    return true;
  }
  return false;
}

function startPoll(jobId) {
  stopPoll();
  state.jobId = jobId;
  $("#nav-progress").disabled = false;
  setView("progress");
  void pollOnce(jobId);
  state.pollTimer = setInterval(async () => {
    try {
      await pollOnce(jobId);
    } catch (err) {
      stopPoll();
      $("#progress-error").textContent = err.message;
      $("#progress-error").classList.remove("hidden");
    }
  }, 800);
}

function renderNicheGrid() {
  const grid = $("#niche-grid");
  const items = state.catalog.length
    ? state.catalog
    : [{ id: "imobiliaria", label: "Imobiliária", blurb: "Corretores" }];
  grid.innerHTML = items
    .map(
      (n) => `<button type="button" class="niche-card ${state.niche === n.id ? "active" : ""}" data-niche="${esc(n.id)}">
        <strong>${esc(n.label)}</strong>
        <span>${esc(n.blurb || "")}</span>
      </button>`
    )
    .join("");
  grid.querySelectorAll(".niche-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.niche = btn.dataset.niche;
      $("#niche").value = state.niche;
      $("#niche-custom").value = "";
      renderNicheGrid();
    });
  });
}

async function initMeta() {
  const meta = await api("/api/meta");
  state.catalog = meta.catalog || [];
  state.statuses = meta.statuses || [];
  state.scrapegraph = meta.scrapegraph || { available: false };
  state.company = meta.company || null;
  state.niche = "imobiliaria";
  $("#niche").value = state.niche;
  $("#city").value = meta.defaults?.city || "Porto Alegre";
  $("#limit").max = meta.defaults.maxLimit;
  $("#limit").value = Math.min(30, meta.defaults.limit);
  const foot = document.querySelector(".rail-foot p");
  if (foot) {
    foot.textContent = meta.scrapegraph?.available
      ? "OSM + Nominatim + web. IA opcional."
      : "OSM + Nominatim + busca web (gratis).";
  }
  const costPill = document.querySelector(".rail-foot .pill");
  if (costPill && meta.cost) costPill.title = meta.cost;
  renderNicheGrid();
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function moveSelection(delta) {
  const list = filteredLeads();
  if (!list.length) return;
  const idx = Math.max(0, list.findIndex((l) => l.id === state.selectedId));
  const next = list[(idx + delta + list.length) % list.length];
  state.selectedId = next.id;
  saveSession({ selectedId: state.selectedId });
  renderQueue();
  renderDetail();
  document.querySelector(`.lead-row[data-id="${CSS.escape(next.id)}"]`)?.scrollIntoView({
    block: "nearest",
  });
}

document.addEventListener("keydown", (e) => {
  if (state.view !== "queue") return;
  if (isTypingTarget(e.target)) return;
  const key = e.key.toLowerCase();
  if (key === "j" || key === "arrowdown") {
    e.preventDefault();
    moveSelection(1);
  } else if (key === "k" || key === "arrowup") {
    e.preventDefault();
    moveSelection(-1);
  } else if (key === "enter") {
    const lead = selectedLead();
    if (lead?.phone) {
      e.preventDefault();
      window.location.href = telHref(lead.phone);
      setStatus(lead.id, "calling", { stay: true });
    }
  } else if (key === "c") {
    const lead = selectedLead();
    if (lead?.callScript) {
      e.preventDefault();
      navigator.clipboard.writeText(lead.callScript);
      toast("Script copiado");
    }
  } else if (key === "n") {
    e.preventDefault();
    selectNext();
  } else if (/^[1-7]$/.test(key)) {
    const lead = selectedLead();
    if (!lead) return;
    e.preventDefault();
    setStatus(lead.id, STATUS_HOTKEYS[Number(key) - 1]);
  }
});

$$(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    setView(btn.dataset.view);
  });
});

$$("#grade-filters .chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    $$("#grade-filters .chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    state.grade = chip.dataset.grade;
    saveSession({ grade: state.grade });
    renderQueue();
    renderDetail();
  });
});

$("#search").addEventListener("input", (e) => {
  state.query = e.target.value;
  renderQueue();
});

$("#capture-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const custom = $("#niche-custom").value.trim();
  const niche = custom || $("#niche").value || state.niche;
  const city = $("#city").value.trim();
  const limit = Number($("#limit").value);
  const sources = [];
  if ($("#src-osm")?.checked) sources.push("osm");
  if ($("#src-nominatim")?.checked) sources.push("nominatim");
  if ($("#src-web")?.checked) sources.push("web");
  if (!sources.length) {
    toast("Marque ao menos uma fonte");
    return;
  }
  const quality = Boolean($("#quality-mode")?.checked);
  const btn = $("#btn-capture");
  const hint = $("#capture-hint");
  btn.disabled = true;
  hint.textContent = "Enviando…";
  try {
    const job = await api("/api/capture", {
      method: "POST",
      body: JSON.stringify({ niche, city, limit, sources, quality }),
    });
    updateProgress(job);
    startPoll(job.id);
    hint.textContent = "2–5 min. Busca 3× mais candidatos e filtra os melhores.";
  } catch (err) {
    hint.textContent = err.message;
    toast(err.message);
  } finally {
    btn.disabled = false;
  }
});

const session = loadSession();
if (session.grade) {
  state.grade = session.grade;
  $$("#grade-filters .chip").forEach((c) => c.classList.toggle("active", c.dataset.grade === state.grade));
}

await initMeta();
await loadHistory();
await renderRecent();

const { batches } = await api("/api/batches");
const preferred =
  (session.file && batches.find((b) => (b.id === session.file || b.file === session.file) && b.count > 0)) ||
  batches.find((b) => b.count > 0);

if (preferred) {
  try {
    const data = await api(`/api/leads?file=${encodeURIComponent(preferred.id || preferred.file)}`);
    state.file = data.campaign?.id || preferred.id || preferred.file;
    state.leads = data.leads || [];
    state.meta = data.meta || {};
    state.selectedId =
      (session.selectedId && state.leads.some((l) => l.id === session.selectedId)
        ? session.selectedId
        : null) ||
      nextCallable(null)?.id ||
      state.leads[0]?.id ||
      null;
  } catch {
    /* ignore */
  }
}

if (session.view === "queue" && state.file && state.leads.length) setView("queue");
else setView("capture");
