import type { Config } from "@netlify/functions"
import { admin, usuarioDoRequest, json, bitrix } from "../lib/comum.mts"

/**
 * POST /api/bitrix/conversa  { numero, responsavel }
 * numero = nº da conversa do Canal Aberto (ex.: 29687), "chat24243" ou o link da conversa.
 * Coloca a conversa em "Minhas conversas" com a responsável escolhida.
 * O bitrix-monitor lê as mensagens e classifica na próxima rodada (até 1 min).
 */
export default async (req: Request) => {
  if (req.method !== "POST") return json({ erro: "Use POST" }, 405)
  try {
    const db = admin()
    const user = await usuarioDoRequest(req, db)
    if (!user) return json({ erro: "Sessão expirada. Entre novamente." }, 401)

    const { numero, responsavel } = await req.json().catch(() => ({}))
    const bruto = String(numero || "").trim()
    const chat = bruto.match(/chat\s*(\d+)/i)
    const digits = bruto.replace(/\D/g, "")
    if (!chat && !digits) return json({ erro: "Informe o nº da conversa ou o link." }, 400)
    const resp = String(responsavel || user.id)
    const { data: perfil } = await db.from("perfis").select("id,nome,ativo").eq("id", resp).maybeSingle()
    if (!perfil?.ativo) return json({ erro: "Responsável inválida." }, 400)

    const d = (await bitrix("imopenlines.dialog.get", chat ? { CHAT_ID: Number(chat[1]) } : { SESSION_ID: Number(digits) })).result
    if (!d) return json({ erro: "Conversa não encontrada no Bitrix." }, 404)
    const sessao = chat ? Number(String(d.entity_data_1 || "").split("|")[5]) || 0 : Number(digits)
    const chat_id = Number(d.id) || null
    if (!sessao || !chat_id) return json({ erro: "Não consegui identificar o nº da conversa. Use o nº que aparece no Bitrix." }, 422)

    const agora = new Date().toISOString()
    const { data: existe } = await db.from("bitrix_sessoes").select("sessao").eq("sessao", sessao).maybeSingle()
    if (!existe) await db.from("bitrix_sessoes").insert({ sessao, chat_id, nome: d.name || null, status: "ignorada" })
    const { error } = await db.from("bitrix_sessoes").update({
      chat_id, encerrada: false, operador: perfil.id, participantes: [perfil.id], responsavel_manual: perfil.id,
      responsavel_manual_em: agora, responsavel_manual_por: user.id, atualizada_em: null,
    }).eq("sessao", sessao)
    if (error) throw error
    return json({ ok: true, sessao, responsavel: perfil.nome })
  } catch (e) {
    return json({ erro: (e as Error).message }, 502)
  }
}

export const config: Config = { path: "/api/bitrix/conversa", method: "POST" }
