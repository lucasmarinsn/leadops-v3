function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildHtml(leads, meta) {
  const counts = { A: 0, B: 0, C: 0 };
  for (const l of leads) counts[l.grade] = (counts[l.grade] || 0) + 1;
  const withPhone = leads.filter((l) => l.phone).length;

  const rows = leads
    .map((l, i) => {
      const maps =
        l.lat && l.lon
          ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${l.name} ${l.city}`)}`
          : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${l.name} ${l.city}`)}`;
      return `<tr class="g-${esc(l.grade)}">
  <td>${i + 1}</td>
  <td><strong>${esc(l.grade)}</strong></td>
  <td>${esc(l.name)}</td>
  <td>${esc(l.phone) || "<em>sem telefone</em>"}</td>
  <td>${esc(l.phoneSource || "-")}</td>
  <td>${esc(l.address) || "-"}</td>
  <td>${l.website ? `<a href="${esc(l.website)}" target="_blank" rel="noopener">site</a>` : "-"}</td>
  <td><a href="${esc(maps)}" target="_blank" rel="noopener">Maps</a></td>
  <td>${esc(l.why)}</td>
</tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Fila leads free — ${esc(meta.niche)} / ${esc(meta.city)}</title>
  <style>
    :root { color-scheme: light; --bg:#f6f3ee; --ink:#1c1917; --muted:#78716c; --line:#e7e5e4; --a:#166534; --b:#a16207; --c:#9f1239; }
    body { margin:0; font:15px/1.45 system-ui,Segoe UI,sans-serif; background:var(--bg); color:var(--ink); }
    main { max-width:1100px; margin:0 auto; padding:24px 16px 64px; }
    h1 { font-size:1.5rem; margin:0 0 8px; }
    p { color:var(--muted); margin:0 0 16px; }
    .stats { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:20px; }
    .chip { background:#fff; border:1px solid var(--line); padding:6px 10px; border-radius:8px; }
    table { width:100%; border-collapse:collapse; background:#fff; border:1px solid var(--line); }
    th, td { text-align:left; padding:10px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
    th { font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); }
    tr.g-A td:nth-child(2) { color:var(--a); }
    tr.g-B td:nth-child(2) { color:var(--b); }
    tr.g-C td:nth-child(2) { color:var(--c); }
    a { color:#1d4ed8; }
    @media (max-width:720px) {
      table, thead, tbody, th, td, tr { display:block; }
      thead { display:none; }
      tr { border-bottom:8px solid var(--bg); padding:8px; }
      td { border:0; padding:4px 0; }
      td::before { content:attr(data-label); display:block; font-size:11px; color:var(--muted); text-transform:uppercase; }
    }
  </style>
</head>
<body>
<main>
  <h1>Fila de ligacoes (gratis)</h1>
  <p>${esc(meta.niche)} em ${esc(meta.city)} · gerado ${esc(meta.generatedAt)} · fonte OpenStreetMap + site</p>
  <div class="stats">
    <span class="chip">Total ${leads.length}</span>
    <span class="chip">Com telefone ${withPhone}</span>
    <span class="chip">A ${counts.A || 0}</span>
    <span class="chip">B ${counts.B || 0}</span>
    <span class="chip">C ${counts.C || 0}</span>
  </div>
  <table>
    <thead>
      <tr>
        <th>#</th><th>Nota</th><th>Nome</th><th>Telefone</th><th>Fonte tel.</th>
        <th>Endereco</th><th>Site</th><th>Maps</th><th>Por que</th>
      </tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
</main>
</body>
</html>
`;
}
