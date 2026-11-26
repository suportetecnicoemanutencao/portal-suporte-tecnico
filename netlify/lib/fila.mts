/**
 * Fila de atendimento — mesmo motor do Monitor Bitrix da Katielen (Codigo.gs), rodando no portal.
 *
 * Para cada usuária com o Bitrix conectado ("Conectar meu Bitrix" → tabela bitrix_webhooks):
 *  1. lê a lista de Canais Abertos dela (im.recent.list, com o webhook DELA);
 *  2. classifica cada conversa com as mesmas regras do classificar_() do script:
 *     pedido prometido · cliente esperando (+4 h) · retornar ao cliente · promessa · novas · respondidas · pausadas;
 *  3. procura cobranças nas mensagens novas (você escreveu "cobrança"/"cobrar" ou a conversa fala de valores);
 *  4. grava o resultado em fila_conversas (o portal mostra) e avisa no sino do Bitrix
 *     (mesmos intervalos do script) + resumo do dia às 8 h.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { bitrix } from "./comum.mts"

const CFG = {
  HORAS_SEM_RESPOSTA: 4,
  HORAS_PEDIDO: 0.5,
  REPETIR_PEDIDO_HORAS: 1,
  HORAS_PROMESSA: 1,
  HORAS_RESPONDIDO: 24,
  HORAS_ATUALIZAR_CHAMADO: 24,
  REPETIR_ALERTA_HORAS: 3,
  DIAS_MAX_ALERTA: 2,
  DIAS_MAX_PAINEL: 3650,
  MAX_PAGINAS_LISTA: 15,
  VARRER_COBRANCA: 120,
  INICIO: "07:00", FIM: "17:45", DIAS_UTEIS: [1, 2, 3, 4, 5], HORA_RESUMO: 8,
}
const H = 36e5

const FRASES_ESPERA = [
  "so um momento", "um momento", "um minuto", "um instante", "so um instante",
  "vou verificar", "vou ver", "vou checar", "vou confirmar", "vou consultar",
  "vou analisar", "ja verifico", "ja vejo", "ja te retorno", "te retorno",
  "retorno em", "ja retorno", "aguarde", "me aguarde", "vou encaminhar",
  "vou passar", "ja volto", "vou te enviar", "vou enviar", "vou providenciar",
]
const FRASES_PEDIDO = [
  "gerar um pedido", "gerar o pedido", "gerar pedido", "gero o pedido", "gero um pedido", "gerando o pedido",
  "fazer o pedido", "fazer um pedido", "faco o pedido", "abrir o pedido", "abrir um pedido",
  "lancar o pedido", "lancar um pedido", "emitir o pedido", "emitir um pedido", "vou pedir", "solicitar o pedido",
]
const RX_COBRANCA_EXPLICITA = /\bcobran[cç]a\b|\bcobrar\b|#cobrar/i
const RX_VALORES = /r\$\s*\d|\b\d{1,3}(\.\d{3})*,\d{2}\b|\bvalor(es)?\b|\bor[cç]amento\b|\bboleto\b|\bpix\b|\bpagamento\b|\bfatura\b|\breais\b/i
const IGNORAR_CLIENTE = [
  "reagiu a", "va ao aparelho", "mensagem apagada", "chamada de voz perdida",
  "aqui e a ", "aqui e o ", "da nebulize", "este e um lembrete", "lembrete de que", "referente a nota", "referente as notas",
]
const PALAVRAS_ENCERRAMENTO = ["ok", "ta", "blz", "beleza", "obrigado", "obrigada", "obg", "brigado", "brigada", "vlw", "valeu",
  "show", "perfeito", "certo", "combinado", "otimo", "top", "entendi", "agradeco", "muito", "grato", "grata", "disponha", "de", "nada", "e", "nos"]
const IGNORAR_OPERADOR = ["aguardando seu retorno", "aguardamos seu retorno", "por entrar em contato", "atendimento foi encerrado", "avalie nosso atendimento"]

const limparTexto = (t: unknown) => String(t || "").replace(/\[(\/?)[A-Za-z]+[^\]]*\]/g, "").replace(/\s+/g, " ").trim()
const normalizar = (t: unknown) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
const ehPedido = (t: unknown) => { const n = normalizar(limparTexto(t)); return FRASES_PEDIDO.some(f => n.includes(f)) }
const ehPromessa = (t: unknown) => { const n = normalizar(limparTexto(t)); return FRASES_ESPERA.some(f => n.includes(f)) }
function ehEncerramento(tNorm: string) {
  if (!tNorm || tNorm === "[arquivo]") return false
  const p = tNorm.replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean)
  if (!p.length) return tNorm.length <= 8
  return p.length <= 6 && p.every(w => PALAVRAS_ENCERRAMENTO.includes(w))
}
const ehMsgSistema = (x: any) => x.system === "Y" || x.system === true ||
  /\b(redirecionou|transferiu|encaminhou) a conversa\b|\bentrou na conversa\b|\bsaiu da conversa\b/i.test(limparTexto(x.text))
function textoMsg(m: any) {
  const t = limparTexto(m.text); if (t) return t
  const bruto = String(m.text || "")
  if (/audio|áudio/i.test(bruto)) return "[áudio]"
  if (m.file || /\[(file|arquivo|video|imagem|image|foto)/i.test(bruto)) return "[arquivo]"
  return bruto ? bruto.slice(0, 60) : "[mídia]"
}
const dialogIdDe = (it: any) => /^chat\d+$/.test(String(it.id)) ? String(it.id) : it.chat_id ? "chat" + it.chat_id : it.chat?.id ? "chat" + it.chat.id : String(it.id || "")
const nomeDe = (it: any) => limparTexto(it.title || it.chat?.name || it.user?.name || dialogIdDe(it))
const ehGrupo = (it: any) => /@g\.us/i.test(String(it.chat?.entity_id || "")) || (!!it.chat?.type && it.chat.type !== "lines")
const enxugarMsgs = (l: any[]) => (l || []).map(x => ({ id: x.id, text: String(x.text || "").slice(0, 600), author_id: x.author_id, date: x.date, system: x.system, file: !!(x.params && x.params.FILE_ID) }))
function tipoDeUsuarioBitrix(u: any) {
  u = u || {}
  if (u.bot) return "bot"
  if (u.connector || u.external_auth_id === "imconnector" || u.extranet || u.network) return "cliente"
  if (u.id && (u.type === "employee" || (Array.isArray(u.departments) && u.departments.length))) return "empresa"
  return "cliente"
}
function emExpediente(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(d).map(x => [x.type, x.value]))
  const dia = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday) + 1
  const min = (s: string) => Number(s.split(":")[0]) * 60 + Number(s.split(":")[1] || 0)
  const atual = Number(p.hour) * 60 + Number(p.minute)
  return { ok: CFG.DIAS_UTEIS.includes(dia) && atual >= min(CFG.INICIO) && atual <= min(CFG.FIM), hora: Number(p.hour), dia }
}
const hojeSP = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date())

/** batch do Bitrix com o webhook da usuária: { chave: [metodo, params] } → { chave: resultado } */
async function lote(hook: string, cmds: Record<string, [string, Record<string, unknown>]>) {
  const chaves = Object.keys(cmds), saida: Record<string, any> = {}
  for (let i = 0; i < chaves.length; i += 50) {
    const cmd: Record<string, string> = {}
    for (const k of chaves.slice(i, i + 50)) {
      const [metodo, params] = cmds[k]
      const q = Object.entries(params || {}).map(([p, v]) => encodeURIComponent(p) + "=" + encodeURIComponent(String(v))).join("&")
      cmd[k] = metodo + (q ? "?" + q : "")
    }
    try { const r = await bitrix("batch", { halt: 0, cmd }, hook); Object.assign(saida, r.result?.result || {}) }
    catch (e) { console.error("fila lote:", (e as Error).message) }
  }
  return saida
}

async function listar(hook: string) {
  let todas: any[] = [], ultima: string | null = null
  const limite = Date.now() - 60 * 864e5
  for (let i = 0; i < CFG.MAX_PAGINAS_LISTA; i++) {
    const r = (await bitrix("im.recent.list", { ONLY_OPENLINES: "Y", ...(ultima ? { LAST_MESSAGE_DATE: ultima } : {}) }, hook)).result || {}
    const itens = r.items || []
    todas = todas.concat(itens)
    const d = itens.at(-1)?.message?.date
    if (!r.hasMore || !itens.length || !d || d === ultima || Date.parse(d) < limite) break
    ultima = d
  }
  const vistos = new Set<string>()
  return todas.filter(it => { const k = dialogIdDe(it); if (vistos.has(k)) return false; vistos.add(k); return true })
}

type Perfil = { id: string; nome: string; bitrix_user_id: number }

/** Roda a fila de uma usuária. Devolve quantas conversas ficaram na fila. */
async function filaDaUsuaria(db: SupabaseClient, p: Perfil, hook: string, tempoOk: () => boolean) {
  const uid = Number(p.bitrix_user_id), ops = [uid]
  const agora = Date.now()
  const lista = await listar(hook)

  // só conversas dela (dona/gerente, sem gerente, ou na fila) — ehDoResponsavel_ do script
  const doResp = (it: any) => {
    const ch = it.chat || {}
    if (!(ch.manager_list || []).length) return true
    return Number(ch.owner) === uid || (ch.manager_list || []).map(Number).includes(uid)
  }
  const minhas = lista.filter(it => (it.lines && Number(it.lines.status) < 10 && !ehGrupo(it)) || ehGrupo(it) || doResp(it))

  // estado (Pronto/Pausar), cache de mensagens e tipos de usuário
  const [{ data: est }, { data: cache }] = await Promise.all([
    db.from("fila_estado").select("*").eq("perfil_id", p.id),
    db.from("fila_mensagens").select("dialog_id,ultimo_id,msgs,cob_ultimo_id").eq("perfil_id", p.id),
  ])
  const estado = new Map((est || []).map(e => [e.dialog_id, e]))
  const cacheMsgs = new Map((cache || []).map(c => [c.dialog_id, c]))

  // quais conversas precisam das mensagens (mesmos casos em que o script chama lerMensagens_)
  const precisaMsgs = new Set<string>()
  let varrer = 0
  for (const it of minhas) {
    const m = it.message || {}; if (!m.id || !m.date) continue
    const d = dialogIdDe(it)
    const naFila = !ehGrupo(it) && !!(it.lines && Number(it.lines.status) < 10)
    const tNorm = normalizar(limparTexto(m.text))
    if (naFila || Number(m.author_id || 0) === 0 || (Number(m.author_id) !== uid && ehEncerramento(tNorm))) precisaMsgs.add(d)
    const c = cacheMsgs.get(d)
    if ((!c || String(c.cob_ultimo_id) !== String(m.id)) && varrer < CFG.VARRER_COBRANCA && agora - Date.parse(m.date) < 30 * 864e5) { precisaMsgs.add(d); varrer++ }
  }
  // lê em lote só o que mudou desde a última leitura
  const ultimoId = new Map(minhas.map(it => [dialogIdDe(it), String(it.message?.id || "")]))
  const faltam = [...precisaMsgs].filter(d => { const c = cacheMsgs.get(d); return !c || String(c.ultimo_id) !== ultimoId.get(d) || !c.msgs })
  if (faltam.length && tempoOk()) {
    const cmds: Record<string, [string, Record<string, unknown>]> = {}
    faltam.forEach((d, i) => cmds["m" + i] = ["im.dialog.messages.get", { DIALOG_ID: d, LIMIT: 30 }])
    const res = await lote(hook, cmds)
    const gravar: any[] = []
    faltam.forEach((d, i) => {
      if (!res["m" + i]) return
      const msgs = enxugarMsgs(res["m" + i].messages)
      const antigo = cacheMsgs.get(d)
      const novo = { perfil_id: p.id, dialog_id: d, ultimo_id: ultimoId.get(d), msgs, cob_ultimo_id: antigo?.cob_ultimo_id ?? null }
      cacheMsgs.set(d, novo); gravar.push(novo)
    })
    if (gravar.length) await db.from("fila_mensagens").upsert(gravar, { onConflict: "perfil_id,dialog_id" })
  }
  const msgsDe = (d: string): any[] => (cacheMsgs.get(d)?.msgs as any[]) || []

  // tipo de cada autor (op / empresa / bot / cliente) — im.user.get em lote, guardado em bitrix_usuarios
  const autores = new Set<number>()
  for (const it of minhas) { const a = Number(it.message?.author_id || 0); if (a) autores.add(a) }
  for (const d of precisaMsgs) for (const x of msgsDe(d)) { const a = Number(x.author_id || 0); if (a) autores.add(a) }
  ops.forEach(o => autores.delete(o))
  const tipos = new Map<number, string>()
  if (autores.size) {
    const { data: tu } = await db.from("bitrix_usuarios").select("id,tipo").in("id", [...autores])
    for (const t of tu || []) tipos.set(Number(t.id), t.tipo)
    const sem = [...autores].filter(a => !tipos.has(a))
    if (sem.length && tempoOk()) {
      const cmds: Record<string, [string, Record<string, unknown>]> = {}
      sem.forEach(id => cmds["u" + id] = ["im.user.get", { ID: id }])
      const res = await lote(hook, cmds)
      const gravar = sem.filter(id => res["u" + id]).map(id => ({ id, tipo: tipoDeUsuarioBitrix(res["u" + id]), atualizado_em: new Date().toISOString() }))
      gravar.forEach(g => tipos.set(g.id, g.tipo))
      if (gravar.length) await db.from("bitrix_usuarios").upsert(gravar, { onConflict: "id" })
    }
  }
  const tipoUsuario = (id: unknown) => { const n = Number(id || 0); if (!n) return "sistema"; if (ops.includes(n)) return "op"; return tipos.get(n) || "cliente" }
  const ehEquipe = (id: unknown) => { const t = tipoUsuario(id); return t === "op" || t === "empresa" }
  const ordenadas = (d: string) => msgsDe(d).slice().sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
  const ultimaMsgCliente = (d: string, cli: number) => ordenadas(d).find(x => Number(x.author_id) === cli && !ehMsgSistema(x)) || null
  const ultimaMsgReal = (d: string) => ordenadas(d).find(x => Number(x.author_id) !== 0 && !ehMsgSistema(x)) || null
  const promessaAnterior = (d: string) => {
    const minha = ordenadas(d).find(x => ops.includes(Number(x.author_id))); if (!minha) return null
    const base = { ts: Date.parse(minha.date), texto: limparTexto(minha.text).slice(0, 100) }
    if (ehPedido(minha.text)) return { tipo: "pedido", ...base }
    const t = normalizar(limparTexto(minha.text))
    if (!IGNORAR_OPERADOR.some(f => t.includes(f)) && ehPromessa(minha.text)) return { tipo: "promessa", ...base }
    return null
  }

  // ---------- classificar_() ----------
  type Card = { dialog_id: string; chat_id: number | null; tipo: string; msg_id: string; nome: string; texto: string; ts: number; na_fila: boolean }
  const cards: Card[] = []
  const diasMax = CFG.DIAS_MAX_PAINEL
  const add = (tipo: string, it: any, m: any, texto: string, ts: number, naFila = false) => cards.push({
    dialog_id: dialogIdDe(it), chat_id: Number(it.chat?.id || it.chat_id) || null, tipo, msg_id: String(it.message.id),
    nome: (ehGrupo(it) ? "[grupo] " : "") + nomeDe(it), texto: texto.slice(0, 200), ts, na_fila: naFila,
  })
  for (const it of minhas) {
    let m = it.message || {}
    if (!m.id || !m.date) continue
    const d = dialogIdDe(it), cli = it.user || {}, naoLidas = Number(it.counter || 0)
    const grupo = ehGrupo(it)
    const naFila = !grupo && !!(it.lines && Number(it.lines.status) < 10)
    const ign = estado.get(d)
    if (ign?.ignorado_msg && String(ign.ignorado_msg) === String(it.message.id)) continue   // marcada como Pronto

    if (naFila) {
      const real = ultimaMsgCliente(d, Number(cli.id)), base = real || m
      const hs = (agora - Date.parse(base.date)) / H
      if (hs > diasMax * 24) continue
      add(hs >= CFG.HORAS_SEM_RESPOSTA ? "cliente" : "nova", it, base, "Na fila — aceite o atendimento" + (real ? ' · Cliente: "' + textoMsg(real) + '"' : ""), Date.parse(base.date), true)
      continue
    }
    let notaSistema = ""
    if (Number(m.author_id || 0) === 0) {
      notaSistema = limparTexto(m.text)
      const real = ultimaMsgReal(d)
      const clienteFalou = real && (grupo ? !ops.includes(Number(real.author_id)) : Number(real.author_id) === Number(cli.id))
      if (clienteFalou) m = { ...real, id: it.message.id }
      else {
        const hs = (agora - Date.parse(m.date)) / H
        if (hs <= diasMax * 24 && (naoLidas > 0 || /transferiu|transferida|encaminh/i.test(notaSistema)))
          add("nova", it, m, "Transferida: " + notaSistema.slice(0, 130), Date.parse(m.date))
        continue
      }
    }
    const autor = Number(m.author_id || 0)
    const horas = (agora - Date.parse(m.date)) / H
    if (horas > diasMax * 24) continue
    // colega da empresa respondeu → conta como respondido
    if (autor && !ops.includes(autor) && tipoUsuario(autor) === "empresa" && !ehMsgSistema(m)) {
      if (horas <= CFG.HORAS_RESPONDIDO) add("respondido", it, m, "colega: " + textoMsg(m), Date.parse(m.date))
      continue
    }
    const ehCliente = grupo
      ? (autor !== 0 && !ehEquipe(autor) && tipoUsuario(autor) !== "bot" && !ehMsgSistema(m))
      : (cli.connector === true || cli.external_auth_id === "imconnector" ? autor === Number(cli.id) : !ops.includes(autor))
    if (it.lines && Number(it.lines.status) >= 60 && !ehCliente) continue    // sessão encerrada
    const texto = textoMsg(m) + (notaSistema ? " · " + notaSistema : "")
    const tNorm = normalizar(limparTexto(m.text))
    if (ehCliente) {
      if (IGNORAR_CLIENTE.some(f => tNorm.includes(f))) continue
      if (ehEncerramento(tNorm)) {
        const ant = promessaAnterior(d)
        if (ant) {
          const hp = (agora - ant.ts) / H
          const lim = ant.tipo === "pedido" ? CFG.HORAS_PEDIDO : CFG.HORAS_PROMESSA
          if (hp >= lim) add(ant.tipo, it, m, 'Você: "' + ant.texto + '" · Cliente: "' + texto + '"', ant.ts)
          else add("respondido", it, m, 'Você: "' + ant.texto + '" · Cliente: "' + texto + '"', ant.ts)
        } else add("retornar", it, m, texto, Date.parse(m.date))
        continue
      }
      add(horas >= CFG.HORAS_SEM_RESPOSTA ? "cliente" : "nova", it, m, texto, Date.parse(m.date))
    } else if (ops.includes(autor) && ehPedido(m.text)) {
      add(horas >= CFG.HORAS_PEDIDO ? "pedido" : "respondido", it, m, texto, Date.parse(m.date))
    } else if (ops.includes(autor) && !IGNORAR_OPERADOR.some(f => tNorm.includes(f)) && ehPromessa(m.text)) {
      add(horas >= CFG.HORAS_PROMESSA ? "promessa" : "respondido", it, m, texto, Date.parse(m.date))
    } else if (ops.includes(autor) && horas <= CFG.HORAS_RESPONDIDO) {
      add("respondido", it, m, texto, Date.parse(m.date))
    } else if (naoLidas > 0 && !ops.includes(autor) && tipoUsuario(autor) === "cliente") {
      add("nova", it, m, texto, Date.parse(m.date))
    }
  }

  // ---------- cobranças (varrerCobrancas_) ----------
  const { data: cobAbertas } = await db.from("fila_cobrancas").select("dialog_id").eq("perfil_id", p.id).eq("status", "pendente")
  const temCob = new Set((cobAbertas || []).map(c => c.dialog_id))
  const novasCob: any[] = [], marcarScan: any[] = []
  for (const it of minhas) {
    const m = it.message || {}; const d = dialogIdDe(it)
    const c = cacheMsgs.get(d)
    if (!m.id || !c?.msgs || String(c.cob_ultimo_id) === String(m.id)) continue
    const desde = Number(c.cob_ultimo_id || 0)
    marcarScan.push({ perfil_id: p.id, dialog_id: d, ultimo_id: c.ultimo_id, msgs: c.msgs, cob_ultimo_id: String(m.id) })
    if (temCob.has(d)) continue
    const novas = (c.msgs as any[]).filter(x => Number(x.id) > desde && Number(x.author_id) !== 0).sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    // na primeira leitura de uma conversa só vale o que for das últimas 48 h (evita cobranças antigas já feitas)
    const base = desde ? novas : novas.filter(x => agora - Date.parse(x.date) < 48 * H)
    const explicita = base.find(x => ops.includes(Number(x.author_id)) && RX_COBRANCA_EXPLICITA.test(String(x.text || "").toLowerCase()))
    const valores = explicita ? null : base.find(x => RX_VALORES.test(String(x.text || "").toLowerCase()))
    const achado = explicita || valores
    if (!achado) continue
    const texto = limparTexto(achado.text)
    const valor = (texto.match(/R\$\s*[\d.]+(,\d{2})?/i) || texto.match(/\b\d{1,3}(\.\d{3})*,\d{2}\b/) || [""])[0]
    novasCob.push({ perfil_id: p.id, dialog_id: d, nome: nomeDe(it), texto: texto.slice(0, 300), valor, origem: explicita ? "Você escreveu cobrança" : "Conversa com valores", quando: new Date(Date.parse(achado.date) || agora).toISOString() })
    temCob.add(d)
  }
  if (novasCob.length) await db.from("fila_cobrancas").insert(novasCob)
  if (marcarScan.length) await db.from("fila_mensagens").upsert(marcarScan, { onConflict: "perfil_id,dialog_id" })

  // ---------- grava a fila (com pausados) ----------
  const linhas = cards.map(c => {
    const e = estado.get(c.dialog_id)
    const pausado = !!(e?.pausado_msg && String(e.pausado_msg) === c.msg_id)
    // Resp.: conversa passada para outra pessoa no portal
    const resp = e?.repassado_para || p.id
    return { origem_id: p.id, perfil_id: resp, ...c, ts: new Date(c.ts).toISOString(), pausado, pausado_em: pausado ? e!.pausado_em : null, motivo: pausado ? e!.motivo : null, atualizado_em: new Date().toISOString() }
  })
  await db.from("fila_conversas").delete().eq("origem_id", p.id)
  if (linhas.length) await db.from("fila_conversas").insert(linhas)
  await db.from("perfis").update({ bitrix_lista_em: new Date().toISOString(), bitrix_lista_erro: null }).eq("id", p.id)

  // ---------- avisos no sino do Bitrix (verificarUsuario_ / resumoUsuario_) ----------
  await avisar(db, p, hook, linhas.filter(l => l.perfil_id === p.id))   // repassadas: avisa no portal de quem recebeu
  return linhas.length
}

async function avisar(db: SupabaseClient, p: Perfil, hook: string, linhas: any[]) {
  const ex = emExpediente(); if (!ex.ok) return
  const agora = Date.now(), hoje = hojeSP()
  const { data: nt } = await db.from("fila_notificados").select("chave,em").eq("perfil_id", p.id)
  const notif = new Map((nt || []).map(n => [n.chave, Date.parse(n.em)]))
  const ativos = linhas.filter(l => !l.pausado)
  const horas = (l: any) => (agora - Date.parse(l.ts)) / H
  const recente = (l: any) => horas(l) <= CFG.DIAS_MAX_ALERTA * 24
  const link = (d: string) => `https://nebulize.bitrix24.com.br/online/?IM_DIALOG=${d}`
  const resumo = (titulo: string, lista: any[]) => `${titulo}: ${lista.length}[/B] — ` +
    lista.slice(0, 3).map(x => `[URL=${link(x.dialog_id)}]${String(x.nome || "").split(" - ")[0].slice(0, 28)}[/URL]`).join(", ") + (lista.length > 3 ? ` +${lista.length - 3}` : "")
  const enviar = async (texto: string) => {
    try { await bitrix("im.notify.system.add", { USER_ID: p.bitrix_user_id, MESSAGE: texto }, hook) }
    catch { try { await bitrix("im.notify.personal.add", { USER_ID: p.bitrix_user_id, MESSAGE: texto }, hook) } catch (e) { console.error("fila aviso:", (e as Error).message) } }
  }
  const gravar: any[] = []
  const marca = (chave: string) => gravar.push({ perfil_id: p.id, chave, em: new Date().toISOString() })

  // resumo do dia (1x, a partir das 8 h)
  if (ex.hora >= CFG.HORA_RESUMO && !notif.has("resumo:" + hoje)) {
    const g = (t: string) => ativos.filter(l => l.tipo === t && recente(l))
    const { data: cobs } = await db.from("fila_cobrancas").select("dialog_id,nome").eq("perfil_id", p.id).eq("status", "pendente")
    const partes = [["🚨 [B]Pedidos prometidos", g("pedido")], ["⏰ [B]Clientes esperando +4h", g("cliente")], ["↩️ [B]Retornar ao cliente", g("retornar")],
      ["💬 [B]Promessas pendentes", g("promessa")], ["🆕 [B]Mensagens novas", g("nova")], ["💰 [B]Cobranças pendentes", cobs || []]].filter(([, l]) => (l as any[]).length)
    const total = partes.reduce((s, [, l]) => s + (l as any[]).length, 0)
    await enviar(total ? [`☀️ [B]Bom dia! Seu dia no Bitrix — ${total} pendência(s)[/B]`, "", ...partes.map(([t, l]) => resumo(t as string, l as any[])), "", "Comece pelos 🚨 e ⏰. Detalhes em Minhas conversas no portal."].join("\n")
      : "☀️ [B]Bom dia![/B] Nenhuma conversa pendente no Bitrix.")
    marca("resumo:" + hoje)
  }

  // aviso curto do que ficou urgente agora
  const precisa = (ch: string, rep: number) => !notif.has(ch) || agora - notif.get(ch)! >= rep
  const rep = CFG.REPETIR_ALERTA_HORAS * H
  const ped = ativos.filter(l => l.tipo === "pedido" && recente(l) && precisa("D:" + l.msg_id, CFG.REPETIR_PEDIDO_HORAS * H))
  const atras = ativos.filter(l => l.tipo === "cliente" && recente(l) && precisa("A:" + l.msg_id, rep))
  const prom = ativos.filter(l => l.tipo === "promessa" && recente(l) && precisa("P:" + l.msg_id, rep))
  const ret = ativos.filter(l => l.tipo === "retornar" && recente(l) && horas(l) >= CFG.HORAS_SEM_RESPOSTA && precisa("R:" + l.msg_id, rep))
  if (ped.length || atras.length || prom.length || ret.length) {
    const linhasMsg = ["🔔 [B]Precisa de atenção agora[/B]"]
    if (ped.length) linhasMsg.push(resumo("🚨 [B]Pedido prometido", ped))
    if (atras.length) linhasMsg.push(resumo("⏰ [B]Cliente esperando +4h", atras))
    if (prom.length) linhasMsg.push(resumo("💬 [B]Promessa sem retorno", prom))
    if (ret.length) linhasMsg.push(resumo("↩️ [B]Retornar ao cliente", ret))
    await enviar(linhasMsg.join("\n"))
    ped.forEach(l => marca("D:" + l.msg_id)); atras.forEach(l => marca("A:" + l.msg_id))
    prom.forEach(l => marca("P:" + l.msg_id)); ret.forEach(l => marca("R:" + l.msg_id))
  }
  if (gravar.length) await db.from("fila_notificados").upsert(gravar, { onConflict: "perfil_id,chave" })
}

/** Roda a fila de todas as usuárias com o Bitrix conectado. */
export async function filaDaEquipe(db: SupabaseClient, tempoOk: () => boolean) {
  const { data: hooks, error } = await db.from("bitrix_webhooks").select("perfil_id,bitrix_user_id,webhook")
  if (error) { console.error("fila: rode o supabase/010 (" + error.message + ")"); return { usuarias: 0, conversas: 0 } }
  const { data: perfis } = await db.from("perfis").select("id,nome,bitrix_user_id,ativo").in("id", (hooks || []).map(h => h.perfil_id))
  let usuarias = 0, conversas = 0
  for (const h of hooks || []) {
    const p = (perfis || []).find(x => x.id === h.perfil_id)
    if (!p?.ativo || !tempoOk()) continue
    try {
      conversas += await filaDaUsuaria(db, { id: p.id, nome: p.nome, bitrix_user_id: Number(h.bitrix_user_id) }, h.webhook, tempoOk)
      usuarias++
    } catch (e) {
      console.error("fila", p.nome, (e as Error).message)
      await db.from("perfis").update({ bitrix_lista_erro: (e as Error).message.slice(0, 200) }).eq("id", p.id)
    }
  }
  console.log(`fila: ${usuarias} usuária(s), ${conversas} conversa(s) na fila`)
  return { usuarias, conversas }
}
