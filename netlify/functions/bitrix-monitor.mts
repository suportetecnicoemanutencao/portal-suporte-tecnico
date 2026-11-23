import type { Config } from "@netlify/functions"
import { admin, bitrix } from "../lib/comum.mts"
import { lerConversa, montarUpdate, mensagensDoHistorico, extrair, acharSaudacao } from "../lib/bitrix-conversa.mts"
import { acompanharConversas } from "../lib/conversas.mts"

/**
 * Roda a cada 5 minutos.
 * 1) Descobre sessões novas do Canal Aberto (os números são sequenciais).
 * 2) Procura a saudação "Suporte Técnico Nebulize, me chamo <Nome>" e abre o atendimento
 *    automaticamente para a usuária com esse nome, já com os dados lidos da conversa.
 * 3) Relê as conversas dos atendimentos em aberto para capturar CNPJ, nº de série, O.S. etc.
 * Limite de 30 s por execução: tudo em lotes (batch) e com teto de itens por rodada.
 */
const FINAIS = "(finalizado,resolvido_chat,cancelado)"
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()
const inicio = Date.now()
const tempoOk = () => Date.now() - inicio < 22000

async function batch(cmd: Record<string, string>) {
  const r = await bitrix("batch", { halt: 0, cmd })
  return { ok: (r.result?.result || {}) as Record<string, any>, err: (r.result?.result_error || {}) as Record<string, any> }
}

export default async () => {
  const db = admin()
  const { data: perfis } = await db.from("perfis").select("id,nome,nome_bitrix,ativo").eq("ativo", true)
  const porNome = new Map((perfis || []).map(p => [norm(p.nome_bitrix || p.nome.split(" ")[0]), p]))

  // ---------- 1) descobrir sessões novas ----------
  const { data: cfg } = await db.from("config_portal").select("valor").eq("chave", "bitrix_ultima_sessao").maybeSingle()
  let ultima = Number(cfg?.valor) || 0
  if (!ultima) {
    const a = await bitrix("crm.activity.list", { order: { ID: "DESC" }, filter: { PROVIDER_ID: "IMOPENLINES_SESSION" }, select: ["ASSOCIATED_ENTITY_ID"] })
    ultima = Math.max(0, Number(a.result?.[0]?.ASSOCIATED_ENTITY_ID || 0) - 40)
  }
  let maior = ultima, vazios = 0, prox = ultima + 1
  while (tempoOk() && vazios < 2) {
    const cmd: Record<string, string> = {}
    for (let s = prox; s < prox + 40; s++) cmd["s" + s] = `imopenlines.dialog.get?SESSION_ID=${s}`
    const { ok } = await batch(cmd)
    const achadas = Object.entries(ok).map(([k, d]) => ({ sessao: Number(k.slice(1)), chat_id: Number(d.id) || null, nome: d.name || null }))
    if (achadas.length) {
      vazios = 0
      maior = Math.max(maior, ...achadas.map(a => a.sessao))
      await db.from("bitrix_sessoes").upsert(achadas, { onConflict: "sessao", ignoreDuplicates: true })
    } else vazios++
    prox += 40
  }
  if (maior > ultima) await db.from("config_portal").upsert({ chave: "bitrix_ultima_sessao", valor: maior, atualizado_em: new Date().toISOString() })

  // carga inicial (uma vez): conversas dos últimos dias que ainda podem estar abertas, para a aba "Minhas conversas"
  const { data: bk } = await db.from("config_portal").select("valor").eq("chave", "bitrix_carga_inicial").maybeSingle()
  if (!bk && maior && tempoOk()) {
    for (let s0 = Math.max(1, maior - 400); s0 < ultima && tempoOk(); s0 += 40) {
      const cmd: Record<string, string> = {}
      for (let s = s0; s < Math.min(s0 + 40, ultima + 1); s++) cmd["s" + s] = `imopenlines.dialog.get?SESSION_ID=${s}`
      const { ok } = await batch(cmd)
      const achadas = Object.entries(ok).map(([k, d]) => ({ sessao: Number(k.slice(1)), chat_id: Number(d.id) || null, nome: d.name || null, status: "ignorada" }))
      if (achadas.length) await db.from("bitrix_sessoes").upsert(achadas, { onConflict: "sessao", ignoreDuplicates: true })
    }
    if (tempoOk()) await db.from("config_portal").upsert({ chave: "bitrix_carga_inicial", valor: true })
  }

  // ---------- 2) saudação → abrir atendimento ----------
  const limite = new Date(Date.now() - 48 * 3600e3).toISOString()
  await db.from("bitrix_sessoes").update({ status: "ignorada" }).eq("status", "pendente").lt("descoberta_em", limite)
  const { data: pendentes } = await db.from("bitrix_sessoes").select("*").eq("status", "pendente")
    .order("verificada_em", { ascending: true, nullsFirst: true }).limit(45)
  let abertos = 0
  if (pendentes?.length && tempoOk()) {
    const cmd: Record<string, string> = {}
    for (const p of pendentes) if (p.chat_id) cmd["s" + p.sessao] = `imopenlines.session.history.get?CHAT_ID=${p.chat_id}&SESSION_ID=${p.sessao}`
    const { ok } = await batch(cmd)
    const agora = new Date().toISOString()
    for (const p of pendentes) {
      if (!tempoOk()) break
      const msgs = mensagensDoHistorico(ok["s" + p.sessao])
      const saud = msgs.find(m => m.tipo === "operador" && acharSaudacao(m.texto))
      const perfil = saud ? porNome.get(norm(acharSaudacao(saud.texto)!)) : null
      if (!perfil) {
        const encerrada = msgs.some(m => m.tipo === "sistema" && /encerrou a sess[ãa]o/i.test(m.texto))
        await db.from("bitrix_sessoes").update({ verificada_em: agora, ...(encerrada ? { status: "ignorada" } : {}) }).eq("sessao", p.sessao)
        continue
      }
      // já existe atendimento aberto com essa conversa?
      const { data: ja } = await db.from("atendimentos").select("id").eq("bitrix_sessao", p.sessao).not("status", "in", FINAIS).maybeSingle()
      if (ja) { await db.from("bitrix_sessoes").update({ status: "aberto", atendimento_id: ja.id, verificada_em: agora }).eq("sessao", p.sessao); continue }
      try {
        const conversa = await lerConversa(String(p.sessao))
        const { upd, capturados } = montarUpdate({}, conversa)
        const { data: novo, error } = await db.from("atendimentos").insert({
          ...upd, criado_por: perfil.id, canal: "Bitrix", origem: "bitrix_auto", status: "aberto",
          bitrix_vinculado_em: agora, created_at: saud!.data || agora,
        }).select("id,cliente").single()
        if (error) throw error
        await db.from("bitrix_sessoes").update({ status: "aberto", atendimento_id: novo.id, verificada_em: agora }).eq("sessao", p.sessao)
        await db.from("atendimento_eventos").insert({ atendimento_id: novo.id, tipo: "bitrix", descricao: `Aberto automaticamente pela saudação no Bitrix (conversa nº ${p.sessao})${capturados.length ? " · capturado: " + capturados.join(", ") : ""}` })
        await db.from("notificacoes").insert({ usuario_id: perfil.id, atendimento_id: novo.id, tipo: "auto_aberto",
          titulo: `Atendimento #${novo.id} aberto automaticamente`, mensagem: `${novo.cliente || "Cliente"} · conversa nº ${p.sessao}. Confira tipo e modelo.` })
        abertos++
      } catch (e) { console.error("abrir", p.sessao, (e as Error).message) }
    }
  }

  // ---------- 3) Minhas conversas: situação + avisos ----------
  let conv = { conversas: 0, avisos: 0 }
  if (tempoOk()) { try { conv = await acompanharConversas(db, tempoOk) } catch (e) { console.error("conversas", (e as Error).message) } }

  // ---------- 4) reler atendimentos em aberto ----------
  let atualizados = 0
  if (tempoOk()) {
    const { data: abertosAt } = await db.from("atendimentos").select("*").not("bitrix_sessao", "is", null).not("status", "in", FINAIS).limit(1000)
    const todos = (abertosAt || []).filter(a => a.bitrix_chat_id)
    // revezamento: lê primeiro as conversas verificadas há mais tempo
    const { data: marcas } = todos.length
      ? await db.from("bitrix_sessoes").select("sessao,verificada_em").in("sessao", todos.map(a => a.bitrix_sessao))
      : { data: [] as { sessao: number; verificada_em: string | null }[] }
    const quando = new Map((marcas || []).map(m => [Number(m.sessao), m.verificada_em ? Date.parse(m.verificada_em) : 0]))
    const lista = todos.sort((x, y) => (quando.get(Number(x.bitrix_sessao)) || 0) - (quando.get(Number(y.bitrix_sessao)) || 0)).slice(0, 40)
    if (lista.length) await db.from("bitrix_sessoes").upsert(lista.map(a => ({
      sessao: a.bitrix_sessao, chat_id: a.bitrix_chat_id, status: "aberto", atendimento_id: a.id, verificada_em: new Date().toISOString(),
    })), { onConflict: "sessao" })
    if (lista.length) {
      const cmd: Record<string, string> = {}
      for (const a of lista) cmd["a" + a.id] = `imopenlines.session.history.get?CHAT_ID=${a.bitrix_chat_id}&SESSION_ID=${a.bitrix_sessao}`
      const { ok } = await batch(cmd)
      for (const a of lista) {
        if (!tempoOk()) break
        const msgs = mensagensDoHistorico(ok["a" + a.id])
        if (!msgs.length) continue
        const { dados, fontes } = extrair(msgs)
        const upd: Record<string, unknown> = {}
        const novos: string[] = []
        for (const k of ["cnpj", "numero_serie", "os_numero", "email_nf", "endereco", "modelo"] as const)
          if (dados[k] && !a[k]) { upd[k] = dados[k]; novos.push(k) }
        const encerrada = msgs.some(m => m.tipo === "sistema" && /encerrou a sess[ãa]o/i.test(m.texto))
        if (encerrada && !a.bitrix_encerrada) upd.bitrix_encerrada = true
        if (!Object.keys(upd).length) continue
        upd.bitrix_dados = { ...(a.bitrix_dados || {}), extraidos: { ...(a.bitrix_dados?.extraidos || {}), ...dados }, fontes: { ...(a.bitrix_dados?.fontes || {}), ...fontes }, lido_em: new Date().toISOString(), mensagens: msgs.length }
        await db.from("atendimentos").update(upd).eq("id", a.id)
        if (novos.length) await db.from("atendimento_eventos").insert({ atendimento_id: a.id, tipo: "bitrix", descricao: `Capturado da conversa: ${novos.join(", ").replace("numero_serie", "nº de série").replace("os_numero", "nº da O.S.").replace("email_nf", "e-mail")}` })
        atualizados++
      }
    }
  }
  console.log(`monitor: última sessão ${maior}, abertos ${abertos}, conversas ${conv.conversas}, avisos ${conv.avisos}, atualizados ${atualizados}`)
}

export const config: Config = { schedule: "*/5 * * * *" }
