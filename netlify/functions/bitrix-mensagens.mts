import type { Config } from "@netlify/functions"
import { admin, usuarioDoRequest, json, bitrix } from "../lib/comum.mts"

/**
 * POST /api/bitrix/mensagens { dialog, perfil } → últimas mensagens da conversa, para ler sem sair do portal.
 * Usa o webhook da dona da fila (perfil), igual ao Monitor (im.dialog.messages.get).
 */
export default async (req: Request) => {
  if (req.method !== "POST") return json({ erro: "Use POST" }, 405)
  try {
    const db = admin()
    const user = await usuarioDoRequest(req, db)
    if (!user || !["supervisor", "auxiliar"].includes(user.papel)) return json({ erro: "Sessão expirada. Entre novamente." }, 401)
    const { dialog, perfil } = await req.json().catch(() => ({}))
    const d = String(dialog || "").match(/^chat\d+$/) ? String(dialog) : ""
    if (!d) return json({ erro: "Conversa inválida." }, 400)
    const dono = perfil && user.papel === "supervisor" ? String(perfil) : (perfil || user.id)
    const { data: h } = await db.from("bitrix_webhooks").select("bitrix_user_id,webhook").eq("perfil_id", dono).maybeSingle()
    const hook = h?.webhook || undefined   // sem webhook da usuária, tenta com o webhook geral do portal
    const r = (await bitrix("im.dialog.messages.get", { DIALOG_ID: d, LIMIT: 20 }, hook)).result || {}
    const users = new Map((r.users || []).map((u: any) => [Number(u.id), u]))
    const eu = Number(h?.bitrix_user_id || 0)
    const mensagens = (r.messages || [])
      .filter((m: any) => Number(m.author_id) !== 0)
      .sort((a: any, b: any) => Date.parse(a.date) - Date.parse(b.date))
      .map((m: any) => {
        const u: any = users.get(Number(m.author_id)) || {}
        const tipo = Number(m.author_id) === eu ? "operador" : u.bot ? "bot" : (u.type === "employee" || (u.departments || []).length) ? "empresa" : "cliente"
        const texto = String(m.text || "").replace(/\[(\/?)[A-Za-z]+[^\]]*\]/g, "").trim() || (m.params?.FILE_ID ? "(arquivo, áudio ou imagem)" : "")
        return { tipo, nome: tipo === "bot" ? "Atendente virtual" : u.name || (tipo === "cliente" ? "Cliente" : ""), data: m.date, texto }
      })
    return json({ ok: true, mensagens })
  } catch (e) {
    return json({ erro: (e as Error).message }, 502)
  }
}

export const config: Config = { path: "/api/bitrix/mensagens", method: "POST" }
