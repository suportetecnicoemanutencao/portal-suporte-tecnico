import type { Config } from "@netlify/functions"
import { admin, usuarioDoRequest, bitrix, portalBitrix, json } from "../lib/comum.mts"

/**
 * POST /api/bitrix/vincular  { atendimento_id, numero }
 * numero = nº da conversa do Canal Aberto (ex.: 30015) ou id do chat (ex.: chat24243).
 * Busca a conversa no Bitrix, o lead/contato vinculado e grava no atendimento.
 */
export default async (req: Request) => {
  if (req.method !== "POST") return json({ erro: "Use POST" }, 405)
  const db = admin()
  const user = await usuarioDoRequest(req, db)
  if (!user) return json({ erro: "Sessão expirada. Entre novamente." }, 401)

  const { atendimento_id, numero } = await req.json().catch(() => ({}))
  const bruto = String(numero || "").trim()
  if (!atendimento_id || !bruto) return json({ erro: "Informe o atendimento e o nº da conversa." }, 400)

  const { data: at } = await db.from("atendimentos").select("id,criado_por,cliente,contato").eq("id", atendimento_id).single()
  if (!at) return json({ erro: "Atendimento não encontrado." }, 404)
  if (at.criado_por !== user.id && user.papel !== "supervisor") return json({ erro: "Sem permissão neste atendimento." }, 403)

  const chatMatch = bruto.match(/chat\s*(\d+)/i)
  const digits = bruto.replace(/\D/g, "")
  if (!digits) return json({ erro: "Número da conversa inválido." }, 400)

  try {
    // 1) diálogo do Canal Aberto
    const dialogo = (await bitrix("imopenlines.dialog.get", chatMatch ? { CHAT_ID: Number(chatMatch[1]) } : { SESSION_ID: Number(digits) })).result
    if (!dialogo) return json({ erro: "Conversa não encontrada no Bitrix." }, 404)
    const partes = String(dialogo.entity_data_1 || "").split("|")
    const entidadeTipo = partes[1] || ""
    const entidadeId = Number(partes[2]) || null
    const sessao = chatMatch ? Number(partes[5]) || null : Number(digits)
    const chatId = Number(dialogo.id) || null

    // 2) atividade da conversa (status encerrada?)
    let encerrada = false, assunto = "", criadaEm: string | null = null
    if (sessao) {
      const act = await bitrix("crm.activity.list", {
        filter: { PROVIDER_ID: "IMOPENLINES_SESSION", ASSOCIATED_ENTITY_ID: sessao },
        select: ["ID", "COMPLETED", "SUBJECT", "CREATED", "OWNER_TYPE_ID", "OWNER_ID"],
      })
      const a = act.result?.[0]
      if (a) { encerrada = a.COMPLETED === "Y"; assunto = a.SUBJECT || ""; criadaEm = a.CREATED || null }
    }

    // 3) cliente no CRM
    let nome = "", telefone = "", email = "", empresa = ""
    const metodo = { LEAD: "crm.lead.get", CONTACT: "crm.contact.get", COMPANY: "crm.company.get", DEAL: "crm.deal.get" }[entidadeTipo]
    if (metodo && entidadeId) {
      const e = (await bitrix(metodo, { id: entidadeId })).result || {}
      nome = e.TITLE && entidadeTipo !== "CONTACT" ? e.TITLE : [e.NAME, e.LAST_NAME].filter(Boolean).join(" ")
      empresa = e.COMPANY_TITLE || ""
      telefone = e.PHONE?.[0]?.VALUE || ""
      email = e.EMAIL?.[0]?.VALUE || ""
    }
    // sem lead/contato no CRM: usa o nome da conversa ("cliente - Linha do Canal Aberto")
    if (!nome) nome = String(dialogo.name || "").split(" - ")[0].trim()

    const crmUrl = entidadeId && entidadeTipo
      ? `${portalBitrix()}/crm/${entidadeTipo.toLowerCase()}/details/${entidadeId}/`
      : null
    const dados = {
      sessao, chat_id: chatId, nome_conversa: dialogo.name, assunto, criada_em: criadaEm,
      entidade_tipo: entidadeTipo, entidade_id: entidadeId, cliente: nome, empresa, telefone, email, crm_url: crmUrl,
    }
    const upd: Record<string, unknown> = {
      bitrix_sessao: sessao,
      bitrix_chat_id: chatId,
      bitrix_link: chatId ? `${portalBitrix()}/online/?IM_DIALOG=chat${chatId}` : null,
      bitrix_dados: dados,
      bitrix_vinculado_em: new Date().toISOString(),
      bitrix_encerrada: encerrada,
    }
    if (!at.cliente && nome) upd.cliente = empresa ? `${nome} · ${empresa}` : nome
    if (!at.contato) upd.contato = `Conversa Bitrix nº ${sessao ?? digits}${telefone ? " · " + telefone : ""}`

    const { data: novo, error } = await db.from("atendimentos").update(upd).eq("id", at.id).select().single()
    if (error) {
      if (String(error.message).includes("uq_atend_bitrix_aberto"))
        return json({ erro: "Esta conversa já está vinculada a outro atendimento em aberto." }, 409)
      throw error
    }
    await db.from("atendimento_eventos").insert({
      atendimento_id: at.id, autor: user.id, tipo: "bitrix",
      descricao: `Conversa Bitrix nº ${sessao ?? digits} vinculada${nome ? " · " + nome : ""}`, dados,
    })
    return json({ ok: true, atendimento: novo, bitrix: dados })
  } catch (e) {
    return json({ erro: (e as Error).message }, 502)
  }
}

export const config: Config = { path: "/api/bitrix/vincular", method: "POST" }
