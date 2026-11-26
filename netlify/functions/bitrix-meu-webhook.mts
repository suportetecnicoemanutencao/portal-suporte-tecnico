import type { Config } from "@netlify/functions"
import { admin, usuarioDoRequest, json, bitrix } from "../lib/comum.mts"

/**
 * POST /api/bitrix/meu-webhook  { webhook }     → conecta a lista do Bitrix da usuária logada
 * POST /api/bitrix/meu-webhook  { remover: true } → desconecta
 * O webhook precisa ser da própria usuária (user.current) e ter o escopo im/imopenlines.
 */
export default async (req: Request) => {
  if (req.method !== "POST") return json({ erro: "Use POST" }, 405)
  try {
    const db = admin()
    const user = await usuarioDoRequest(req, db)
    if (!user || user.papel === ("financeiro" as any)) return json({ erro: "Sessão expirada. Entre novamente." }, 401)
    const corpo = await req.json().catch(() => ({}))
    if (corpo.remover) {
      await db.from("bitrix_webhooks").delete().eq("perfil_id", user.id)
      await db.from("perfis").update({ bitrix_conectado_em: null, bitrix_lista_em: null, bitrix_lista_erro: null }).eq("id", user.id)
      return json({ ok: true })
    }
    let hook = String(corpo.webhook || "").trim()
    const m = hook.match(/^https:\/\/[^/]+\.bitrix24\.[a-z.]+\/rest\/(\d+)\/[A-Za-z0-9]+\/?/)
    if (!m) return json({ erro: "Cole o endereço completo do webhook, ex.: https://nebulize.bitrix24.com.br/rest/8937/abc123xyz/" }, 400)
    hook = m[0].endsWith("/") ? m[0] : m[0] + "/"

    const eu = (await bitrix("user.current", {}, hook)).result
    const idBitrix = Number(eu?.ID)
    if (!idBitrix) return json({ erro: "O Bitrix não aceitou esse webhook." }, 400)
    const { data: perfil } = await db.from("perfis").select("bitrix_user_id").eq("id", user.id).single()
    if (perfil?.bitrix_user_id && Number(perfil.bitrix_user_id) !== idBitrix)
      return json({ erro: `Esse webhook é do usuário ${idBitrix} (${[eu.NAME, eu.LAST_NAME].filter(Boolean).join(" ")}) no Bitrix, não do seu (${perfil.bitrix_user_id}). Crie o webhook logada com o seu usuário.` }, 400)
    let qtd = 0
    try { qtd = ((await bitrix("im.recent.list", { ONLY_OPENLINES: "Y" }, hook)).result?.items || []).length }
    catch (e) { return json({ erro: "O webhook não tem permissão de Mensageiro/Canais Abertos. Marque os escopos im e imopenlines. (" + (e as Error).message + ")" }, 400) }

    const agora = new Date().toISOString()
    const { error } = await db.from("bitrix_webhooks").upsert({ perfil_id: user.id, bitrix_user_id: idBitrix, webhook: hook, validado_em: agora }, { onConflict: "perfil_id" })
    if (error) throw error
    await db.from("perfis").update({ bitrix_user_id: idBitrix, bitrix_conectado_em: agora, bitrix_lista_erro: null }).eq("id", user.id)
    return json({ ok: true, bitrix_user_id: idBitrix, nome: [eu.NAME, eu.LAST_NAME].filter(Boolean).join(" "), conversas: qtd })
  } catch (e) {
    return json({ erro: (e as Error).message }, 502)
  }
}

export const config: Config = { path: "/api/bitrix/meu-webhook", method: "POST" }
