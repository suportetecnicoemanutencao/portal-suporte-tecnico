import { createClient, type SupabaseClient } from "@supabase/supabase-js"

export function admin(): SupabaseClient {
  const url = Netlify.env.get("SUPABASE_URL")
  const key = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configurados")
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

/** Valida o token do usuário logado e devolve id + papel. */
export async function usuarioDoRequest(req: Request, db: SupabaseClient) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
  if (!token) return null
  const { data, error } = await db.auth.getUser(token)
  if (error || !data.user) return null
  const { data: perfil } = await db.from("perfis").select("id,nome,papel,ativo").eq("id", data.user.id).single()
  if (!perfil || !perfil.ativo) return null
  return perfil as { id: string; nome: string; papel: "supervisor" | "auxiliar"; ativo: boolean }
}

/** Chamada ao webhook REST do Bitrix (URL secreta fica só na variável de ambiente). */
export async function bitrix(metodo: string, params: Record<string, unknown>, webhook?: string) {
  let base = webhook || Netlify.env.get("BITRIX_WEBHOOK_URL") || ""
  if (!base) throw new Error("BITRIX_WEBHOOK_URL não configurada")
  if (!base.endsWith("/")) base += "/"
  const r = await fetch(base + metodo + ".json", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.error) throw new Error(`Bitrix ${metodo}: ${j.error_description || j.error || r.status}`)
  return j
}

/**
 * Webhooks de entrada criados por cada usuária (opcional), para ler a lista de conversas dela
 * no Bitrix (im.recent.list só devolve as conversas do dono do webhook).
 * Variável BITRIX_WEBHOOKS_USUARIOS = {"8937":"https://.../rest/8937/xxxx/","14305":"https://..."}
 */
export function webhooksUsuarios(): Record<number, string> {
  try {
    const j = JSON.parse(Netlify.env.get("BITRIX_WEBHOOKS_USUARIOS") || "{}")
    return Object.fromEntries(Object.entries(j).filter(([k, v]) => Number(k) && typeof v === "string" && /^https:\/\/.+\/rest\/\d+\//.test(v as string)).map(([k, v]) => [Number(k), v as string]))
  } catch (e) { console.error("BITRIX_WEBHOOKS_USUARIOS inválida:", (e as Error).message); return {} }
}

export function portalBitrix() {
  return (Netlify.env.get("BITRIX_PORTAL_URL") || "https://nebulize.bitrix24.com.br").replace(/\/$/, "")
}

export const json = (body: unknown, status = 200) => Response.json(body, { status })
