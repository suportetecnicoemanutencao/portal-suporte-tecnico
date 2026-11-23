import type { SupabaseClient } from "@supabase/supabase-js"
import { bitrix, portalBitrix } from "./comum.mts"
import { mensagensDoHistorico, type Msg } from "./bitrix-conversa.mts"

/**
 * Acompanhamento das conversas do Canal Aberto (aba "Minhas conversas").
 * Regras (pedido da Katielen):
 *  - Sem resposta: cliente esperando há mais de 4 h.
 *  - Promessa pendente: última mensagem da auxiliar é "só um momento", "vou verificar", "te retorno"… há mais de 1 h.
 *  - Nova: conversa atribuída sem nenhuma resposta da auxiliar ainda.
 *  - Chamado a atualizar: atendimento com O.S. em aberto e mais de 24 h sem falar com o cliente.
 * Avisos (portal + notificação no Bitrix) de segunda a sexta, 07:00–17:45; o mesmo aviso repete a cada 3 h.
 * Resumo diário às 8h.
 */
const H = 3600e3
export const PROMESSA = /(s[óo]\s+um\s+(momento|minuto|minutinho|instante)|um\s+momento|um\s+minutinho|aguarde|vou\s+(verificar|ver|checar|confirmar|consultar|conferir|olhar|analisar)|j[áa]\s+(verifico|vejo|confiro|te\s+(retorno|respondo|falo|passo))|te\s+retorno|retorno\s+(em|j[áa]|logo)|deixa\s+eu\s+(ver|verificar)|estou\s+verificando|vou\s+te\s+retornar)/i
const CORTESIA = /^\s*(ok+|okay|okk|obrigad[oa]s?|muito obrigad[oa]|grat[oa]|valeu|vlw|at[ée]\s*(breve|mais|logo)|blz|beleza|certo|perfeito|show|t[áa]\s*bom|combinado|de nada|disponha|bom dia|boa tarde|boa noite|tudo bem|👍+|🙏+|ótimo|otimo)[\s!.,]*$/i
const FECHOU = /(encerrou|finalizou|fechou)\s+a\s+(sess[ãa]o|conversa)|(sess[ãa]o|conversa)\s+(foi\s+)?(encerrada|finalizada|fechada)/i
const FINAIS = ["finalizado", "resolvido_chat", "cancelado"]

export const ROTULO: Record<string, string> = {
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
  const promessa = ult?.tipo === "operador" && PROMESSA.test(ult.texto) && ult.texto.length < 220
  // cliente só agradeceu / despediu-se depois da resposta da auxiliar: não precisa de retorno
  const cortesia = ult?.tipo === "cliente" && !!ultOp && conversa.slice(conversa.indexOf(ultOp) + 1).every(m => CORTESIA.test(m.texto))
  return {
    cortesia,
    encerrada,
    ultimo_msg_id: ult?.id ?? null,
    ultima_msg_em: ult?.data ?? null,
    ultima_msg_de: ult ? (ult.tipo === "cliente" ? "cliente" : "operador") : null,
    ultimo_texto: ult ? `${ult.tipo === "cliente" ? "" : ult.nome.split(" ")[0] + ": "}${ult.texto}`.slice(0, 280) : null,
    cliente_desde: clienteDesde,
    operador_respondeu: !!ultOp,
    ultima_resposta_em: ultOp?.data ?? null,
    promessa,
  }
}

export function situacao(a: ReturnType<typeof analisar>, temChamado: boolean, agora = Date.now()) {
  if (a.encerrada) return null
  if (a.cortesia) return "em_dia"
  const desde = a.cliente_desde ? agora - Date.parse(a.cliente_desde) : 0
  if (a.ultima_msg_de === "cliente" && desde > 4 * H) return "sem_resposta"
  if (!a.operador_respondeu) return "nova"
  if (a.promessa && a.ultima_msg_em && agora - Date.parse(a.ultima_msg_em) > 1 * H) return "promessa"
  if (temChamado && a.ultima_resposta_em && agora - Date.parse(a.ultima_resposta_em) > 24 * H) return "chamado"
  if (a.ultima_msg_de === "cliente") return "responder"
  return "em_dia"
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
  if (!porBitrix.size) return { conversas: 0, avisos: 0 }

  // conversas ainda abertas (últimos 30 dias), as menos atualizadas primeiro
  const desde = new Date(Date.now() - 30 * 24 * H).toISOString()
  const { data: abertas } = await db.from("bitrix_sessoes").select("*").eq("encerrada", false).gte("descoberta_em", desde)
    .order("atualizada_em", { ascending: true, nullsFirst: true }).limit(90)
  const lista = (abertas || []).filter(s => s.chat_id)
  if (!lista.length) return { conversas: 0, avisos: 0 }

  // 1) quem é o operador agora
  const donos: Record<number, number> = {}
  for (let i = 0; i < lista.length && tempoOk(); i += 45) {
    const cmd: Record<string, string> = {}
    for (const s of lista.slice(i, i + 45)) cmd["s" + s.sessao] = `imopenlines.dialog.get?SESSION_ID=${s.sessao}`
    const ok = await batch(cmd)
    for (const [k, d] of Object.entries(ok)) donos[Number(k.slice(1))] = Number(d.owner) || 0
  }
  const daEquipe = lista.filter(s => porBitrix.has(donos[s.sessao]))
  const agoraIso = new Date().toISOString()
  // conversas de fora da equipe: só registra o dono
  const fora = lista.filter(s => s.sessao in donos && !porBitrix.has(donos[s.sessao]))
  const porDono = new Map<number, number[]>()
  for (const s of fora) { const d = donos[s.sessao] || 0; porDono.set(d, [...(porDono.get(d) || []), s.sessao]) }
  for (const [d, ids] of porDono)
    await db.from("bitrix_sessoes").update({ owner_bitrix_id: d || null, operador: null, situacao: null, atualizada_em: agoraIso }).in("sessao", ids)

  // atendimentos com O.S. em aberto
  const { data: chamados } = await db.from("atendimentos").select("id,bitrix_sessao,os_numero,status")
    .in("bitrix_sessao", daEquipe.map(s => s.sessao).length ? daEquipe.map(s => s.sessao) : [0])
  const atPorSessao = new Map((chamados || []).filter(a => !FINAIS.includes(a.status)).map(a => [Number(a.bitrix_sessao), a]))

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
      let sit = situacao(a, !!at?.os_numero)
      if (sit && s.resolvido_msg_id && a.ultimo_msg_id && s.resolvido_msg_id >= a.ultimo_msg_id) sit = "em_dia"
      const perfil = porBitrix.get(donos[s.sessao])!
      const alertas = { ...(s.alertas || {}) }
      // aviso (repete a cada 3 h; "nova" só uma vez)
      if (podeAvisar && sit && ["sem_resposta", "promessa", "chamado", "nova"].includes(sit)) {
        const ultimo = alertas[sit] ? Date.parse(alertas[sit]) : 0
        const intervalo = sit === "nova" ? Infinity : 3 * H
        if (!ultimo || Date.now() - ultimo > intervalo) {
          const nome = cliente?.name || s.cliente || s.nome || "Cliente"
          const espera = a.cliente_desde ? Math.round((Date.now() - Date.parse(a.cliente_desde)) / H) : null
          const msg = sit === "sem_resposta" ? `${nome} está esperando resposta há ${espera} h.`
            : sit === "promessa" ? `Você disse "${(a.ultimo_texto || "").replace(/^[^:]+:\s*/, "").slice(0, 60)}" para ${nome} e ainda não retornou.`
            : sit === "chamado" ? `O.S. ${at?.os_numero} de ${nome}: mais de 24 h sem atualizar o cliente.`
            : `${nome} iniciou uma conversa (nº ${s.sessao}).`
          await avisar(db, perfil, `${ROTULO[sit]} · conversa nº ${s.sessao}`, msg, `${portalBitrix()}/online/?IM_DIALOG=chat${s.chat_id}`, at?.id ?? null, "conversa_" + sit)
          alertas[sit] = agoraIso; avisos++
        }
      }
      await db.from("bitrix_sessoes").update({
        owner_bitrix_id: donos[s.sessao], operador: perfil.id, cliente: cliente?.name || s.cliente,
        encerrada: a.encerrada, ultimo_msg_id: a.ultimo_msg_id, ultima_msg_em: a.ultima_msg_em, ultima_msg_de: a.ultima_msg_de,
        ultimo_texto: a.ultimo_texto, cliente_desde: a.cliente_desde, operador_respondeu: a.operador_respondeu,
        ultima_resposta_em: a.ultima_resposta_em, promessa: a.promessa, situacao: sit, alertas, atualizada_em: agoraIso,
        ...(at ? { atendimento_id: at.id } : {}),
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
      const { data: todas } = await db.from("bitrix_sessoes").select("operador,situacao").eq("encerrada", false).not("operador", "is", null)
      for (const p of porBitrix.values()) {
        const minhas = (todas || []).filter(x => x.operador === p.id)
        const c = (k: string) => minhas.filter(x => x.situacao === k).length
        if (!minhas.length) continue
        await avisar(db, p, `Bom dia, ${p.nome.split(" ")[0]}! Resumo das conversas`,
          `Sem resposta: ${c("sem_resposta")} · Promessas pendentes: ${c("promessa")} · Novas: ${c("nova")} · Chamados a atualizar: ${c("chamado")} · Cliente aguardando: ${c("responder")}`,
          null, null, "resumo_diario")
        avisos++
      }
    }
  }
  return { conversas: daEquipe.length, avisos }
}
