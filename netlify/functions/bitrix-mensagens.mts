import type { Config } from "@netlify/functions"
import { admin, usuarioDoRequest, json } from "../lib/comum.mts"
import { lerConversa } from "../lib/bitrix-conversa.mts"

/** POST /api/bitrix/mensagens { sessao } → últimas mensagens da conversa, para ler sem sair do portal */
export default async (req: Request) => {
  if (req.method !== "POST") return json({ erro: "Use POST" }, 405)
  try {
    const db = admin()
    const user = await usuarioDoRequest(req, db)
    if (!user || !["supervisor", "auxiliar"].includes(user.papel)) return json({ erro: "Sessão expirada. Entre novamente." }, 401)
    const { sessao } = await req.json().catch(() => ({}))
    if (!Number(sessao)) return json({ erro: "Conversa inválida." }, 400)
    const c = await lerConversa(String(sessao))
    const mensagens = c.mensagens.filter(m => m.tipo !== "sistema").slice(-15).map(m => ({ tipo: m.tipo, nome: m.nome, data: m.data, texto: m.texto }))
    return json({ ok: true, sessao: c.sessao, cliente: c.cliente, mensagens })
  } catch (e) {
    return json({ erro: (e as Error).message }, 502)
  }
}

export const config: Config = { path: "/api/bitrix/mensagens", method: "POST" }
