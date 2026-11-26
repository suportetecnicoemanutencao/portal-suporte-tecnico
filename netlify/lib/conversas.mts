import type { SupabaseClient } from "@supabase/supabase-js"
import { bitrix, portalBitrix, webhooksUsuarios } from "./comum.mts"
import { mensagensDoHistorico, type Msg } from "./bitrix-conversa.mts"

/**
 * Acompanhamento das conversas do Canal Aberto (aba "Minhas conversas").
 * Regras (pedido da Katielen):
 *  - Sem resposta: cliente esperando há mais de 4 h.
 *  - Promessa pendente: última mensagem da auxiliar é "só um momento", "vou verificar", "te retorno"… há mais de 1 h.
 *  - Nova: conversa atribuída sem nenhuma resposta da auxiliar ainda.
 *  - Pedido prometido (Monitor da Katielen): "vou gerar o pedido"… sem continuação há 30 min — urgente, repete a cada 1 h.
 *  - Retornar: cliente só respondeu "ok/obrigado" depois da resposta (se antes houve promessa/pedido, continua promessa/pedido).
 *  - Pausada: a auxiliar pausou com justificativa; sem avisos até chegar mensagem nova.
 *  - Chamado a atualizar: atendimento com O.S. em aberto e mais de 24 h sem falar com o cliente.
 * Avisos (portal + notificação no Bitrix) de segunda a sexta, 07:00–17:45; o mesmo aviso repete a cada 3 h.
 * Resumo diário às 8h.
 */
const H = 3600e3
export const PROMESSA = /(s[óo]\s+um\s+(momento|minuto|minutinho|instante)|um\s+momento|um\s+minutinho|aguarde|vou\s+(verificar|ver|checar|confirmar|consultar|conferir|olhar|analisar)|j[áa]\s+(verifico|vejo|confiro|te\s+(retorno|respondo|falo|passo))|te\s+retorno|retorno\s+(em|j[áa]|logo)|deixa\s+eu\s+(ver|verificar)|estou\s+verificando|vou\s+te\s+retornar)/i
const CORTESIA = /^\s*(ok+|okay|okk|obrigad[oa]s?|muito obrigad[oa]|grat[oa]|valeu|vlw|at[ée]\s*(breve|mais|logo)|blz|beleza|certo|perfeito|show|t[áa]\s*bom|combinado|de nada|disponha|bom dia|boa tarde|boa noite|tudo bem|👍+|🙏+|ótimo|otimo)[\s!.,]*$/i
/** Promessa de gerar pedido (urgente) — frases do Monitor Bitrix da Katielen */
export const PEDIDO = /(gerar|gero|gerando|fazer|fa[çc]o|abrir|lan[çc]ar|emitir|solicitar)\s+(o\s+|um\s+)?pedido|vou\s+pedir/i
/** Pedido de cobrança citado no chat: "precisa ser cobrado", "cobrar o cliente", "gerar boleto", "faturar"… */
export const COBRANCA = /(precis[ae]\s+(ser\s+)?cobra|ser\s+cobrad|cobrar\s+(?!o\s+t[ée]cnico|a\s+t[ée]cnica|t[ée]cnico)(o|a|do|da|esse|essa|este|esta|cliente|loja|visita|pe[çc]a|servi[çc]o|valor)|cobran[çc]a|gerar\s+(o\s+)?boleto|emitir\s+(o\s+)?boleto|enviar\s+(o\s+)?boleto|faturar|faturamento|pagamento\s+pendente|em\s+aberto\s+para\s+pagamento|n[ãa]o\s+foi\s+pago|deve\s+ser\s+cobrad)/i
const FECHOU = /(encerrou|finalizou|fechou)\s+a\s+(sess[ãa]o|conversa)|(sess[ãa]o|conversa)\s+(foi\s+)?(encerrada|finalizada|fechada)/i
const FINAIS = ["finalizado", "resolvido_chat", "cancelado"]

export const ROTULO: Record<string, string> = {
  pedido: "Pedido prometido", retornar: "Retornar ao cliente",
  sem_resposta: "Sem resposta há mais de 4 h", promessa: "Promessa pendente", nova: "Nova conversa",
  chamado: "Chamado sem atualização há 24 h", responder: "Cliente aguardando", em_dia: "Em dia",
}

/** Hora de Brasília (UTC-3, sem horário de verão). */
function brasilia(d = new Date()) {
  const b = new Date(d.getTime() - 3 * H)
  return { dia: b.getUTCDay(), min: b.getUTCHours() * 60 + b.getUTCMinutes(), data: b.toISOString().slice(0, 10) }
}
export const expediente = () => { const b = brasilia(); return b.dia >= 1 && b.dia <= 5 && b.min >= 7 * 60 && b.min <= 17 * 60 + 45 }

type Perfil = { id: string; nome: string; bitrix_user_id: number | null }

export function analisar(msgs: Msg[], agora = Date.now()) {
  const conversa = msgs.filter(m => m.tipo === "cliente" || m.tipo === "operador")
  const encerrada = msgs.some(m => m.tipo === "sistema" && FECHOU.test(m.texto))
  const ult = conversa.at(-1)
  const ultOp = [...conversa].reverse().find(m => m.tipo === "operador")
  let clienteDesde: string | null = null
  if (ult?.tipo === "cliente") {
    const idx = ultOp ? conversa.indexOf(ultOp) + 1 : 0
    clienteDesde = conversa.slice(idx).find(m => m.tipo === "cliente")?.data || ult.data
  }
  // cliente só agradeceu / despediu-se depois da resposta da auxiliar
  const cortesia = ult?.tipo === "cliente" && !!ultOp && conversa.slice(conversa.indexOf(ultOp) + 1).every(m => CORTESIA.test(m.texto))
  // promessa/pedido vale na última mensagem da auxiliar, ou na anterior ao "ok" do cliente
  const ref = ult?.tipo === "operador" ? ult : cortesia ? ultOp : undefined
  const pedido = !!ref && PEDIDO.test(ref.texto)
  const promessa = !!ref && !pedido && PROMESSA.test(ref.texto) && ref.texto.length < 220
  // última mensagem (não-bot) que fala em cobrança
  const cob = [...msgs].reverse().find(m => m.tipo !== "bot" && m.texto && COBRANCA.test(m.texto) && !/PowerZap/i.test(m.texto))
  return {
    cortesia,
    cobranca_msg_id: cob?.id ?? null,
    cobranca_texto: cob ? `${cob.tipo === "cliente" ? "Cliente" : cob.nome.split(" ")[0]}: ${cob.texto}`.slice(0, 280) : null,
    cobranca_em: cob?.data ?? null,
    encerrada,
    ultimo_msg_id: ult?.id ?? null,
    ultima_msg_em: ult?.data ?? null,
    ultima_msg_de: ult ? (ult.tipo === "cliente" ? "cliente" : "operador") : null,
    ultimo_texto: ult ? `${ult.tipo === "cliente" ? "" : ult.nome.split(" ")[0] + ": "}${ult.texto}`.slice(0, 280) : null,
    cliente_desde: clienteDesde,
    operador_respondeu: !!ultOp,
    ultima_resposta_em: ultOp?.data ?? null,
    promessa,
    pedido,
    promessa_em: ref && (pedido || promessa) ? ref.data : null,
    promessa_texto: ref && (pedido || promessa) ? ref.texto.slice(0, 120) : null,
  }
}

export function situacao(a: ReturnType<typeof analisar>, temChamado: boolean, agora = Date.now(), atualizadoEm: string | null = null) {
  if (a.encerrada) return null
  const desdePromessa = a.promessa_em ? agora - Date.parse(a.promessa_em) : 0
  if (a.pedido && desdePromessa > 0.5 * H) return "pedido"
  if (a.cortesia) return a.promessa && desdePromessa > 1 * H ? "promessa" : a.pedido || a.promessa ? "em_dia" : "retornar"
  const desde = a.cliente_desde ? agora - Date.parse(a.cliente_desde) : 0
  if (a.ultima_msg_de === "cliente" && desde > 4 * H) return "sem_resposta"
  if (!a.operador_respondeu) return "nova"
  if (a.promessa && desdePromessa > 1 * H) return "promessa"
  // última atualização ao cliente: última resposta no chat ou "✓ Atualizei o cliente" no portal
  const atualizou = Math.max(a.ultima_resposta_em ? Date.parse(a.ultima_resposta_em) : 0, atualizadoEm ? Date.parse(atualizadoEm) : 0)
  if (temChamado && atualizou && agora - atualizou > 24 * H) return "chamado"
  if (a.ultima_msg_de === "cliente") return "responder"
  return "em_dia"
}

/** Lista de conversas do Canal Aberto que a usuária vê no Bitrix (webhook dela), mais recentes primeiro. */
async function recentesDa(webhook: string, paginas = 5) {
  let itens: any[] = [], ultima: string | null = null
  for (let i = 0; i < paginas; i++) {
    const r = await bitrix("im.recent.list", { ONLY_OPENLINES: "Y", ...(ultima ? { LAST_MESSAGE_DATE: ultima } : {}) }, webhook)
    const pag = r.result?.items || []
    itens = itens.concat(pag)
    const d = pag.at(-1)?.message?.date
    if (!r.result?.hasMore || !pag.length || !d || d === ultima) break
    ultima = d
  }
  return itens
}

async function batch(cmd: Record<string, string>) {
  const r = await bitrix("batch", { halt: 0, cmd })
  return (r.result?.result || {}) as Record<string, any>
}

async function avisar(db: SupabaseClient, p: Perfil, titulo: string, mensagem: string, link: string | null, atendimento_id: number | null, tipo: string) {
  await db.from("notificacoes").insert({ usuario_id: p.id, atendimento_id, tipo, titulo, mensagem })
  if (p.bitrix_user_id) {
    const portal = Netlify.env.get("URL") || "https://portal-suporte-tecnico.netlify.app"
    const txt = `[B]${titulo}[/B]\n${mensagem}` + (link ? `\n[URL=${link}]Abrir conversa[/URL]` : "") + ` · [URL=${portal}/#conversas]Minhas conversas[/URL]`
    try { await bitrix("im.notify.system.add", { USER_ID: p.bitrix_user_id, MESSAGE: txt }) } catch (e) { console.error("notify", (e as Error).message) }
  }
}

export async function acompanharConversas(db: SupabaseClient, tempoOk: () => boolean) {
  const { data: perfis } = await db.from("perfis").select("id,nome,bitrix_user_id").eq("ativo", true)
  const porBitrix = new Map((perfis || []).filter(p => p.bitrix_user_id).map(p => [Number(p.bitrix_user_id), p as Perfil]))
  const porId = new Map((perfis || []).map(p => [p.id, p as Perfil]))
  if (!porBitrix.size) return { conversas: 0, avisos: 0 }

  // 0) conversas que aparecem na lista de cada usuária no Bitrix (webhook dela): responsável, gerente
  //    da conversa ou ainda na fila — pega também sessões antigas e conversas do "Atendente virtual"
  const participa = new Map<number, Set<string>>()   // sessão -> perfis que veem a conversa
  const naFila = new Set<number>()
  // webhooks: os conectados no portal ("Conectar meu Bitrix") + a variável BITRIX_WEBHOOKS_USUARIOS
  const hooks: Record<number, string> = { ...webhooksUsuarios() }
  const { data: conectados } = await db.from("bitrix_webhooks").select("bitrix_user_id,webhook")
  for (const w of conectados || []) hooks[Number(w.bitrix_user_id)] = w.webhook
  for (const [uid, hook] of Object.entries(hooks)) {
    const p = porBitrix.get(Number(uid)); if (!p || !tempoOk()) continue
    try {
      const novos: Record<string, unknown>[] = []
      for (const it of await recentesDa(hook)) {
        const ch = it.chat || {}
        const sessao = Number(it.lines?.id) || Number(String(ch.entity_data_1 || "").split("|")[5]) || 0
        const chat = Number(ch.id) || Number(String(it.id || "").replace(/\D/g, ""))
        if (!sessao || !chat || Number(it.lines?.status) >= 60) continue        // sem sessão ou já encerrada
        const gerentes = (ch.manager_list || []).map(Number)
        const fila = Number(it.lines?.status) < 10
        if (!(fila || Number(ch.owner) === Number(uid) || gerentes.includes(Number(uid)) || !gerentes.length)) continue
        participa.set(sessao, (participa.get(sessao) || new Set<string>()).add(p.id))
        if (fila) naFila.add(sessao)
        novos.push({ sessao, chat_id: chat, nome: ch.name || it.title || null, status: "ignorada" })
      }
      if (novos.length) await db.from("bitrix_sessoes").upsert(novos, { onConflict: "sessao", ignoreDuplicates: true })
      await db.from("perfis").update({ bitrix_lista_em: new Date().toISOString(), bitrix_lista_erro: null }).eq("id", p.id)
    } catch (e) {
      console.error("lista do Bitrix", uid, (e as Error).message)
      await db.from("perfis").update({ bitrix_lista_erro: (e as Error).message.slice(0, 200) }).eq("id", p.id)
    }
  }

  // conversas ainda abertas (últimos 30 dias), as menos atualizadas primeiro
  const desde = new Date(Date.now() - 30 * 24 * H).toISOString()
  const { data: abertas } = await db.from("bitrix_sessoes").select("*").eq("encerrada", false).gte("descoberta_em", desde)
    .order("atualizada_em", { ascending: true, nullsFirst: true }).limit(90)
  const { data: vistas } = participa.size
    ? await db.from("bitrix_sessoes").select("*").in("sessao", [...participa.keys()])
    : { data: [] as any[] }
  // conversas com responsável escolhida no portal (ou adicionadas pelo nº) entram sempre
  const { data: manuais } = await db.from("bitrix_sessoes").select("*").eq("encerrada", false).not("responsavel_manual", "is", null).limit(200)
  const jaTem = new Set<number>()
  const lista = [...(manuais || []), ...(vistas || []), ...(abertas || [])].filter(s => s.chat_id && !jaTem.has(s.sessao) && jaTem.add(s.sessao))
  if (!lista.length) return { conversas: 0, avisos: 0 }

  // 1) quem é o operador agora
  const donos: Record<number, number> = {}
  for (let i = 0; i < lista.length && tempoOk(); i += 45) {
    const cmd: Record<string, string> = {}
    for (const s of lista.slice(i, i + 45)) cmd["s" + s.sessao] = `imopenlines.dialog.get?SESSION_ID=${s.sessao}`
    const ok = await batch(cmd)
    for (const [k, d] of Object.entries(ok)) donos[Number(k.slice(1))] = Number(d.owner) || 0
  }
  const manual = (s: any) => s.responsavel_manual && porId.has(s.responsavel_manual)
  const daEquipe = lista.filter(s => manual(s) || porBitrix.has(donos[s.sessao]) || participa.has(s.sessao))
  const agoraIso = new Date().toISOString()
  // conversas de fora da equipe: só registra o dono
  const fora = lista.filter(s => s.sessao in donos && !porBitrix.has(donos[s.sessao]) && !participa.has(s.sessao) && !manual(s))
  const porDono = new Map<number, number[]>()
  for (const s of fora) { const d = donos[s.sessao] || 0; porDono.set(d, [...(porDono.get(d) || []), s.sessao]) }
  for (const [d, ids] of porDono)
    await db.from("bitrix_sessoes").update({ owner_bitrix_id: d || null, operador: null, situacao: null, atualizada_em: agoraIso }).in("sessao", ids)

  // atendimentos com O.S. em aberto
  const { data: chamados } = await db.from("atendimentos").select("id,bitrix_sessao,os_numero,status,os_status")
    .in("bitrix_sessao", daEquipe.map(s => s.sessao).length ? daEquipe.map(s => s.sessao) : [0])
  const atPorSessao = new Map((chamados || []).filter(a => !FINAIS.includes(a.status)).map(a => [Number(a.bitrix_sessao), a]))
  // "✓ Atualizei o cliente" marcado no portal (O.S. em aberto)
  const idsAt = [...atPorSessao.values()].map(a => a.id)
  const { data: atualizacoes } = idsAt.length
    ? await db.from("atendimento_eventos").select("atendimento_id,created_at").eq("tipo", "cliente_atualizado").in("atendimento_id", idsAt).order("created_at", { ascending: false })
    : { data: [] as any[] }
  const atualizadoEm = new Map<number, string>()
  for (const ev of atualizacoes || []) if (!atualizadoEm.has(ev.atendimento_id)) atualizadoEm.set(ev.atendimento_id, ev.created_at)

  // 2) mensagens e situação
  let avisos = 0
  const podeAvisar = expediente()
  for (let i = 0; i < daEquipe.length && tempoOk(); i += 45) {
    const lote = daEquipe.slice(i, i + 45)
    const cmd: Record<string, string> = {}
    for (const s of lote) cmd["s" + s.sessao] = `imopenlines.session.history.get?CHAT_ID=${s.chat_id}&SESSION_ID=${s.sessao}`
    const ok = await batch(cmd)
    for (const s of lote) {
      const r = ok["s" + s.sessao]
      if (!r) continue
      const msgs = mensagensDoHistorico(r)
      const users = r.users || {}
      const cliente = Object.values(users).find((u: any) => u.connector || u.externalAuthId === "imconnector") as any
      const a = analisar(msgs)
      const at = atPorSessao.get(Number(s.sessao))
      const osAberta = !!at?.os_numero && at.os_status !== "fechada"
      let sit = situacao(a, osAberta, Date.now(), at ? atualizadoEm.get(at.id) ?? null : null)
      if (sit && s.resolvido_msg_id && a.ultimo_msg_id && s.resolvido_msg_id >= a.ultimo_msg_id) sit = "em_dia"
      // responsável: o dono no Bitrix (se for da equipe) ou quem tem a conversa na lista
      const vistoPor = [...(participa.get(s.sessao) || [])]
      // ordem: escolhida no portal > dona no Bitrix > quem tem a conversa na lista
      const perfil = (manual(s) ? porId.get(s.responsavel_manual) : null) || porBitrix.get(donos[s.sessao]) || porId.get(vistoPor[0])!
      // escolhida no portal: a conversa fica só com ela
      const participantes = manual(s) ? [perfil.id] : [...new Set([perfil.id, ...vistoPor])]
      // cobrança pendente: há pedido de cobrança e ele é mais novo que o último "Cobrança feita"
      const cobrancaAuto = !!a.cobranca_msg_id && !(s.cobranca_feita_msg_id && s.cobranca_feita_msg_id >= a.cobranca_msg_id)
      const cobranca = cobrancaAuto || !!s.cobranca_manual
      // pausada pela auxiliar: segue pausada até chegar mensagem mais nova que a do momento da pausa
      const pausada = !!s.pausado_em && (Number(a.ultimo_msg_id) || 0) <= (Number(s.pausado_msg_id) || 0)
      const alertas = { ...(s.alertas || {}) }
      // aviso (repete a cada 3 h; "pedido" a cada 1 h; "nova" só uma vez) — nada é avisado enquanto pausada
      if (podeAvisar && !pausada && cobrancaAuto && alertas.cobranca_msg !== a.cobranca_msg_id) {
        const nome = cliente?.name || s.cliente || s.nome || "Cliente"
        await avisar(db, perfil, `Cobrança a fazer · conversa nº ${s.sessao}`, `${nome}: ${(a.cobranca_texto || "").slice(0, 120)}`, `${portalBitrix()}/online/?IM_DIALOG=chat${s.chat_id}`, at?.id ?? null, "conversa_cobranca")
        alertas.cobranca_msg = a.cobranca_msg_id; avisos++
      }
      if (podeAvisar && !pausada && sit && ["pedido", "sem_resposta", "promessa", "chamado", "nova"].includes(sit)) {
        const ultimo = alertas[sit] ? Date.parse(alertas[sit]) : 0
        const intervalo = sit === "nova" ? Infinity : sit === "pedido" ? 1 * H : 3 * H
        if (!ultimo || Date.now() - ultimo > intervalo) {
          const nome = cliente?.name || s.cliente || s.nome || "Cliente"
          const espera = a.cliente_desde ? Math.round((Date.now() - Date.parse(a.cliente_desde)) / H) : null
          const fala = (a.promessa_texto || a.ultimo_texto || "").replace(/^[^:]+:\s*/, "").slice(0, 60)
          const msg = sit === "pedido" ? `URGENTE: você disse "${fala}" para ${nome} e ainda não continuou.`
            : sit === "sem_resposta" ? `${nome} está esperando resposta há ${espera} h.`
            : sit === "promessa" ? `Você disse "${fala}" para ${nome} e ainda não retornou.`
            : sit === "chamado" ? `O.S. ${at?.os_numero} de ${nome}: mais de 24 h sem atualizar o cliente.`
            : `${nome} iniciou uma conversa (nº ${s.sessao}).`
          await avisar(db, perfil, `${ROTULO[sit]} · conversa nº ${s.sessao}`, msg, `${portalBitrix()}/online/?IM_DIALOG=chat${s.chat_id}`, at?.id ?? null, "conversa_" + sit)
          alertas[sit] = agoraIso; avisos++
        }
      }
      await db.from("bitrix_sessoes").update({
        owner_bitrix_id: donos[s.sessao] || null, operador: perfil.id, participantes, na_fila: naFila.has(s.sessao), cliente: cliente?.name || s.cliente,
        encerrada: a.encerrada, ultimo_msg_id: a.ultimo_msg_id, ultima_msg_em: a.ultima_msg_em, ultima_msg_de: a.ultima_msg_de,
        ultimo_texto: a.ultimo_texto, cliente_desde: a.cliente_desde, operador_respondeu: a.operador_respondeu,
        ultima_resposta_em: a.ultima_resposta_em, promessa: a.promessa, situacao: sit, alertas, atualizada_em: agoraIso,
        cobranca, cobranca_msg_id: a.cobranca_msg_id, cobranca_texto: a.cobranca_texto, cobranca_em: a.cobranca_em,
        ...(at ? { atendimento_id: at.id } : {}),
        // chegou mensagem nova: a conversa sai da pausa
        ...(s.pausado_em && !pausada ? { pausado_em: null, pausado_motivo: null, pausado_msg_id: null, pausado_por: null } : {}),
      }).eq("sessao", s.sessao)
    }
  }

  // 3) resumo diário às 8h (seg–sex)
  const b = brasilia()
  if (b.dia >= 1 && b.dia <= 5 && b.min >= 8 * 60 && b.min < 9 * 60) {
    const chave = "resumo_" + b.data
    const { data: feito } = await db.from("config_portal").select("chave").eq("chave", chave).maybeSingle()
    if (!feito) {
      await db.from("config_portal").insert({ chave, valor: true })
      const { data: todas } = await db.from("bitrix_sessoes").select("operador,situacao,cobranca").eq("encerrada", false).not("operador", "is", null)
      for (const p of porBitrix.values()) {
        const minhas = (todas || []).filter(x => x.operador === p.id)
        const c = (k: string) => minhas.filter(x => x.situacao === k).length
        if (!minhas.length) continue
        await avisar(db, p, `Bom dia, ${p.nome.split(" ")[0]}! Resumo das conversas`,
          `Pedidos prometidos: ${c("pedido")} · Sem resposta: ${c("sem_resposta")} · Promessas pendentes: ${c("promessa")} · Cobranças: ${minhas.filter(x => x.cobranca).length} · Novas: ${c("nova")} · Chamados a atualizar: ${c("chamado")} · Retornar: ${c("retornar")} · Cliente aguardando: ${c("responder")}`,
          null, null, "resumo_diario")
        avisos++
      }
    }
  }
  return { conversas: daEquipe.length, avisos }
}
