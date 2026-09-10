# LeadOps v3

Workstation profissional e escalavel para captura de leads (sem Apify).

## Arquitetura

- **SQLite** (`data/leadops.sqlite`) — campanhas, leads, jobs
- **Fila de jobs** — captura e enriquecimento em background
- **Workers** — concorrencia configuravel
- **Multi-fonte** — OSM + Nominatim + busca web
- **Modo qualidade** — 3x candidatos, filtra tel/site
- **IA opcional** — ScrapeGraph/MiMo

```
Browser → API → Job Queue → Pipeline/Sources → SQLite → Fila de ligacao
```

## Subir

```powershell
cd C:\Users\lucas\tools\leads-free
npm start
```

Abra **http://127.0.0.1:4174**

Health: `GET /api/health` · Metricas: `GET /api/metrics`

## Escala (env)

| Variavel | Default | Efeito |
|---|---|---|
| `PORT` | 4174 | Porta HTTP |
| `LEADS_MAX_CAPTURE_JOBS` | 1 | Capturas em paralelo |
| `LEADS_MAX_ENRICH_JOBS` | 2 | Enrich em paralelo |
| `LEADS_ENRICH_CONCURRENCY` | 5 | Sites por enrich |
| `LEADS_DEFAULT_LIMIT` | 40 | Limite padrao |
| `LEADS_DATA_DIR` | `./data` | Pasta do SQLite |
| `LEADS_LOG_LEVEL` | info | error/warn/info/debug |
| `LEADS_COMPANY_LABEL` | sistemas sob medida | Tom dos scripts |

Exemplo:

```powershell
$env:LEADS_MAX_ENRICH_JOBS="3"
$env:LEADS_COMPANY_LABEL="SyncChain"
npm start
```

## Fluxo

1. Capturar (fontes + modo qualidade)
2. Job entra na fila e grava campanha no SQLite
3. Fila de ligacao + Tel. gratis / IA enriquecer (tambem via jobs)
4. CSV / historico de campanhas

Lotes JSON antigos em `output/` importam automaticamente na primeira subida.

## Requisitos

Node **22+** (usa `node:sqlite`).
