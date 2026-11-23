import { bitrix, portalBitrix } from "./comum.mts"

/* ============ Extração de dados das mensagens ============ */

export type Msg = { id: number; autor: string; nome: string; tipo: "cliente" | "operador" | "bot" | "sistema"; data: string; texto: string }

const limpar = (t: string) => String(t || "")
  .replace(/\[(?:\/)?(?:b|i|u|s|url|user|chat|br|quote|code|icon|context|send|put|call|color|size)[^\]]*\]/gi, " ")
  .replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()

function cnpjValido(c: string) {
  const n = c.replace(/\D/g, "")
  if (n.length !== 14 || /^(\d)\1+$/.test(n)) return false
  const dv = (base: string, pesos: number[]) => { const s = pesos.reduce((a, p, i) => a + Number(base[i]) * p, 0) % 11; return s < 2 ? 0 : 11 - s }
  const d1 = dv(n, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]), d2 = dv(n, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return d1 === Number(n[12]) && d2 === Number(n[13])
}
const fmtCnpj = (c: string) => { const n = c.replace(/\D/g, ""); return `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5, 8)}/${n.slice(8, 12)}-${n.slice(12)}` }

const MODELOS: [RegExp, string][] = [
  [/\bNB\s?-?\s?(400|800)\b/i, "NB400 / NB800"],
  [/\bNB\s?-?\s?(3|6|10)\s?i\b|\bNBST\b/i, "NB3i / NB6i / NB10i"],
  [/\bNB\s?-?\s?6\s?C\b/i, "NB6C"],
  [/\bNB\s?-?\s?100\s?S?\b/i, "NB100 / NB100S"],
  [/\bSU\s?6\s?M\b|\bGRD\s?4\s?B\b|\bST\s?(2|6)\s?C\b/i, "SU6M · GRD4B · ST2c/ST6c"],
]

/** Saudação da auxiliar: mensagem com "Suporte Técnico" + "me chamo / meu nome é / sou a" <Nome>. */
export function acharSaudacao(texto: string): string | null {
  if (!/Suporte\s+T[ée]cnico/i.test(texto)) return null
  const m = texto.match(/(?:me\s+chamo|meu\s+nome\s+[ée]|\bsou\s+(?:a|o))\s+([A-Za-zÀ-ÿ]+)/i)
  return m ? m[1] : null
}

export type Extraidos = Partial<{ cnpj: string; numero_serie: string; os_numero: string; email_nf: string; endereco: string; modelo: string; telefone: string; atendente_nome: string }>
export type Fontes = Record<string, string>

/** Percorre as mensagens (mais antigas primeiro) e devolve o último valor citado de cada dado. */
export function extrair(msgs: Msg[]): { dados: Extraidos; fontes: Fontes } {
  const dados: Extraidos = {}, fontes: Fontes = {}
  const set = (k: keyof Extraidos, v: string, m: Msg) => { if (v) { dados[k] = v; fontes[k] = `${m.nome}: ${m.texto.slice(0, 160)}` } }
  let pediuSerie = false
  for (const m of msgs) {
    const t = m.texto
    if (m.tipo === "bot" || m.tipo === "operador") { if (/s[ée]rie/i.test(t)) pediuSerie = true }
    if (m.tipo === "cliente" && t) {
      // nº de série no padrão Nebulize (ex.: NBV45054) ou resposta curta logo após o pedido do nº de série
      const nb = t.match(/\bN[BV][A-Z]?\s?-?\d{4,}\b/i)
      const curto = pediuSerie && t.length <= 40 ? t.match(/\b(?=[A-Z0-9\-]*\d)[A-Z0-9][A-Z0-9\-]{3,20}\b/i) : null
      if (nb) set("numero_serie", nb[0].replace(/\s/g, "").toUpperCase(), m)
      else if (curto && !/^\d{8}$/.test(curto[0]) && !/^\d{1,3}$/.test(curto[0])) set("numero_serie", curto[0].toUpperCase(), m)
      if (nb || curto) pediuSerie = false
    }
    if (m.tipo === "sistema") {
      const tel = t.match(/original post:\s*\+?(\d{10,13})\b(?!@)/i)
      if (tel && !/@lid|group/i.test(t)) set("telefone", "+" + tel[1].replace(/^(?!55)/, "55"), m)
      continue
    }
    if (m.tipo === "bot") continue
    // saudação da auxiliar
    const g = m.tipo === "operador" ? acharSaudacao(t) : null
    if (g) set("atendente_nome", g, m)
    // CNPJ (com dígito verificador válido)
    for (const c of t.match(/\b\d{2}\.?\d{3}\.?\d{3}\s?\/?\s?\d{4}\s?[-_.]?\s?\d{2}\b/g) || [])
      if (cnpjValido(c)) set("cnpj", fmtCnpj(c), m)
    // nº de série
    const s = t.match(/(?:n[º°o.]?\s*(?:de\s*)?s[ée]rie|s[ée]rie|serial|\bS\/N\b|\bNS\b)\s*(?:n[º°o.]?)?\s*[:#\-–]?\s*([A-Z0-9][A-Z0-9\-\/.]{3,24})/i)
    if (s && /\d/.test(s[1])) set("numero_serie", s[1].replace(/[.\-\/]$/, "").toUpperCase(), m)
    // O.S. Infraspeak
    const os = t.match(/(?:\bO\.?\s?S\.?|ordem\s+de\s+servi[çc]o|infraspeak|chamado)\s*(?:n[º°o.]?\s*)?[:#\-–]?\s*(\d{3,12})\b/i)
    if (os) set("os_numero", os[1], m)
    // e-mail (cliente)
    if (m.tipo === "cliente") {
      const e = t.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
      if (e && !/@lid$/i.test(e[0]) && !/nebulize\.com\.br$/i.test(e[0])) set("email_nf", e[0].toLowerCase(), m)
      const endRot = t.match(/endere[çc]o\s*(?:da loja|de instala[çc][ãa]o)?\s*[:\-–]\s*([^\n]{8,160})/i)
      const end = endRot ? [endRot[1]] : t.match(/\b(?:rua|r\.|avenida|av\.?|rodovia|rod\.|estrada|travessa|alameda|al\.|pra[çc]a)\s+[^\n]{6,140}/i)
      if (end && /\d|s\/n/i.test(end[0])) set("endereco", end[0].replace(/\s*(CNPJ|Insc|IE)\b.*$/i, "").trim(), m)
    }
    for (const [re, nome] of MODELOS) if (re.test(t)) { set("modelo", nome, m); break }
  }
  return { dados, fontes }
}

/* ============ Leitura da conversa no Bitrix ============ */

export type Conversa = {
  sessao: number | null; chat_id: number | null; nome_conversa: string; entidade_tipo: string; entidade_id: number | null
  cliente: string; empresa: string; telefone: string; email: string; crm_url: string | null; link: string | null
  encerrada: boolean; criada_em: string | null; mensagens: Msg[]
}

function tipoAutor(senderid: string, users: Record<string, any>): Msg["tipo"] {
  if (!senderid || senderid === "0") return "sistema"
  const u = users[senderid]
  if (!u) return "operador"
  if (u.bot) return "bot"
  if (u.connector || u.extranet || u.externalAuthId === "imconnector") return "cliente"
  return "operador"
}

export function mensagensDoHistorico(r: any): Msg[] {
  const users = r?.users || {}
  return Object.values(r?.message || {}).map((x: any) => ({
    id: Number(x.id), autor: String(x.senderid), nome: users[x.senderid]?.name || (x.senderid === "0" ? "Sistema" : x.senderid),
    tipo: tipoAutor(String(x.senderid), users), data: x.date, texto: limpar(x.text),
  })).sort((a, b) => a.id - b.id)
}

/** Busca diálogo, cliente do CRM e mensagens de uma conversa (por nº da sessão ou "chat123"). */
export async function lerConversa(numero: string): Promise<Conversa> {
  const chatMatch = numero.match(/chat\s*(\d+)/i)
  const digits = numero.replace(/\D/g, "")
  const dialogo = (await bitrix("imopenlines.dialog.get", chatMatch ? { CHAT_ID: Number(chatMatch[1]) } : { SESSION_ID: Number(digits) })).result
  if (!dialogo) throw new Error("Conversa não encontrada no Bitrix.")
  const partes = String(dialogo.entity_data_1 || "").split("|")
  const entidadeTipo = partes[1] && partes[1] !== "NONE" ? partes[1] : ""
  const entidadeId = Number(partes[2]) || null
  const sessao = chatMatch ? Number(partes[5]) || null : Number(digits)
  const chatId = Number(dialogo.id) || null

  // mensagens da sessão
  let mensagens: Msg[] = []
  if (chatId && sessao) {
    const h = (await bitrix("imopenlines.session.history.get", { CHAT_ID: chatId, SESSION_ID: sessao })).result
    mensagens = mensagensDoHistorico(h)
    // sessões longas: completa com as mensagens mais recentes do chat
    if (h?.hasNextPage) {
      const inicio = mensagens[0]?.id || 0
      const vistos = new Set(mensagens.map(m => m.id))
      let lastId: number | undefined
      for (let i = 0; i < 4; i++) {
        const r = (await bitrix("im.dialog.messages.get", { DIALOG_ID: `chat${chatId}`, LIMIT: 50, ...(lastId ? { LAST_ID: lastId } : {}) })).result
        const us = Object.fromEntries((r?.users || []).map((u: any) => [String(u.id), u]))
        const lote = (r?.messages || []) as any[]
        if (!lote.length) break
        for (const x of lote) {
          if (x.id < inicio || vistos.has(x.id)) continue
          vistos.add(x.id)
          mensagens.push({ id: x.id, autor: String(x.author_id), nome: us[x.author_id]?.name || "Sistema", tipo: tipoAutor(String(x.author_id), us), data: x.date, texto: limpar(x.text) })
        }
        lastId = Math.min(...lote.map((x: any) => x.id))
        if (lastId <= inicio) break
      }
      mensagens.sort((a, b) => a.id - b.id)
    }
  }

  // status (encerrada?) pela atividade do CRM ou pela mensagem de sistema
  let encerrada = mensagens.some(m => m.tipo === "sistema" && /encerrou a sess[ãa]o|sess[ãa]o (foi )?encerrada|conversa encerrada/i.test(m.texto))
  let criadaEm: string | null = mensagens[0]?.data || null
  if (sessao) {
    const act = await bitrix("crm.activity.list", { filter: { PROVIDER_ID: "IMOPENLINES_SESSION", ASSOCIATED_ENTITY_ID: sessao }, select: ["ID", "COMPLETED", "CREATED"] })
    const a = act.result?.[0]
    if (a) { encerrada = encerrada || a.COMPLETED === "Y"; criadaEm = criadaEm || a.CREATED }
  }

  // cliente no CRM
  let nome = "", telefone = "", email = "", empresa = ""
  const metodo = ({ LEAD: "crm.lead.get", CONTACT: "crm.contact.get", COMPANY: "crm.company.get", DEAL: "crm.deal.get" } as Record<string, string>)[entidadeTipo]
  if (metodo && entidadeId) {
    const e = (await bitrix(metodo, { id: entidadeId })).result || {}
    nome = e.TITLE && entidadeTipo !== "CONTACT" ? e.TITLE : [e.NAME, e.LAST_NAME].filter(Boolean).join(" ")
    empresa = e.COMPANY_TITLE || ""
    telefone = e.PHONE?.[0]?.VALUE || ""
    email = e.EMAIL?.[0]?.VALUE || ""
  }
  // sem lead/contato: nome da conversa ("cliente - Linha do Canal Aberto")
  if (!nome) nome = String(dialogo.name || "").split(" - ")[0].trim()

  return {
    sessao, chat_id: chatId, nome_conversa: dialogo.name, entidade_tipo: entidadeTipo, entidade_id: entidadeId,
    cliente: nome, empresa, telefone, email,
    crm_url: entidadeId && entidadeTipo ? `${portalBitrix()}/crm/${entidadeTipo.toLowerCase()}/details/${entidadeId}/` : null,
    link: chatId ? `${portalBitrix()}/online/?IM_DIALOG=chat${chatId}` : null,
    encerrada, criada_em: criadaEm, mensagens,
  }
}

/**
 * Monta o update do atendimento: preenche só campos vazios com o que veio do Bitrix
 * (a auxiliar sempre pode corrigir à mão; não sobrescrevemos o que ela digitou).
 */
export function montarUpdate(at: Record<string, any>, c: Conversa) {
  const { dados, fontes } = extrair(c.mensagens)
  const telefone = c.telefone || dados.telefone || ""
  const capturados: string[] = []
  const upd: Record<string, unknown> = {
    bitrix_sessao: c.sessao,
    bitrix_chat_id: c.chat_id,
    bitrix_link: c.link,
    bitrix_encerrada: c.encerrada,
    bitrix_dados: {
      sessao: c.sessao, chat_id: c.chat_id, nome_conversa: c.nome_conversa, criada_em: c.criada_em,
      entidade_tipo: c.entidade_tipo, entidade_id: c.entidade_id, cliente: c.cliente, empresa: c.empresa,
      telefone, email: c.email, crm_url: c.crm_url, extraidos: dados, fontes, lido_em: new Date().toISOString(),
      mensagens: c.mensagens.length,
    },
  }
  const preencher = (campo: string, valor: string | undefined | null) => {
    if (valor && !at[campo]) { upd[campo] = valor; capturados.push(campo) }
  }
  preencher("cliente", c.empresa ? `${c.cliente} · ${c.empresa}` : c.cliente)
  preencher("contato", `Conversa nº ${c.sessao}${telefone ? " · " + telefone : ""}`)
  preencher("cnpj", dados.cnpj)
  preencher("numero_serie", dados.numero_serie)
  preencher("os_numero", dados.os_numero)
  preencher("email_nf", dados.email_nf || (c.email && !/nebulize/i.test(c.email) ? c.email : undefined))
  preencher("endereco", dados.endereco)
  preencher("modelo", dados.modelo)
  return { upd, capturados, dados }
}
