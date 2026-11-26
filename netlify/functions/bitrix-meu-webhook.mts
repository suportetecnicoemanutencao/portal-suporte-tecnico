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
    // o nº no endereço do webhook (/rest/8937/…) é o usuário do Bitrix que criou o webhook
    const idBitrix = Number(m[1])
    const { data: perfil, error: ePerfil } = await db.from("perfis").select("bitrix_user_id").eq("id", user.id).single()
    if (ePerfil) throw new Error("Rode o supabase/009_bitrix_por_usuario.sql (" + ePerfil.message + ")")
    if (perfil?.bitrix_user_id && Number(perfil.bitrix_user_id) !== idBitrix)
      return json({ erro: `Esse webhook é do usuário ${idBitrix} no Bitrix, mas o seu cadastro no portal é o ${perfil.bitrix_user_id}. Crie o webhook logada com o seu usuário.` }, 400)
    // testa a leitura da lista de Canais Abertos (o que o portal vai usar)
    let qtd = 0
    try { qtd = ((await bitrix("im.recent.list", { ONLY_OPENLINES: "Y" }, hook)).result?.items || []).length }
    catch (e) { return json({ erro: "O Bitrix recusou o webhook. Confira o endereço e se as permissões Mensageiro (im) e Canais Abertos (imopenlines) estão marcadas. (" + (e as Error).message + ")" }, 400) }
    // nome só para a mensagem de confirmação (precisa do escopo "user"; se não tiver, segue sem)
    let eu: any = null
    try { eu = (await bitrix("user.current", {}, hook)).result } catch { /* sem escopo user */ }

    const agora = new Date().toISOString()
    const { error } = await db.from("bitrix_webhooks").upsert({ perfil_id: user.id, bitrix_user_id: idBitrix, webhook: hook, validado_em: agora }, { onConflict: "perfil_id" })
    if (error) throw new Error(/bitrix_webhooks/.test(error.message) ? "Rode o supabase/009_bitrix_por_usuario.sql no Supabase (" + error.message + ")" : error.message)
    await db.from("perfis").update({ bitrix_user_id: idBitrix, bitrix_conectado_em: agora, bitrix_lista_erro: null }).eq("id", user.id)
    return json({ ok: true, bitrix_user_id: idBitrix, nome: eu ? [eu.NAME, eu.LAST_NAME].filter(Boolean).join(" ") : `usuário ${idBitrix}`, conversas: qtd })
  } catch (e) {
    console.error("meu-webhook:", (e as Error).message)
    return json({ erro: (e as Error).message }, 502)
  }
}

export const config: Config = { path: "/api/bitrix/meu-webhook", method: "POST" }
