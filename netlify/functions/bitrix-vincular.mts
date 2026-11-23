import type { Config } from "@netlify/functions"
import { admin, usuarioDoRequest, json } from "../lib/comum.mts"
import { lerConversa, montarUpdate } from "../lib/bitrix-conversa.mts"

const NOMES: Record<string, string> = {
  cliente: "cliente", contato: "contato", cnpj: "CNPJ", numero_serie: "nº de série", os_numero: "nº da O.S.",
  email_nf: "e-mail", endereco: "endereço", modelo: "modelo",
}

/**
 * POST /api/bitrix/vincular  { atendimento_id, numero }
 * numero = nº da conversa do Canal Aberto (ex.: 28795) ou "chat24243".
 * Busca a conversa, lê as mensagens e preenche os campos vazios do atendimento
 * (cliente, telefone, CNPJ, nº de série, nº da O.S., e-mail, endereço, modelo).
 * Também serve para "Atualizar do Bitrix" (mesmo nº já vinculado).
 */
export default async (req: Request) => {
  if (req.method !== "POST") return json({ erro: "Use POST" }, 405)
  try {
    const db = admin()
    const user = await usuarioDoRequest(req, db)
    if (!user) return json({ erro: "Sessão expirada. Entre novamente." }, 401)

    const { atendimento_id, numero } = await req.json().catch(() => ({}))
    const bruto = String(numero || "").trim()
    if (!atendimento_id || !bruto.replace(/\D/g, "")) return json({ erro: "Informe o nº da conversa." }, 400)

    const { data: at } = await db.from("atendimentos").select("*").eq("id", atendimento_id).single()
    if (!at) return json({ erro: "Atendimento não encontrado." }, 404)
    if (at.criado_por !== user.id && user.papel !== "supervisor") return json({ erro: "Sem permissão neste atendimento." }, 403)

    const conversa = await lerConversa(bruto)
    const { upd, capturados } = montarUpdate(at, conversa)
    upd.bitrix_vinculado_em = at.bitrix_sessao === conversa.sessao && at.bitrix_vinculado_em ? at.bitrix_vinculado_em : new Date().toISOString()

    const { data: novo, error } = await db.from("atendimentos").update(upd).eq("id", at.id).select().single()
    if (error) {
      if (String(error.message).includes("uq_atend_bitrix_aberto"))
        return json({ erro: "Esta conversa já está vinculada a outro atendimento em aberto." }, 409)
      throw error
    }
    const lista = capturados.map(c => NOMES[c] || c)
    await db.from("atendimento_eventos").insert({
      atendimento_id: at.id, autor: user.id, tipo: "bitrix",
      descricao: `Conversa nº ${conversa.sessao} lida (${conversa.mensagens.length} mensagens)` + (lista.length ? ` · capturado: ${lista.join(", ")}` : " · nenhum dado novo"),
    })
    return json({ ok: true, atendimento: novo, capturados: lista })
  } catch (e) {
    return json({ erro: (e as Error).message }, 502)
  }
}

export const config: Config = { path: "/api/bitrix/vincular", method: "POST" }
