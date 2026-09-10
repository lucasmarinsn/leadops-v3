import { digitsOnly } from "./phone.mjs";
import { COMPANY } from "./config.mjs";
import { isJunkLead } from "./dedupe.mjs";

function shortName(lead) {
  return String(lead.name || "").split("|")[0].trim().slice(0, 40);
}

function nicheBlob(lead) {
  return `${lead.niche || ""} ${lead.category || ""} ${lead.name || ""}`.toLowerCase();
}

function offerLine() {
  return `Oferta: ${COMPANY.offerMinutes} min para mapear o processo e ver se um sistema leve faz sentido (sem pacote generico).`;
}

function callScriptFor(lead, grade) {
  const short = shortName(lead);
  const niche = nicheBlob(lead);
  if (grade === "C") {
    return "Nao ligar agora. Complete telefone, descarte lixo, ou pule.";
  }
  if (lead.aiHook) {
    return `Abertura: Oi, falo com quem cuida da operacao na ${short}?\nGancho: ${lead.aiHook}\nPergunta: hoje isso vive no WhatsApp, planilha ou ja tem algum sistema?\n${offerLine()}\nFecho: encaixa ${COMPANY.offerMinutes} min esta semana?`;
  }
  if (/imobili|estate_agent|corretor/.test(niche)) {
    return `Abertura: Oi, falo com o responsavel comercial da ${short}?\nDor: lead de imovel esfria quando o retorno fica espalhado.\nPergunta: como acompanham lead → visita → proposta hoje?\n${offerLine()}\nFecho: qual horario hoje ou amanha?`;
  }
  if (/academia|gym|fitness|crossfit/.test(niche)) {
    return `Abertura: Oi, falo com quem cuida das matriculas na ${short}?\nDor: visita/aula experimental sem retorno no prazo.\nPergunta: o follow-up fica no WhatsApp da equipe?\n${offerLine()}\nFecho: encaixo ${COMPANY.offerMinutes} min esta semana?`;
  }
  if (/representante|distrib|atacad|craft|company/.test(niche)) {
    return `Abertura: Oi, falo com quem cuida da carteira na ${short}?\nDor: pedido e cliente espalhados em conversa.\nPergunta: como controlam oportunidade e follow-up hoje?\n${offerLine()}\nFecho: posso te mostrar um fluxo simples em ${COMPANY.offerMinutes} min?`;
  }
  if (/clinic|doutor|sa[uú]de|odont|m[eé]dic|pet|veterin/.test(niche)) {
    return `Abertura: Oi, falo com quem organiza a agenda na ${short}?\nDor: confirmação e retorno manuais.\nPergunta: o que mais trava o dia a dia hoje?\n${offerLine()}\nFecho: topa ${COMPANY.offerMinutes} min para mapear?`;
  }
  if (/oficina|car_repair|salao|hair|beauty/.test(niche)) {
    return `Abertura: Oi, falo com quem cuida da agenda/atendimento na ${short}?\nDor: cliente e retorno espalhados no zap.\nPergunta: como organizam agendamento e follow-up hoje?\n${offerLine()}\nFecho: encaixa ${COMPANY.offerMinutes} min?`;
  }
  if (/restaurante|cafe|hotel/.test(niche)) {
    return `Abertura: Oi, falo com quem cuida da operacao na ${short}?\nDor: pedido, reserva ou equipe sem um fluxo claro.\nPergunta: o que ainda vive no zap/planilha?\n${offerLine()}\nFecho: posso te ouvir ${COMPANY.offerMinutes} min esta semana?`;
  }
  return `Abertura: Oi, falo com quem cuida da operacao/comercial na ${short}?\nDor: atendimento e retorno espalhados no WhatsApp.\nPergunta: o que mais consome tempo da equipe hoje?\n${offerLine()}\nFecho: encaixa ${COMPANY.offerMinutes} min para mapear?`;
}

function followFor(lead, grade) {
  const short = shortName(lead);
  if (grade === "C") return "";
  if (lead.aiHook) {
    return `Oi, tudo bem? Vi a ${short}. ${lead.aiHook} Se fizer sentido, te mostro em ${COMPANY.offerMinutes} min um sistema leve para o processo de voces — sem pacote generico.`;
  }
  return `Oi, tudo bem? Vi a ${short}. Time que vive de atendimento no WhatsApp/planilha costuma perder retorno. Trabalho com sistemas sob medida: mapeamos o processo e vemos se um software leve ajuda. Topa ${COMPANY.offerMinutes} min?`;
}

function scoreLead({ hasPhone, hasWebsite, hasAddress, grade, aiFit, junk, source }) {
  let score = 35;
  if (hasPhone) score += 35;
  if (hasWebsite) score += 18;
  if (hasAddress) score += 8;
  if (grade === "A") score += 5;
  if (aiFit === "high") score += 8;
  if (aiFit === "low") score -= 8;
  if (String(source || "").includes("web") && hasWebsite) score += 4;
  if (junk || grade === "C") score = Math.min(score, 32);
  if (!hasPhone && !hasWebsite) score = Math.min(score, 25);
  return Math.max(0, Math.min(100, score));
}

export function qualifyLead(lead) {
  const name = String(lead.name || "").toLowerCase();
  const cat = nicheBlob(lead);
  const phone = digitsOnly(lead.phone);
  const hasPhone = phone.length >= 10;
  const hasWebsite = Boolean(lead.website);
  const hasAddress = Boolean(lead.address) && lead.address !== lead.city;
  const junk = Boolean(lead.aiJunk) || isJunkLead(lead);

  let grade = "B";
  let why = "Lead com dados parciais.";
  let nextAction = "Validar fit na ligacao (sistemas sob medida).";

  if (junk) {
    grade = "C";
    why = lead.aiJunkReason || "Fora do ICP (publico, franquia, marketplace ou lixo).";
    nextAction = "Descartar.";
  } else if (!hasPhone && !hasWebsite) {
    grade = "C";
    why = "Sem telefone e sem site. Baixa chance de contato.";
    nextAction = "Pular ou buscar no Maps.";
  } else if (!hasPhone) {
    grade = "C";
    why = "Tem site, sem telefone. Enriquecer (gratis ou IA) antes de ligar.";
    nextAction = "Buscar telefone no site / IA.";
  } else if (/imobili|estate_agent|corretor/.test(name + cat)) {
    grade = "A";
    why = hasWebsite
      ? "Imobiliaria/corretor com telefone e site. Bom para sistema de lead→visita→proposta."
      : "Imobiliaria/corretor com telefone. Dor digital clara.";
    nextAction = "Ligar hoje. Mapear fluxo comercial.";
  } else if (/academia|gym|fitness|crossfit/.test(name + cat)) {
    grade = hasWebsite ? "A" : "B";
    why = "Academia com telefone. Fit para sistema de matricula/retorno.";
    nextAction = "Ligar. Focar follow-up de matricula.";
  } else if (/representante|distrib|atacad/.test(name + cat)) {
    grade = "A";
    why = "Perfil comercial externo. Fit para sistema de carteira/pedido.";
    nextAction = "Ligar. Mapear controle de pedidos.";
  } else if (/clinic|doutor|odont|m[eé]dic|pet|veterin/.test(name + cat)) {
    grade = hasWebsite ? "A" : "B";
    why = "Saude/pet com telefone. Fit para agenda e retorno.";
    nextAction = "Ligar. Mapear agenda.";
  } else if (/oficina|car_repair|salao|hair|beauty/.test(name + cat)) {
    grade = hasWebsite ? "A" : "B";
    why = "Servico local com telefone. Fit para agenda/atendimento.";
    nextAction = "Ligar. Mapear agenda.";
  } else if (/ag[eê]ncia|marketing|advertising|publicidade/.test(name + cat)) {
    grade = "B";
    why = "Agencia/marketing. Pode ser parceiro ou ICP secundario.";
    nextAction = "Ligar se sobrar tempo na fila A.";
  } else if (lead.aiFit === "high" && hasPhone) {
    grade = "A";
    why = lead.aiFitWhy || "IA marcou fit alto com base no site.";
    nextAction = "Ligar e validar processo.";
  } else if (hasPhone && hasWebsite) {
    grade = "A";
    why = "Telefone + site. Dados suficientes para ligar.";
    nextAction = "Ligar e mapear processo.";
  } else if (hasPhone) {
    grade = "B";
    why = "Telefone valido com contexto parcial.";
    nextAction = "Ligar apos os A.";
  }

  if (lead.aiFit === "low" && grade === "A") {
    grade = "B";
    why = lead.aiFitWhy || "IA marcou fit baixo; manter na fila B.";
  }

  return {
    ...lead,
    grade,
    why,
    nextAction,
    score: scoreLead({
      hasPhone,
      hasWebsite,
      hasAddress,
      grade,
      aiFit: lead.aiFit,
      junk,
      source: lead.source,
    }),
    follow: followFor(lead, grade),
    callScript: callScriptFor(lead, grade),
    status: lead.status || "todo",
    notes: lead.notes || "",
    calledAt: lead.calledAt || "",
  };
}

export function qualifyAll(leads) {
  return leads.map(qualifyLead).sort((a, b) => {
    const rank = { A: 0, B: 1, C: 2 };
    const d = rank[a.grade] - rank[b.grade];
    if (d !== 0) return d;
    return (b.score || 0) - (a.score || 0) || String(a.name).localeCompare(String(b.name), "pt-BR");
  });
}

export const STATUS_OPTIONS = [
  { id: "todo", label: "Na fila" },
  { id: "calling", label: "Ligando" },
  { id: "no_answer", label: "Nao atendeu" },
  { id: "answered", label: "Atendeu" },
  { id: "interested", label: "Interessado" },
  { id: "rejected", label: "Recusou" },
  { id: "skip", label: "Pular" },
];
