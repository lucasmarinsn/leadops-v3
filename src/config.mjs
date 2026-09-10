export const CAPTURE = {
  overpassUrls: [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
  ],
  userAgent:
    process.env.LEADS_USER_AGENT ||
    "LeadOps/3.0 (+local; systems prospecting)",
  requestTimeoutMs: Number(process.env.LEADS_REQUEST_TIMEOUT_MS) || 120_000,
  websiteTimeoutMs: Number(process.env.LEADS_WEBSITE_TIMEOUT_MS) || 14_000,
  maxWebsiteBytes: 500_000,
  defaultLimit: Number(process.env.LEADS_DEFAULT_LIMIT) || 40,
  maxLimit: Number(process.env.LEADS_MAX_LIMIT) || 120,
  enrichConcurrency: Number(process.env.LEADS_ENRICH_CONCURRENCY) || 5,
  scrapegraphRoot:
    process.env.SCRAPEGRAPH_ROOT || "C:\\Users\\lucas\\tools\\scrapegraphai",
  scrapegraphTimeoutMs: Number(process.env.SCRAPEGRAPH_TIMEOUT_MS) || 180_000,
  scrapegraphDefaultLimit: Number(process.env.SCRAPEGRAPH_DEFAULT_LIMIT) || 8,
  scrapegraphMaxLimit: Number(process.env.SCRAPEGRAPH_MAX_LIMIT) || 15,
  nominatimDelayMs: Number(process.env.NOMINATIM_DELAY_MS) || 1100,
  webSearchDelayMs: Number(process.env.WEBSEARCH_DELAY_MS) || 900,
  candidateMultiplier: Number(process.env.LEADS_CANDIDATE_MULTIPLIER) || 3,
  qualityDefault: process.env.LEADS_QUALITY_DEFAULT !== "false",
  cityRadiusMeters: {
    "porto alegre": 14_000,
    "são paulo": 16_000,
    "sao paulo": 16_000,
    curitiba: 12_000,
    "belo horizonte": 14_000,
    "rio de janeiro": 14_000,
    default: 12_000,
  },
};

export const RUNTIME = {
  port: Number(process.env.PORT) || 4174,
  host: process.env.HOST || (process.env.RAILWAY_ENVIRONMENT || process.env.RENDER ? "0.0.0.0" : "127.0.0.1"),
  dataDir: process.env.LEADS_DATA_DIR || "",
  maxConcurrentCaptures: Number(process.env.LEADS_MAX_CAPTURE_JOBS) || 1,
  maxConcurrentEnrich: Number(process.env.LEADS_MAX_ENRICH_JOBS) || 2,
  jobPollMs: Number(process.env.LEADS_JOB_POLL_MS) || 400,
  logLevel: process.env.LEADS_LOG_LEVEL || "info",
  appName: "LeadOps",
  appVersion: "3.0.0",
  publicUrl: process.env.LEADS_PUBLIC_URL || "",
};

export const COMPANY = {
  label: process.env.LEADS_COMPANY_LABEL || "sistemas sob medida",
  pitch:
    process.env.LEADS_COMPANY_PITCH ||
    "Empresa de sistemas: mapeia processo, propoe software leve e acompanha implantacao organica.",
  offerMinutes: Number(process.env.LEADS_OFFER_MINUTES) || 15,
};

export const JUNK_HOSTS =
  /facebook\.com|instagram\.com|twitter\.com|x\.com|linkedin\.com|youtube\.com|tiktok\.com|google\.|g\.co|maps\.app|wa\.me|api\.whatsapp|olx\.|mercadolivre\.|amazon\.|magazinevoce|americanas\.|submarino\.|shopee\.|gov\.br|jus\.br|wikipedia\.|youtube\.|apple\.com|microsoft\.|booking\.com|tripadvisor\.|ifood\.|rappi\.|99app|uber\.|airbnb\.|quintoandar\.|zapimoveis\.|vivareal\.|imovelweb\.|loja\.|wordpress\.com|wixsite\.|blogspot\.|sites\.google/i;

export const JUNK_NAME =
  /\b(prefeitura|camara municipal|junta comercial|tribunal|delegacia|forum|ministerio|secretaria de|shopping center|mcdonald|burger king|subway|starbucks|banco do brasil|bradesco|itau|nubank|caixa economica|correios|loterica)\b/i;

export const NICHE_QUERIES = {
  academia: [
    'nwr["amenity"="gym"]',
    'nwr["leisure"="fitness_centre"]',
    'nwr["leisure"="sports_centre"]["sport"~"fitness|gym",i]',
    'nwr["name"~"academia|crossfit|smart fit|bodytech",i]["amenity"!="school"]',
  ],
  imobiliaria: [
    'nwr["office"="estate_agent"]',
    'nwr["shop"="estate_agent"]',
    'nwr["name"~"imobili[aá]ria|im[oó]veis|corretor",i]',
  ],
  restaurante: [
    'nwr["amenity"="restaurant"]',
    'nwr["amenity"="fast_food"]["name"]',
  ],
  cafe: ['nwr["amenity"="cafe"]', 'nwr["cuisine"~"coffee",i]'],
  hotel: [
    'nwr["tourism"="hotel"]',
    'nwr["tourism"="guest_house"]',
    'nwr["name"~"hotel|pousada",i]["tourism"]',
  ],
  clinica: [
    'nwr["amenity"="clinic"]',
    'nwr["amenity"="doctors"]',
    'nwr["healthcare"="clinic"]',
    'nwr["healthcare"="dentist"]',
    'nwr["name"~"cl[ií]nica|consult[oó]rio|odont",i]',
  ],
  escola: [
    'nwr["amenity"="school"]',
    'nwr["amenity"="college"]',
    'nwr["amenity"="language_school"]',
  ],
  agencia: [
    'nwr["office"="advertising_agency"]',
    'nwr["office"="marketing"]',
    'nwr["name"~"ag[eê]ncia (de )?(publicidade|marketing|digital)",i]',
  ],
  comercio: ['nwr["shop"]["name"]', 'nwr["office"="company"]["name"]'],
  representante: [
    'nwr["name"~"representante|representa[cç][aã]o|distribuidora|atacado|atacadista|revenda",i]',
    'nwr["office"="distributor"]',
    'nwr["shop"="wholesale"]',
  ],
  oficina: [
    'nwr["shop"="car_repair"]',
    'nwr["craft"="auto_repair"]',
    'nwr["name"~"oficina|auto center|funilaria",i]',
  ],
  salao: [
    'nwr["shop"="hairdresser"]',
    'nwr["shop"="beauty"]',
    'nwr["name"~"sal[aã]o|barbearia|beauty",i]',
  ],
  pet: [
    'nwr["shop"="pet"]',
    'nwr["amenity"="veterinary"]',
    'nwr["name"~"pet ?shop|veterin[aá]r",i]',
  ],
};

export const NICHE_WEB_QUERIES = {
  imobiliaria: [
    'imobiliária "{city}" telefone',
    'imobiliária "{city}" contato',
    '"corretor de imóveis" "{city}" site',
  ],
  academia: [
    'academia "{city}" telefone',
    'crossfit "{city}" contato',
    'academia musculação "{city}"',
  ],
  representante: [
    'representante comercial "{city}" telefone',
    'distribuidora "{city}" contato',
    'atacado "{city}" representante',
  ],
  agencia: [
    'agência de marketing "{city}" telefone',
    'agência publicidade "{city}" contato',
    'agência digital "{city}"',
  ],
  clinica: [
    'clínica "{city}" telefone',
    'consultório odontológico "{city}"',
    'clínica médica "{city}" contato',
  ],
  comercio: ['loja "{city}" telefone contato', 'empresa "{city}" atendimento telefone'],
  restaurante: ['restaurante "{city}" telefone', 'restaurante "{city}" reservas contato'],
  hotel: ['hotel "{city}" telefone', 'pousada "{city}" contato'],
  escola: ['escola "{city}" telefone matrícula', 'curso "{city}" telefone'],
  cafe: ['cafeteria "{city}" telefone', 'café "{city}" contato'],
  oficina: ['oficina mecânica "{city}" telefone', 'auto center "{city}" contato'],
  salao: ['salão de beleza "{city}" telefone', 'barbearia "{city}" contato'],
  pet: ['pet shop "{city}" telefone', 'clínica veterinária "{city}"'],
};

export const NICHE_NOMINATIM = {
  imobiliaria: ["imobiliária", "imobiliaria", "corretor de imóveis"],
  academia: ["academia", "fitness", "crossfit"],
  representante: ["distribuidora", "representante comercial", "atacado"],
  agencia: ["agência de publicidade", "agência de marketing"],
  clinica: ["clínica", "consultório", "odontologia"],
  comercio: ["loja", "comércio"],
  restaurante: ["restaurante"],
  hotel: ["hotel", "pousada"],
  escola: ["escola", "curso"],
  cafe: ["cafeteria", "café"],
  oficina: ["oficina mecânica", "auto center"],
  salao: ["salão de beleza", "barbearia"],
  pet: ["pet shop", "veterinária"],
};

export function nicheKeys() {
  return Object.keys(NICHE_QUERIES);
}

export const NICHE_CATALOG = [
  { id: "imobiliaria", label: "Imobiliária", blurb: "Agenda, visita e proposta" },
  { id: "academia", label: "Academia", blurb: "Matrícula e retorno" },
  { id: "representante", label: "Representante", blurb: "Carteira e pedido" },
  { id: "agencia", label: "Agência", blurb: "Operação e clientes" },
  { id: "clinica", label: "Clínica", blurb: "Agenda e paciente" },
  { id: "oficina", label: "Oficina", blurb: "Auto e serviço" },
  { id: "salao", label: "Salão", blurb: "Beleza e agenda" },
  { id: "pet", label: "Pet", blurb: "Pet shop e vet" },
  { id: "comercio", label: "Comércio", blurb: "Loja e atendimento" },
  { id: "restaurante", label: "Restaurante", blurb: "Pedidos e equipe" },
  { id: "hotel", label: "Hotel", blurb: "Reserva e check-in" },
  { id: "escola", label: "Escola", blurb: "Matrícula e turma" },
  { id: "cafe", label: "Café", blurb: "Operação local" },
];
