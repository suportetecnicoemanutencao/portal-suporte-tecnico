import type { Config } from "@netlify/functions"
import { admin, json } from "../lib/comum.mts"

/**
 * POST /api/infraspeak/webhook?token=SEU_TOKEN
 * Recebe os avisos do Infraspeak de O.S. aberta / fechada.
 * Como o formato do payload pode variar, o evento é gravado inteiro e o portal
 * procura o nº da O.S. dos atendimentos em aberto dentro do conteúdo recebido.
 */
const FECHADA = /(clos|conclu|finish|complet|fechad|finaliz|done|resolved)/i
const ABERTA = /(creat|open|abert|new|novo|nova)/i

function achar(obj: unknown, chaves: string[]): string | null {
  if (!obj || typeof obj !== "object") return null
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (chaves.includes(k.toLowerCase()) && (typeof v === "string" || typeof v === "number")) return String(v)
  }
  for (const v of Object.values(obj as Record<string, unknown>)) {
    const r = achar(v, chaves)
    if (r) return r
  }
  return null
}

export default async (req: Request) => {
  const url = new URL(req.url)
  const esperado = Netlify.env.get("INFRASPEAK_WEBHOOK_TOKEN")
  const token = url.searchParams.get("token") || req.headers.get("x-webhook-token")
  if (!esperado || token !== esperado) return json({ erro: "token inválido" }, 401)
  if (req.method === "GET") return json({ ok: true, info: "Webhook do Portal Suporte Técnico ativo" })

  const texto = await req.text()
  let payload: unknown
  try { payload = JSON.parse(texto) } catch { payload = { raw: texto } }

  const evento = achar(payload, ["event", "event_type", "type", "action", "trigger", "status", "state"]) || ""
  const codigo = achar(payload, ["code", "work_order_code", "workorder_code", "number", "os", "reference", "work_order_id", "id"])
  const db = admin()

  // procura atendimentos com O.S. informada cujo número aparece no payload
  const { data: abertos } = await db.from("atendimentos")
    .select("id,criado_por,os_numero,cliente,status")
    .not("os_numero", "is", null)
    .not("status", "in", "(cancelado)")
    .order("id", { ascending: false })
    .limit(500)
  const alvo = (abertos || []).find(a => {
    const n = String(a.os_numero).trim()
    if (!n) return false
    if (codigo && codigo.replace(/\D/g, "") === n.replace(/\D/g, "")) return true
    return new RegExp(`(^|[^0-9])${n.replace(/[^0-9A-Za-z-]/g, "")}([^0-9]|$)`).test(texto)
  })

  await db.from("infraspeak_eventos").insert({
    evento: evento || null, os_numero: alvo?.os_numero || codigo, atendimento_id: alvo?.id || null, payload,
  })

  if (alvo) {
    const fechada = FECHADA.test(evento) ? true : ABERTA.test(evento) ? false : FECHADA.test(texto.slice(0, 2000))
    const agora = new Date().toISOString()
    const upd = fechada ? { os_status: "fechada", os_fechada_em: agora } : { os_status: "aberta", os_aberta_em: agora }
    await db.from("atendimentos").update(upd).eq("id", alvo.id)
    await db.from("atendimento_eventos").insert({
      atendimento_id: alvo.id, tipo: "infraspeak",
      descricao: `Infraspeak: O.S. ${alvo.os_numero} ${fechada ? "fechada" : "aberta/atualizada"}${evento ? " (" + evento + ")" : ""}`,
    })
    await db.from("notificacoes").insert({
      usuario_id: alvo.criado_por, atendimento_id: alvo.id, tipo: fechada ? "os_fechada" : "os_aberta",
      titulo: fechada ? `O.S. ${alvo.os_numero} fechada no Infraspeak` : `O.S. ${alvo.os_numero} confirmada no Infraspeak`,
      mensagem: fechada
        ? `${alvo.cliente || "Cliente"}: envie a finalização com o relatório, faça o pós-atendimento e oriente o técnico a enviar a nota.`
        : `${alvo.cliente || "Cliente"}: O.S. registrada. Agende o técnico e avise o cliente.`,
    })
  }
  return json({ ok: true, vinculado: !!alvo })
}

export const config: Config = { path: "/api/infraspeak/webhook", method: ["GET", "POST"] }
