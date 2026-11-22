import type { Config } from "@netlify/functions"
import { admin, bitrix } from "../lib/comum.mts"

/**
 * Roda de segunda a sábado às 8h e às 16h (horário de Brasília = UTC-3 → 11h e 19h UTC).
 * - Lembra cada auxiliar dos atendimentos ainda abertos.
 * - Avisa auxiliar e supervisor sobre atendimentos parados há mais de 3 dias.
 * - Marca conversas encerradas no Bitrix e avisa quem ainda não finalizou no portal.
 */
const FINAIS = "(finalizado,resolvido_chat,cancelado)"
const DIA = 24 * 60 * 60 * 1000

export default async () => {
  const db = admin()
  const agora = Date.now()
  const { data: abertos, error } = await db.from("atendimentos")
    .select("id,criado_por,cliente,status,ultima_atividade,bitrix_sessao,bitrix_encerrada,created_at")
    .not("status", "in", FINAIS)
  if (error) { console.error(error); return }
  const { data: sups } = await db.from("perfis").select("id").eq("papel", "supervisor").eq("ativo", true)

  // não repetir o mesmo aviso no mesmo dia
  const desde = new Date(agora - 20 * 60 * 60 * 1000).toISOString()
  const { data: recentes } = await db.from("notificacoes").select("usuario_id,atendimento_id,tipo").gte("created_at", desde)
  const ja = new Set((recentes || []).map(n => `${n.usuario_id}|${n.atendimento_id ?? ""}|${n.tipo}`))
  const novas: Record<string, unknown>[] = []
  const add = (n: { usuario_id: string; atendimento_id?: number | null; tipo: string; titulo: string; mensagem: string }) => {
    const k = `${n.usuario_id}|${n.atendimento_id ?? ""}|${n.tipo}`
    if (!ja.has(k)) { ja.add(k); novas.push(n) }
  }

  // 1) conversas encerradas no Bitrix
  const comSessao = (abertos || []).filter(a => a.bitrix_sessao && !a.bitrix_encerrada)
  for (let i = 0; i < comSessao.length; i += 50) {
    const lote = comSessao.slice(i, i + 50)
    try {
      const r = await bitrix("crm.activity.list", {
        filter: { PROVIDER_ID: "IMOPENLINES_SESSION", ASSOCIATED_ENTITY_ID: lote.map(a => a.bitrix_sessao), COMPLETED: "Y" },
        select: ["ASSOCIATED_ENTITY_ID"],
      })
      const fechadas = new Set((r.result || []).map((x: { ASSOCIATED_ENTITY_ID: string }) => Number(x.ASSOCIATED_ENTITY_ID)))
      for (const a of lote.filter(a => fechadas.has(Number(a.bitrix_sessao)))) {
        await db.from("atendimentos").update({ bitrix_encerrada: true }).eq("id", a.id)
        a.bitrix_encerrada = true
        add({ usuario_id: a.criado_por, atendimento_id: a.id, tipo: "bitrix_encerrada",
          titulo: `Conversa encerrada no Bitrix · #${a.id}`,
          mensagem: `${a.cliente || "Cliente"}: a conversa foi encerrada no Bitrix, mas o atendimento continua aberto no portal. Finalize ou atualize o status.` })
      }
    } catch (e) { console.error("Bitrix:", (e as Error).message) }
  }

  // 2) parados há mais de 3 dias
  const porUsuario = new Map<string, number>()
  for (const a of abertos || []) {
    porUsuario.set(a.criado_por, (porUsuario.get(a.criado_por) || 0) + 1)
    const parado = Math.floor((agora - new Date(a.ultima_atividade).getTime()) / DIA)
    if (parado >= 3) {
      const msg = `${a.cliente || "Cliente"} está sem atualização há ${parado} dias (status: ${a.status.replace(/_/g, " ")}). Cobre o técnico, atualize o cliente ou finalize.`
      add({ usuario_id: a.criado_por, atendimento_id: a.id, tipo: "parado", titulo: `Atendimento #${a.id} parado há ${parado} dias`, mensagem: msg })
      for (const s of sups || []) if (s.id !== a.criado_por)
        add({ usuario_id: s.id, atendimento_id: a.id, tipo: "parado_sup", titulo: `#${a.id} parado há ${parado} dias`, mensagem: msg })
    }
  }

  // 3) resumo de abertos por auxiliar
  for (const [uid, qtd] of porUsuario)
    add({ usuario_id: uid, atendimento_id: null, tipo: "resumo_abertos",
      titulo: `Você tem ${qtd} atendimento${qtd > 1 ? "s" : ""} em aberto`,
      mensagem: "Revise a lista e finalize os que já foram concluídos." })

  if (novas.length) await db.from("notificacoes").insert(novas)
  console.log(`lembretes: ${novas.length} notificações`)
}

export const config: Config = { schedule: "0 11,19 * * 1-6" }
