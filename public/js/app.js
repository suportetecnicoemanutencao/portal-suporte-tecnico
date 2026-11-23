// PORTAL SUPORTE TÉCNICO · Nebulize
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { V, GERAL, MODELS, SEVL, SEVC, REF } from "./guia.js";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const LOGO = document.querySelector("header.top img").src;

/* ================= ESTADO ================= */
let me = null;            // perfil logado
let perfis = {};          // id -> perfil
let A = null;             // atendimento atual
let lista = [];           // atendimentos carregados
let notifs = [];
let ui = { model: "nb400", ac: null, visita: "simples", script: "locacao" };
try { Object.assign(ui, JSON.parse(localStorage.getItem("pst_ui") || "{}")); } catch (e) {}
const saveUi = () => { try { localStorage.setItem("pst_ui", JSON.stringify(ui)); } catch (e) {} };

const STATUS = {
  aberto: "Em aberto", aguardando_cliente: "Aguardando cliente", aguardando_tecnico: "Aguardando técnico",
  aguardando_peca: "Aguardando peça", resolvido_chat: "Resolvido pelo chat", finalizado: "Finalizado", cancelado: "Cancelado",
};
const FINAIS = ["finalizado", "resolvido_chat", "cancelado"];
const TIPOS = ["Aluguel", "Venda em garantia", "Venda fora de garantia"];
const DIA = 864e5;
const diasParado = a => Math.floor((Date.now() - new Date(a.ultima_atividade).getTime()) / DIA);
const isSup = () => me?.papel === "supervisor";
const podeEditar = a => a && (a.criado_por === me?.id || isSup());

/* campos do atendimento usados pelos modelos de mensagem */
const F = k => {
  if (!A) return "";
  if (k === "atendente") return (perfis[A.criado_por]?.nome || me?.nome || "").trim();
  if (k === "video") return A.video_recebido ? "Sim" : "Não";
  return String(A[k] ?? "").trim();
};
const v = (k, ph) => F(k) || ph;

/* ================= UTIL ================= */
function toast(t) { const e = $("#toast"); e.textContent = t || "Copiado"; e.classList.add("on"); clearTimeout(e._t); e._t = setTimeout(() => e.classList.remove("on"), 1800); }
function copyText(t) {
  const done = () => toast("Copiado");
  const fb = x => { const a = document.createElement("textarea"); a.value = x; document.body.appendChild(a); a.select(); try { document.execCommand("copy"); done(); } catch (e) { toast("Selecione e copie manualmente"); } a.remove(); };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(t).then(done, () => fb(t)); else fb(t);
}
function msgBox(el, text) {
  if (!el) return;
  el.innerHTML = ""; el.classList.add("has-cp");
  const s = document.createElement("span"); s.textContent = text; el.appendChild(s);
  const b = document.createElement("button"); b.className = "btn sm cp"; b.type = "button"; b.textContent = "Copiar"; b.onclick = () => copyText(text); el.appendChild(b);
}
const fmtData = d => d ? new Date(d).toLocaleDateString("pt-BR") : "";
const fmtDH = d => d ? new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
const stPill = s => `<span class="st st-${s}">${STATUS[s] || s}</span>`;
document.addEventListener("click", e => {
  const b = e.target.closest("[data-copy]"); if (b) copyText($("#" + b.dataset.copy).textContent);
  const a = e.target.closest("[data-cl]"); if (a) copyText(a.dataset.cl);
  const m = e.target.closest("[data-cm]"); if (m) { const [l, u] = V[m.dataset.cm]; copyText(`Segue um vídeo que mostra o passo a passo (${l}):\n${u}\n\nQualquer dúvida, estou à disposição.`); }
  if (e.target.closest("[data-novo]")) abrirNovo();
});

/* ================= AUTH ================= */
async function iniciarSessao(session) {
  if (!session) { me = null; $("#login").classList.remove("off"); return; }
  const { data: perfil, error } = await sb.from("perfis").select("*").eq("id", session.user.id).single();
  if (error || !perfil || !perfil.ativo) {
    $("#lgErr").textContent = error ? "Erro ao carregar o perfil: " + error.message : "Usuário sem acesso ao portal. Fale com o Supervisor.";
    console.error("perfil", error, perfil);
    await sb.auth.signOut(); return;
  }
  me = perfil;
  const { data: ps } = await sb.from("perfis").select("id,nome,papel,ativo");
  perfis = Object.fromEntries((ps || []).map(p => [p.id, p]));
  $("#login").classList.add("off");
  $("#uchip").innerHTML = `<b>${esc(me.nome)}</b><span class="pill">${me.papel === "supervisor" ? "Administrador · Supervisor" : "Auxiliar"}</span><button class="btn sm" id="btnSenha" type="button">Senha</button>`;
  $("#btnSenha").onclick = () => { $("#sErr").textContent = ""; $("#mSenha").classList.add("on"); $("#s_nova").focus(); };
  $$(".sup-only").forEach(e => e.style.display = isSup() ? "" : "none");
  $("#fEscopo").value = isSup() ? "todos" : "meus";
  const ultimo = Number(localStorage.getItem("pst_atual_" + me.id) || 0);
  await carregarLista();
  if (ultimo) await abrirAtendimento(ultimo, false);
  await carregarNotifs();
  carregarConversas();
  assinarRealtime();
  renderAll();
  route();
  if ("Notification" in window && Notification.permission === "default") setTimeout(() => Notification.requestPermission().catch(() => {}), 4000);
}
$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault(); $("#lgErr").textContent = ""; $("#lgBtn").disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email: $("#lgEmail").value.trim(), password: $("#lgPass").value });
  $("#lgBtn").disabled = false;
  if (error) $("#lgErr").textContent = error.message.includes("Invalid") ? "E-mail ou senha incorretos." : error.message;
  else $("#lgPass").value = "";
});
$("#lgReset").onclick = async () => {
  const email = $("#lgEmail").value.trim();
  if (!email) { $("#lgErr").textContent = "Digite seu e-mail acima e clique novamente."; return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
  $("#lgErr").textContent = error ? error.message : "Enviamos um link de redefinição para o seu e-mail.";
};
$("#btnSair").onclick = async () => { await sb.auth.signOut(); location.hash = ""; location.reload(); };
$("#sCancel").onclick = () => $("#mSenha").classList.remove("on");
$("#fSenha").addEventListener("submit", async e => {
  e.preventDefault();
  const { error } = await sb.auth.updateUser({ password: $("#s_nova").value });
  if (error) $("#sErr").textContent = error.message; else { $("#mSenha").classList.remove("on"); $("#s_nova").value = ""; toast("Senha alterada"); }
});
sb.auth.onAuthStateChange((ev, session) => {
  if (ev === "PASSWORD_RECOVERY") { setTimeout(() => $("#mSenha").classList.add("on"), 500); }
  if (ev === "SIGNED_IN" && !me) iniciarSessao(session);
  if (ev === "SIGNED_OUT") { me = null; $("#login").classList.remove("off"); }
});

/* ================= LISTA ================= */
async function carregarLista() {
  const { data, error } = await sb.from("atendimentos").select("*").order("id", { ascending: false }).limit(1000);
  if (error) { toast("Erro ao carregar: " + error.message); return; }
  lista = data || [];
}
function filtrada() {
  const esc_ = $("#fEscopo").value, st = $("#fStatus").value, tp = $("#fTipo").value, q = $("#fBusca").value.toLowerCase().trim();
  return lista.filter(a => {
    if (esc_ === "meus" && a.criado_por !== me.id) return false;
    const fim = FINAIS.includes(a.status);
    if (st === "abertos" && fim) return false;
    if (st === "finalizados" && !fim) return false;
    if (st === "parados" && (fim || diasParado(a) < 3)) return false;
    if (tp && a.tipo !== tp) return false;
    if (q && ![a.id, a.cliente, a.contato, a.bitrix_sessao, a.os_numero, a.modelo, a.numero_serie, a.cnpj].join(" ").toLowerCase().includes(q)) return false;
    return true;
  });
}
function renderLista() {
  if (!me) return;
  const meus = lista.filter(a => a.criado_por === me.id), base = isSup() ? lista : meus;
  const abertos = base.filter(a => !FINAIS.includes(a.status));
  const parados = abertos.filter(a => diasParado(a) >= 3);
  const ini = new Date(); ini.setDate(1); ini.setHours(0, 0, 0, 0);
  const fimMes = base.filter(a => FINAIS.includes(a.status) && a.finalizado_em && new Date(a.finalizado_em) >= ini);
  const hoje = base.filter(a => new Date(a.created_at).toDateString() === new Date().toDateString());
  $("#kpisLista").innerHTML = `
    <div class="kpi info"><span>${isSup() ? "Em andamento (equipe)" : "Meus em andamento"}</span><b class="v">${abertos.length}</b></div>
    <div class="kpi ${parados.length ? "alerta" : "ok"}"><span>Parados há 3+ dias</span><b class="v">${parados.length}</b></div>
    <div class="kpi"><span>Registrados hoje</span><b class="v">${hoje.length}</b></div>
    <div class="kpi ok"><span>Finalizados no mês</span><b class="v">${fimMes.length}</b></div>`;
  const meusParados = meus.filter(a => !FINAIS.includes(a.status) && diasParado(a) >= 3);
  $("#avisoParados").innerHTML = meusParados.length
    ? `<div class="note crit"><b>Você tem ${meusParados.length} atendimento${meusParados.length > 1 ? "s" : ""} parado${meusParados.length > 1 ? "s" : ""} há mais de 3 dias</b>Cobre o técnico, atualize o cliente ou finalize. <button class="btn sm" type="button" id="verParados">Ver</button></div>` : "";
  const vp = $("#verParados"); if (vp) vp.onclick = () => { $("#fEscopo").value = "meus"; $("#fStatus").value = "parados"; renderLista(); };
  const rows = filtrada();
  $("#listaVazia").hidden = rows.length > 0;
  $("#tbLista").innerHTML = rows.map(a => {
    const d = diasParado(a), fim = FINAIS.includes(a.status);
    return `<tr data-id="${a.id}"><td class="num">#${a.id}</td><td class="cl">${esc(a.cliente || "—")}${a.origem === "bitrix_auto" ? ' <span class="pill info" title="Aberto automaticamente pela saudação no Bitrix">auto</span>' : ""}<br><small class="lead" style="font-size:12px">${esc(a.contato || "")}</small></td>
      <td>${esc(a.tipo || "—")}</td><td>${esc(a.modelo || "—")}</td><td>${stPill(a.status)}</td>
      <td>${esc(perfis[a.criado_por]?.nome || "")}</td><td class="num">${a.bitrix_sessao ? (a.bitrix_link ? `<a href="${esc(a.bitrix_link)}" target="_blank" rel="noopener">${a.bitrix_sessao}</a>` : a.bitrix_sessao) : "—"}</td>
      <td class="num">${esc(a.os_numero || "—")}${a.os_status ? `<br><small class="lead" style="font-size:12px">${esc(a.os_status)}</small>` : ""}</td>
      <td class="dias ${!fim && d >= 3 ? "alerta" : ""}">${fim ? fmtData(a.finalizado_em) : d + " d"}</td></tr>`;
  }).join("");
}
$("#tbLista").addEventListener("click", e => {
  if (e.target.closest("a")) return;
  const tr = e.target.closest("tr[data-id]"); if (tr) abrirAtendimento(Number(tr.dataset.id), true);
});
["#fEscopo", "#fStatus", "#fTipo"].forEach(s => $(s).onchange = renderLista);
$("#fBusca").oninput = renderLista;

/* ================= NOVO ================= */
function abrirNovo() {
  $("#n_modelo").innerHTML = '<option value="">A identificar</option>' + Object.values(MODELS).map(m => `<option>${esc(m.name)}</option>`).join("");
  $("#fNovo").reset(); $("#nErr").textContent = ""; $("#mNovo").classList.add("on"); $("#n_bitrix").focus();
}
$("#btnNovo").onclick = abrirNovo;
$("#nCancel").onclick = () => $("#mNovo").classList.remove("on");
$("#fNovo").addEventListener("submit", async e => {
  e.preventDefault(); $("#nSalvar").disabled = true; $("#nErr").textContent = "";
  const row = { canal: $("#n_canal").value, cliente: $("#n_cliente").value.trim() || null, tipo: $("#n_tipo").value || null, modelo: $("#n_modelo").value || null, criado_por: me.id };
  const { data, error } = await sb.from("atendimentos").insert(row).select().single();
  $("#nSalvar").disabled = false;
  if (error) { $("#nErr").textContent = error.message; return; }
  lista.unshift(data); $("#mNovo").classList.remove("on");
  await abrirAtendimento(data.id, true);
  const num = $("#n_bitrix").value.trim();
  if (num) { $("#bxNumero").value = num; vincularBitrix(); }
  toast(`Atendimento #${data.id} registrado`);
});

/* ================= ATENDIMENTO ATUAL ================= */
async function abrirAtendimento(id, irPara) {
  let a = lista.find(x => x.id === id);
  if (!a) { const { data } = await sb.from("atendimentos").select("*").eq("id", id).single(); a = data; }
  if (!a) { localStorage.removeItem("pst_atual_" + me.id); return; }
  A = { ...a }; localStorage.setItem("pst_atual_" + me.id, String(id));
  if (a.modelo) { const k = Object.keys(MODELS).find(x => MODELS[x].name === a.modelo); if (k) ui.model = k; }
  renderAll();
  if (irPara) location.hash = "atendimento";
}
let saveTimer = null, pendente = {};
function patch(campos, imediato) {
  if (!A) { toast("Registre ou abra um atendimento primeiro"); return; }
  if (!podeEditar(A)) { toast("Somente a responsável ou o supervisor pode alterar este atendimento"); return; }
  Object.assign(A, campos); Object.assign(pendente, campos);
  const i = lista.findIndex(x => x.id === A.id); if (i >= 0) lista[i] = { ...lista[i], ...campos };
  $("#salvo").textContent = "Salvando…";
  clearTimeout(saveTimer); saveTimer = setTimeout(flush, imediato ? 0 : 700);
}
async function flush() {
  if (!A || !Object.keys(pendente).length) return;
  const p = pendente; pendente = {};
  const { data, error } = await sb.from("atendimentos").update(p).eq("id", A.id).select().single();
  if (error) { $("#salvo").textContent = "Erro ao salvar"; toast(error.message); return; }
  Object.assign(A, { updated_at: data.updated_at, ultima_atividade: data.ultima_atividade, finalizado_em: data.finalizado_em });
  const i = lista.findIndex(x => x.id === A.id); if (i >= 0) lista[i] = data;
  $("#salvo").textContent = "Salvo " + new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if ("status" in p) { carregarEventos(); renderLista(); }
}
window.addEventListener("beforeunload", () => { if (Object.keys(pendente).length) flush(); });

const CAMPOS = [
  ["cliente", "Cliente / loja"], ["contato", "Nº da conversa ou telefone"],
  ["canal", "Canal de entrada", ["Bitrix", "WhatsApp técnico", "Comercial", "Ligação direta"]],
  ["modelo", "Modelo", null], ["tipo", "Tipo", TIPOS],
  ["numero_serie", "Nº de série"], ["endereco", "Endereço onde a máquina está instalada", null, "full"], ["cnpj", "CNPJ para cobrança"], ["email_nf", "E-mail para envio das notas"],
  ["nf_data", "Data da NF de venda", "date"], ["video_recebido", "Vídeo da primeira análise recebido?", "bool"],
  ["observacoes", "Observações", "area", "full"],
];
function renderAtendimento() {
  const tem = !!A;
  $("#atSem").hidden = tem; $("#atCom").style.display = tem ? "flex" : "none";
  const ba = $("#btnAtual");
  ba.classList.toggle("vazio", !tem);
  ba.textContent = tem ? `#${A.id} · ${A.cliente || "Cliente a identificar"}` : "Nenhum atendimento aberto";
  if (!tem) return;
  const ed = podeEditar(A);
  $("#atTitulo").textContent = `Atendimento #${A.id}`;
  $("#atSub").innerHTML = `${A.origem === "bitrix_auto" ? '<span class="pill info">Aberto automaticamente</span> ' : ""}${esc(A.cliente || "Cliente a identificar")} · aberto por ${esc(perfis[A.criado_por]?.nome || "")} em ${fmtDH(A.created_at)} · ${stPill(A.status)}${ed ? "" : ' · <span class="pill warn">somente leitura</span>'}`;
  $("#atStatus").innerHTML = Object.entries(STATUS).map(([k, l]) => `<option value="${k}"${A.status === k ? " selected" : ""}>${l}</option>`).join("");
  $("#atStatus").disabled = !ed;
  const fim = FINAIS.includes(A.status);
  $("#atFinalAviso").innerHTML = A.status === "finalizado" && !A.pos_atendimento
    ? `<div class="note warn"><b>Falta o pós-atendimento</b>Envie a finalização com o relatório, faça a pesquisa de satisfação e oriente o técnico a enviar a nota pelo Portal do Técnico.</div>` : "";
  // form
  const f = $("#atForm"); f.innerHTML = "";
  CAMPOS.forEach(([k, l, tipo, cls]) => {
    const lab = document.createElement("label"); lab.textContent = l; if (cls) lab.className = cls; lab.htmlFor = "a_" + k;
    let el;
    const opts = k === "modelo" ? Object.values(MODELS).map(m => m.name) : Array.isArray(tipo) ? tipo : null;
    if (opts) { el = document.createElement("select"); el.innerHTML = '<option value="">—</option>' + opts.map(o => `<option${A[k] === o ? " selected" : ""}>${esc(o)}</option>`).join(""); }
    else if (tipo === "bool") { el = document.createElement("select"); el.innerHTML = `<option value="false">Não</option><option value="true"${A[k] ? " selected" : ""}>Sim</option>`; }
    else if (tipo === "area") { el = document.createElement("textarea"); el.rows = 2; el.value = A[k] || ""; }
    else { el = document.createElement("input"); el.type = tipo === "date" ? "date" : "text"; el.value = A[k] || ""; }
    el.id = "a_" + k; el.disabled = !ed;
    const ext = A.bitrix_dados?.extraidos || {};
    const doBx = (k === "cliente" && A.bitrix_dados?.cliente) || (ext[k] && String(A[k] || "") === String(ext[k]));
    if (doBx) { lab.innerHTML = `<span>${esc(l)} <span class="pill info" style="font-size:11px;padding:0 7px" title="${esc(A.bitrix_dados?.fontes?.[k] || "Capturado da conversa")}">do Bitrix</span></span>`; }
    el.addEventListener(el.tagName === "SELECT" || el.type === "date" ? "change" : "input", () => {
      let val = el.value; if (tipo === "bool") val = val === "true"; if (val === "") val = null;
      if (k === "modelo") { const key = Object.keys(MODELS).find(x => MODELS[x].name === val); if (key) ui.model = key; }
      patch({ [k]: val });
      if (k === "cliente") $("#btnAtual").textContent = `#${A.id} · ${val || "Cliente a identificar"}`;
      if (["modelo", "tipo", "nf_data"].includes(k)) renderAll(true);
    });
    lab.appendChild(el); f.appendChild(lab);
  });
  // O.S. / técnico
  $$("[data-f]").forEach(el => { el.value = A[el.dataset.f] || ""; el.disabled = !ed; el.oninput = () => patch({ [el.dataset.f]: el.value || null }); });
  $("#osStatus").innerHTML = A.os_status
    ? `<div class="note ${A.os_status === "fechada" ? "ok" : ""}"><b>Infraspeak: O.S. ${esc(A.os_status)}</b>${A.os_fechada_em ? "Fechada em " + fmtDH(A.os_fechada_em) : A.os_aberta_em ? "Confirmada em " + fmtDH(A.os_aberta_em) : ""}</div>`
    : `<p class="lead" style="margin:0;font-size:14px">Quando o Infraspeak avisar abertura ou fechamento desta O.S., o status aparece aqui.</p>`;
  // Bitrix
  $("#bxNumero").disabled = !ed; $("#bxVincular").disabled = !ed;
  if (A.bitrix_sessao && !$("#bxNumero").matches(":focus")) $("#bxNumero").value = A.bitrix_sessao;
  const d = A.bitrix_dados;
  $("#bxDados").innerHTML = d ? `<dl class="bx">
      <div><dt>Conversa</dt><dd>nº ${esc(d.sessao ?? A.bitrix_sessao)}${A.bitrix_encerrada ? ' <span class="pill warn">encerrada no Bitrix</span>' : ' <span class="pill ok">ativa</span>'}</dd></div>
      <div><dt>Cliente no CRM</dt><dd>${esc(d.cliente || "—")}${d.empresa ? "<br>" + esc(d.empresa) : ""}</dd></div>
      <div><dt>Telefone</dt><dd>${esc(d.telefone || "—")}</dd></div>
      <div><dt>Canal</dt><dd>${esc(d.nome_conversa || d.assunto || "—")}</dd></div>
      <div><dt>Mensagens lidas</dt><dd>${esc(d.mensagens ?? "—")}${d.lido_em ? " · " + fmtDH(d.lido_em) : ""}</dd></div>
    </dl>${capturadosHTML(d)}<div class="filtros"><button class="btn sm" type="button" id="bxAtualizar"${ed ? "" : " disabled"}>Atualizar do Bitrix</button>${A.bitrix_link ? `<a class="btn sm" href="${esc(A.bitrix_link)}" target="_blank" rel="noopener">Abrir conversa no Bitrix</a>` : ""}${d.crm_url ? `<a class="btn sm" href="${esc(d.crm_url)}" target="_blank" rel="noopener">Abrir no CRM</a>` : ""}<span class="salvo">vinculada em ${fmtDH(A.bitrix_vinculado_em)}</span></div>`
    : `<p class="lead" style="margin:0;font-size:14px">Informe o nº da conversa do Canal Aberto e clique em Vincular. O portal busca o cliente e o telefone no Bitrix.</p>`;
  const bxa = $("#bxAtualizar"); if (bxa) bxa.onclick = () => { $("#bxNumero").value = A.bitrix_sessao; vincularBitrix(); };
  // pós
  $("#a_pos").checked = !!A.pos_atendimento; $("#a_pos").disabled = !ed; $("#a_pos").onchange = () => patch({ pos_atendimento: $("#a_pos").checked }, true);
  $("#a_rma").checked = !!A.rma; $("#a_rma").disabled = !ed; $("#a_rma").onchange = () => patch({ rma: $("#a_rma").checked }, true);
  $("#estrelas").innerHTML = '<span class="salvo">Satisfação: </span>' + [1, 2, 3, 4, 5].map(n => `<button type="button" data-n="${n}" class="${(A.satisfacao || 0) >= n ? "on" : ""}" aria-label="${n} de 5"${ed ? "" : " disabled"}>★</button>`).join("");
  $$("#estrelas button").forEach(b => b.onclick = () => { patch({ satisfacao: Number(b.dataset.n) }, true); renderAtendimento(); });
  // próximo passo
  $("#atProx").innerHTML = proximoPasso();
}
const ROT = { cnpj: "CNPJ", numero_serie: "Nº de série", os_numero: "O.S.", email_nf: "E-mail", endereco: "Endereço", modelo: "Modelo", telefone: "Telefone", atendente_nome: "Saudação de" };
function capturadosHTML(d) {
  const e = d?.extraidos || {}; const ks = Object.keys(ROT).filter(k => e[k]);
  if (!ks.length) return '<p class="lead" style="margin:0 0 8px;font-size:14px">Nenhum CNPJ, nº de série ou O.S. encontrado na conversa ainda. O portal relê a conversa a cada 5 minutos.</p>';
  return `<div style="margin:0 0 8px"><b style="font-size:12px;color:var(--muted);text-transform:uppercase">Encontrado na conversa</b><div class="fichamini" style="margin-top:4px">${ks.map(k => `<span title="${esc(d.fontes?.[k] || "")}"><b>${ROT[k]}:</b> ${esc(e[k])}</span>`).join("")}</div></div>`;
}
function proximoPasso() {
  const passos = [];
  if (!A.bitrix_sessao && A.canal === "Bitrix") passos.push(["Vincular a conversa do Bitrix", null]);
  if (!A.tipo || !A.modelo) passos.push(["Identificar modelo e tipo", "#identificacao"]);
  if (!Object.keys(A.testes || {}).length) passos.push(["Fazer os testes básicos com o cliente", "#testes"]);
  if (A.tipo === "Venda fora de garantia" && !A.orcamento_visita) passos.push(["Enviar orçamento de visita (se não resolver)", "#fora-garantia"]);
  else if (A.tipo && A.tipo !== "Venda fora de garantia" && !A.os_numero && !FINAIS.includes(A.status)) passos.push(["Se não resolveu: abrir chamado no Infraspeak", "#chamado"]);
  if (A.os_numero && !FINAIS.includes(A.status)) passos.push(["Acompanhar a O.S. e cobrar o técnico", "#acompanhamento"]);
  if (A.os_status === "fechada" && A.status !== "finalizado") passos.push(["O.S. fechada: finalizar e fazer o pós-atendimento", "#acompanhamento"]);
  if (A.status === "finalizado" && !A.pos_atendimento) passos.push(["Pós-atendimento e nota do técnico", "#acompanhamento"]);
  if (!passos.length) return '<p class="lead" style="margin:0">Nada pendente.</p>';
  return '<ol class="clean" style="padding-left:20px">' + passos.map(([t, h]) => `<li>${h ? `<a href="${h}">${t}</a>` : t}</li>`).join("") + "</ol>";
}
$("#btnAtual").onclick = () => { location.hash = A ? "atendimento" : "atendimentos"; };
$("#atStatus").onchange = () => mudarStatus($("#atStatus").value);
$$("[data-st]").forEach(b => b.onclick = () => mudarStatus(b.dataset.st));
function mudarStatus(st) {
  if (!A || !podeEditar(A)) return;
  if (st === "finalizado" && A.tipo && A.tipo !== "Venda fora de garantia" && !A.os_numero && !confirmarInline("Sem nº de O.S. informado. Finalizar mesmo assim? Clique de novo para confirmar.")) return;
  patch({ status: st }, true); renderAll(true);
  toast("Status: " + STATUS[st]);
}
let confirmKey = null;
function confirmarInline(msg) { if (confirmKey === msg) { confirmKey = null; return true; } confirmKey = msg; toast(msg); setTimeout(() => confirmKey = null, 5000); return false; }

/* Bitrix */
async function vincularBitrix() {
  if (!A) return;
  const numero = $("#bxNumero").value.trim(); $("#bxErr").textContent = "";
  if (!numero) { $("#bxErr").textContent = "Informe o nº da conversa."; return; }
  await flush();
  $("#bxVincular").disabled = true; $("#bxVincular").textContent = "Buscando…";
  try {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch("/api/bitrix/vincular", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token }, body: JSON.stringify({ atendimento_id: A.id, numero }) });
    const j = await r.json().catch(() => ({ erro: "Resposta inválida do servidor" }));
    if (!r.ok) throw new Error(j.erro || j.errorMessage || `Falha ao vincular (erro ${r.status})`);
    A = { ...j.atendimento }; const i = lista.findIndex(x => x.id === A.id); if (i >= 0) lista[i] = j.atendimento;
    toast(j.capturados?.length ? "Capturado: " + j.capturados.join(", ") : "Conversa lida · nenhum dado novo"); renderAll(true); carregarEventos();
  } catch (e) { $("#bxErr").textContent = e.message; }
  $("#bxVincular").disabled = false; $("#bxVincular").textContent = "Vincular";
}
$("#bxVincular").onclick = vincularBitrix;
$("#bxNumero").addEventListener("keydown", e => { if (e.key === "Enter") vincularBitrix(); });

/* Histórico */
async function carregarEventos() {
  if (!A) { $("#timeline").innerHTML = ""; return; }
  const { data } = await sb.from("atendimento_eventos").select("*").eq("atendimento_id", A.id).order("id", { ascending: false }).limit(100);
  $("#timeline").innerHTML = (data || []).map(e => `<div class="ev"><small>${fmtDH(e.created_at)}</small><div>${esc(e.descricao)}${e.autor && perfis[e.autor] ? ` <small>· ${esc(perfis[e.autor].nome)}</small>` : ""}</div></div>`).join("") || '<p class="lead">Sem eventos.</p>';
}
$("#btnNota").onclick = async () => {
  const t = $("#nota").value.trim(); if (!t || !A) return;
  const { error } = await sb.from("atendimento_eventos").insert({ atendimento_id: A.id, autor: me.id, tipo: "nota", descricao: t });
  if (error) { toast(error.message); return; }
  $("#nota").value = ""; if (podeEditar(A)) patch({ observacoes: A.observacoes }, true); carregarEventos();
};

/* ================= MINHAS CONVERSAS ================= */
let conversas = [], cvFiltro = "", cvPessoa = null;
const CV = {
  sem_resposta: ["Sem resposta há +4 h", "var(--crit)", "crit"], promessa: ["Promessa pendente", "var(--warn)", "warn"],
  nova: ["Novas", "var(--info)", "info"], chamado: ["Chamado a atualizar", "#7a4fd0", "warn"],
  responder: ["Cliente aguardando", "var(--leaf)", ""], em_dia: ["Em dia", "var(--line)", "ok"],
};
const ORDEM_CV = ["sem_resposta", "promessa", "nova", "chamado", "responder", "em_dia"];
function haQuanto(d) { if (!d) return ""; const m = Math.max(0, Math.round((Date.now() - Date.parse(d)) / 60000)); return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60 ? (m % 60) + " min" : ""}`.trim() : `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`; }
async function carregarConversas() {
  if (!me) return;
  const { data, error } = await sb.from("bitrix_sessoes").select("*").eq("encerrada", false).not("operador", "is", null).not("situacao", "is", null).order("ultima_msg_em", { ascending: false }).limit(500);
  if (error) { $("#cvAtual").textContent = "Aba indisponível: rode o supabase/003_conversas.sql. (" + error.message + ")"; return; }
  conversas = data || []; renderConversas();
}
function renderConversas() {
  if (!me) return;
  const sel = $("#cvPessoa");
  if (isSup()) {
    if (!sel.options.length) { sel.innerHTML = `<option value="">Toda a equipe</option>` + auxiliaresEquipe().map(p => `<option value="${p.id}"${p.id === me.id ? " selected" : ""}>${esc(p.nome)}</option>`).join(""); sel.onchange = renderConversas; }
    cvPessoa = sel.value || null;
  } else cvPessoa = me.id;
  const minhas = conversas.filter(c => !cvPessoa || c.operador === cvPessoa);
  const urg = conversas.filter(c => c.operador === me.id && ["sem_resposta", "promessa", "nova", "chamado"].includes(c.situacao)).length;
  $("#navConv").hidden = !urg; $("#navConv").textContent = urg;
  const cnt = k => minhas.filter(c => c.situacao === k).length;
  $("#cvKpis").innerHTML = ORDEM_CV.map(k => `<div class="kpi clicavel ${CV[k][2] === "crit" && cnt(k) ? "alerta" : CV[k][2] === "warn" && cnt(k) ? "warn" : k === "em_dia" ? "ok" : "info"}${cvFiltro === k ? " sel" : ""}" data-cv="${k}" role="button" tabindex="0"><span>${CV[k][0]}</span><b class="v">${cnt(k)}</b></div>`).join("");
  $$("#cvKpis [data-cv]").forEach(e => e.onclick = () => { cvFiltro = cvFiltro === e.dataset.cv ? "" : e.dataset.cv; renderConversas(); });
  const grupos = ORDEM_CV.filter(k => !cvFiltro || k === cvFiltro).map(k => {
    const itens = minhas.filter(c => c.situacao === k).sort((a, b) => Date.parse(a.cliente_desde || a.ultima_msg_em || 0) - Date.parse(b.cliente_desde || b.ultima_msg_em || 0));
    if (!itens.length) return "";
    const aberto = k !== "em_dia" || cvFiltro === "em_dia";
    return `<details class="card" ${aberto ? "open" : ""}><summary style="cursor:pointer;font-family:var(--display);font-weight:700;font-size:18px">${CV[k][0]} · ${itens.length}</summary><div>${itens.map(c => linhaConversa(c, k)).join("")}</div></details>`;
  }).join("");
  $("#cvGrupos").innerHTML = grupos || '<div class="card"><p class="lead" style="margin:0">Nenhuma conversa aberta no momento.</p></div>';
  const ult = conversas.map(c => c.atualizada_em).filter(Boolean).sort().at(-1);
  $("#cvAtual").textContent = ult ? `Atualizado há ${haQuanto(ult)}.` : "";
}
function linhaConversa(c, k) {
  const at = c.atendimento_id ? lista.find(a => a.id === c.atendimento_id) : lista.find(a => a.bitrix_sessao === c.sessao && !FINAIS.includes(a.status));
  const espera = k === "sem_resposta" || k === "responder" || k === "nova" ? `cliente esperando há ${haQuanto(c.cliente_desde || c.ultima_msg_em)}` : k === "promessa" ? `prometido há ${haQuanto(c.ultima_msg_em)}` : k === "chamado" ? `última atualização há ${haQuanto(c.ultima_resposta_em)}` : `última mensagem há ${haQuanto(c.ultima_msg_em)}`;
  return `<div class="cv"><span class="bar" style="background:${CV[k][1]}"></span>
    <div><div class="tt"><b>${esc(c.cliente || c.nome || "Cliente")}</b><span class="pill">nº ${c.sessao}</span>${at ? `<span class="pill ok">#${at.id}${at.os_numero ? " · O.S. " + esc(at.os_numero) : ""}</span>` : ""}${isSup() && !cvPessoa ? `<span class="pill">${esc(perfis[c.operador]?.nome || "")}</span>` : ""}<span class="salvo">${espera}</span></div>
    <div class="txt">${esc(c.ultimo_texto || "(arquivo, áudio ou imagem)")}</div></div>
    <div class="acoes"><a class="btn sm" href="https://nebulize.bitrix24.com.br/online/?IM_DIALOG=chat${c.chat_id}" target="_blank" rel="noopener">Abrir no Bitrix</a>
    ${at ? `<button class="btn sm" type="button" data-cvat="${at.id}">Atendimento</button>` : `<button class="btn sm" type="button" data-cvreg="${c.sessao}">Registrar</button>`}
    ${k !== "em_dia" ? `<button class="btn sm pri" type="button" data-cvok="${c.sessao}">✓ Resolvido</button>` : ""}</div></div>`;
}
$("#cvGrupos").addEventListener("click", async e => {
  const a = e.target.closest("[data-cvat]"); if (a) return abrirAtendimento(Number(a.dataset.cvat), true);
  const r = e.target.closest("[data-cvreg]");
  if (r) { abrirNovo(); $("#n_bitrix").value = r.dataset.cvreg; $("#n_canal").value = "Bitrix"; return; }
  const ok = e.target.closest("[data-cvok]");
  if (ok) {
    const c = conversas.find(x => x.sessao === Number(ok.dataset.cvok)); if (!c) return;
    const { error } = await sb.from("bitrix_sessoes").update({ resolvido_msg_id: c.ultimo_msg_id, situacao: "em_dia" }).eq("sessao", c.sessao);
    if (error) { toast(error.message); return; }
    c.resolvido_msg_id = c.ultimo_msg_id; c.situacao = "em_dia"; renderConversas(); toast("Marcada como resolvida até chegar mensagem nova");
  }
});
const auxiliaresEquipe = () => Object.values(perfis).filter(p => p.ativo);
setInterval(() => { if (me && location.hash === "#conversas") carregarConversas(); }, 60000);

/* ================= NOTIFICAÇÕES ================= */
async function carregarNotifs() {
  const { data } = await sb.from("notificacoes").select("*").eq("usuario_id", me.id).order("id", { ascending: false }).limit(50);
  notifs = data || []; renderNotifs();
}
function renderNotifs() {
  const n = notifs.filter(x => !x.lida).length;
  $("#bellCnt").hidden = !n; $("#bellCnt").textContent = n > 99 ? "99+" : n;
  $("#notifBox").innerHTML = `<div class="it" style="flex-direction:row;justify-content:space-between;cursor:default"><b>Notificações</b>${n ? '<button class="btn sm" type="button" id="lerTodas">Marcar todas como lidas</button>' : ""}</div>` +
    (notifs.map(x => `<div class="it${x.lida ? "" : " nl"}" data-nid="${x.id}"><b>${esc(x.titulo)}</b>${x.mensagem ? `<span style="font-size:14px">${esc(x.mensagem)}</span>` : ""}<small>${fmtDH(x.created_at)}</small></div>`).join("") || '<div class="it"><small>Nenhuma notificação.</small></div>');
  const lt = $("#lerTodas"); if (lt) lt.onclick = async ev => { ev.stopPropagation(); await sb.from("notificacoes").update({ lida: true }).eq("usuario_id", me.id).eq("lida", false); notifs.forEach(x => x.lida = true); renderNotifs(); };
}
$("#btnBell").onclick = e => { e.stopPropagation(); $("#notifBox").classList.toggle("on"); };
document.addEventListener("click", e => { if (!e.target.closest("#notifBox") && !e.target.closest("#btnBell")) $("#notifBox").classList.remove("on"); });
$("#notifBox").addEventListener("click", async e => {
  const it = e.target.closest("[data-nid]"); if (!it) return;
  const n = notifs.find(x => x.id === Number(it.dataset.nid)); if (!n) return;
  if (!n.lida) { n.lida = true; sb.from("notificacoes").update({ lida: true }).eq("id", n.id).then(() => {}); }
  $("#notifBox").classList.remove("on"); renderNotifs();
  if (n.atendimento_id) abrirAtendimento(n.atendimento_id, true); else location.hash = "atendimentos";
});
function assinarRealtime() {
  sb.channel("notif-" + me.id).on("postgres_changes", { event: "INSERT", schema: "public", table: "notificacoes", filter: `usuario_id=eq.${me.id}` }, p => {
    notifs.unshift(p.new); renderNotifs(); toast(p.new.titulo);
    try { if ("Notification" in window && Notification.permission === "granted") new Notification(p.new.titulo, { body: p.new.mensagem || "", icon: LOGO }); } catch (e) {}
    if (p.new.atendimento_id) carregarLista().then(() => { if (A && A.id === p.new.atendimento_id) abrirAtendimento(A.id, false); else renderLista(); });
  }).subscribe();
  sb.channel("conversas").on("postgres_changes", { event: "*", schema: "public", table: "bitrix_sessoes" }, () => { clearTimeout(window._cvT); window._cvT = setTimeout(carregarConversas, 1500); }).subscribe();
}
// lembrete local: a cada 30 min, se houver atendimentos meus parados há 3+ dias
setInterval(() => {
  if (!me) return;
  const p = lista.filter(a => a.criado_por === me.id && !FINAIS.includes(a.status) && diasParado(a) >= 3).length;
  if (p) { toast(`${p} atendimento(s) parado(s) há mais de 3 dias`); try { if (Notification.permission === "granted" && document.hidden) new Notification("Atendimentos parados", { body: `Você tem ${p} atendimento(s) sem atualização há mais de 3 dias.`, icon: LOGO }); } catch (e) {} }
}, 30 * 60 * 1000);

/* ================= GUIA (scripts, testes, chamado...) ================= */
function scriptHTML(items) { return items.map(it => it.a ? `<div class="act">${esc(it.a)}</div>` : `<div class="msg" data-m="${esc(it.m)}"></div>`).join(""); }
function hydrate(root) { root.querySelectorAll(".msg[data-m]").forEach(el => msgBox(el, el.dataset.m)); }
function visitaMsg(t) {
  const val = t === "completa" ? "R$ 590,00" : "R$ 390,00", desc = t === "completa" ? "análise e limpeza completa" : "análise e limpeza simples";
  return `Certo! Como se trata de uma máquina adquirida por venda e fora do período de garantia, os serviços de manutenção são cobrados. O valor da visita técnica, que inclui ${desc} e o diagnóstico do defeito, é de ${val}. Segue o orçamento.\n\nCaso o técnico identifique a necessidade de substituição de algum componente, enviaremos um segundo orçamento com os valores das peças para aprovação antes da execução do serviço.\n\nPara agendarmos, preciso que confirme:\n• Aprovação do orçamento\n• CNPJ para cobrança\n• E-mail para envio das notas\n• Endereço completo onde a máquina está instalada`;
}
const pecasMsg = () => "O técnico realizou a vistoria e os testes necessários no equipamento.\nFoi constatada a necessidade de substituição dos componentes listados no orçamento em anexo.\n\nFicamos no aguardo da aprovação para dar continuidade ao atendimento.";
const FIM_MSG = "O atendimento foi concluído com sucesso.\nEncaminho, em anexo, o relatório técnico referente à visita realizada.\nCaso precise de apoio é só me acionar. ✓";

function renderScripts() {
  const nome = v("atendente", me?.nome || "[seu nome]");
  $("#scriptInicio").innerHTML = scriptHTML([{ m: `Olá, tudo bem? Você está falando com o Suporte Técnico Nebulize, me chamo ${nome}. Como posso te ajudar?` }, { a: "Cliente relata a solicitação" }]);
  hydrate($("#scriptInicio"));
  const os = v("os_numero", "XXXXXXXXX");
  const loc = [
    { m: "Certo! Para darmos sequência na abertura do chamado, precisamos de um vídeo do painel do equipamento ligado, para análise e diagnóstico." },
    { a: "Cliente envia o vídeo" }, { a: "Analise o vídeo e faça os testes básicos para ver se é possível resolver remotamente" }, { a: "Se for necessário enviar a equipe:" },
    { m: "Identificamos o defeito. Você pode, por gentileza, confirmar o endereço completo do local para que possamos seguir com a abertura da ordem de serviço?" },
    { a: "Abra o chamado no Infraspeak associando o nº da conversa" },
    { m: `A ordem de serviço nº ${os} foi aberta e incluída na rota do técnico responsável pela região.\n\nO prazo máximo para atendimento é de até 3 dias úteis, mas sempre buscamos realizar o atendimento com a maior agilidade possível.` },
    { m: "Imagina! Se precisar de algo, é só me chamar. Estou à disposição." },
    { a: "Após o fechamento pela equipe técnica, envie a finalização com o relatório assinado do Infraspeak" }, { m: FIM_MSG }, { a: "Encerre a conversa no Bitrix e finalize o atendimento no portal" }];
  const ven = [
    { a: "Antes, faça os testes básicos. Se a máquina estiver em garantia, siga o fluxo de chamado (igual à locação). Fora de garantia:" },
    { m: visitaMsg("simples") }, { a: "Cliente concorda e solicita atendimento" },
    { m: "Precisamos dos dados da loja para faturamento (CNPJ), o e-mail para envio do boleto e das notas e o endereço completo onde a máquina está instalada.\n\nCom a ordem sendo aberta hoje, o técnico tem o prazo de até 3 dias úteis para realizar o atendimento no local. Caso o orçamento das peças seja aprovado de imediato, a manutenção será realizada no mesmo momento." },
    { a: "Abra o chamado de Visita Técnica, associe o orçamento de visita e encaminhe ao financeiro" },
    { a: "Se for necessário trocar componentes, gere o orçamento de peças e envie para aprovação:" }, { m: pecasMsg() },
    { a: "Cliente aprova: gere o orçamento de peças, associe ao chamado de corretiva e encaminhe ao financeiro" },
    { a: "Após o fechamento pela equipe técnica, envie a finalização com o relatório assinado do Infraspeak" }, { m: FIM_MSG }, { a: "Encerre a conversa no Bitrix e finalize o atendimento no portal" }];
  $$("#scriptTabs .tab").forEach(x => x.classList.toggle("on", x.dataset.s === ui.script));
  $("#scriptBody").innerHTML = scriptHTML(ui.script === "venda" ? ven : loc); hydrate($("#scriptBody"));
}
$("#scriptTabs").onclick = e => { const b = e.target.closest(".tab"); if (!b) return; ui.script = b.dataset.s; saveUi(); renderScripts(); };

/* identificação + garantia */
const GAR = { nb400: 12, nb100s: 12, nb6c: 12, nbi: 6, outros: 6 };
const TIPOS_DESC = [["Aluguel", "Manutenção sem custo ao cliente"], ["Venda em garantia", "Dentro do prazo da NF"], ["Venda fora de garantia", "Serviço cobrado"]];
function semAtendimentoAviso() { return A ? "" : '<div class="note warn"><b>Nenhum atendimento aberto</b>Registre o atendimento para gravar as escolhas. <button class="btn sm" type="button" data-novo>+ Registrar</button></div>'; }
function renderIdent() {
  const pm = $("#pickModel"); pm.innerHTML = "";
  Object.entries(MODELS).forEach(([k, m]) => { const b = document.createElement("button"); b.type = "button"; b.innerHTML = `<b>${esc(m.name)}</b><span>${esc(m.desc)}</span>`; b.classList.toggle("on", F("modelo") === m.name); b.onclick = () => { ui.model = k; saveUi(); patch({ modelo: m.name }, true); renderAll(true); }; pm.appendChild(b); });
  const pt = $("#pickTipo"); pt.innerHTML = "";
  TIPOS_DESC.forEach(([t, d]) => { const b = document.createElement("button"); b.type = "button"; b.innerHTML = `<b>${t}</b><span>${d}</span>`; b.classList.toggle("on", F("tipo") === t); b.onclick = () => { patch({ tipo: t }, true); renderAll(true); }; pt.appendChild(b); });
  msgBox($("#msgVideo"), "Para seguirmos com a análise, você pode, por gentileza, enviar um vídeo do painel do equipamento ligado e uma foto da etiqueta com o modelo e o número de série?");
  const t = F("tipo"), st = x => `<span class="st" style="background:var(--card);border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:6px 10px;font-size:14px">${x}</span>`, ar = '<span class="ar">→</span>';
  let h = semAtendimentoAviso();
  if (!t) h += '<p class="lead" style="margin:0">Selecione o tipo para ver o caminho.</p>';
  else if (t === "Venda fora de garantia") h += `<div class="route">${st("Recepção")}${ar}${st("Testes básicos")}${ar}${st("Orçamento de visita no Softdib")}${ar}${st("Aprovação + CNPJ + e-mail + endereço")}${ar}${st("Chamado de Visita Técnica")}${ar}${st("2º orçamento (peças)")}${ar}${st("Pós-atendimento + NF 108")}</div><div style="margin-top:12px"><a class="btn pri" href="#testes">Ir para os testes</a> <a class="btn" href="#fora-garantia">Ver orçamento</a></div>`;
  else h += `<div class="route">${st("Recepção")}${ar}${st("Testes básicos")}${ar}${st("Chamado no Infraspeak")}${ar}${st("Agendar técnico da região")}${ar}${st("Acompanhar até o fechamento")}${ar}${st("Pós-atendimento + relatório")}</div><div style="margin-top:12px"><a class="btn pri" href="#testes">Ir para os testes</a> <a class="btn" href="#chamado">Ver chamado</a></div>`;
  $("#routeOut").innerHTML = h;
  if (!$("#nfData").matches(":focus")) $("#nfData").value = F("nf_data");
  renderGar();
}
$("#nfData").addEventListener("change", () => { patch({ nf_data: $("#nfData").value || null }, true); renderGar(); });
function renderGar() {
  const d = $("#nfData").value, m = GAR[ui.model], o = $("#garOut");
  if (!F("modelo")) { o.innerHTML = '<span class="lead">Escolha o modelo acima.</span>'; return; }
  if (!m) { o.innerHTML = '<div class="gate no">Modelo sem prazo cadastrado: consulte o Supervisor.</div>'; return; }
  if (!d) { o.innerHTML = `<span class="lead">Garantia de ${m === 12 ? "1 ano" : "6 meses"} para ${esc(F("modelo"))}. Informe a data da NF.</span>`; return; }
  const nf = new Date(d + "T00:00:00"), fim = new Date(nf); fim.setMonth(fim.getMonth() + m);
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0); const dentro = hoje <= fim;
  const certo = dentro ? "Venda em garantia" : "Venda fora de garantia";
  o.innerHTML = `<div class="gate ${dentro ? "yes" : "no"}">${dentro ? "Dentro da garantia" : "Fora da garantia"} · vale até ${fim.toLocaleDateString("pt-BR")}</div>` +
    (F("tipo") !== "Aluguel" && F("tipo") !== certo ? `<button class="btn sm" type="button" id="garFix" style="margin-top:6px">Marcar como ${certo}</button>` : "");
  const b = $("#garFix"); if (b) b.onclick = () => { patch({ tipo: certo }, true); renderAll(true); };
}

/* testes */
const tkey = (m, i, j) => m + "|" + i + "|" + j;
function vidHTML(ids) { return ids.map(id => { const [l, u] = V[id]; return `<div class="vid"><span class="pill info">Vídeo</span><a href="${u}" target="_blank" rel="noopener">${esc(l)}</a><button class="btn sm" type="button" data-cl="${u}">Copiar link</button><button class="btn sm" type="button" data-cm="${id}">Copiar mensagem</button></div>`; }).join(""); }
function chkHTML(key, label, shown) { const c = !!(A?.testes || {})[key]; return `<label class="chk${c ? " done" : ""}"><input type="checkbox" data-k="${esc(key)}" data-l="${esc(label)}"${c ? " checked" : ""}><span>${esc(shown || label)}</span></label>`; }
document.addEventListener("change", e => {
  const i = e.target.closest("input[data-k]"); if (!i) return;
  if (!A) { i.checked = false; toast("Registre ou abra um atendimento para marcar os testes"); return; }
  const t = { ...(A.testes || {}) }; if (i.checked) t[i.dataset.k] = i.dataset.l; else delete t[i.dataset.k];
  i.parentElement.classList.toggle("done", i.checked); patch({ testes: t }); renderChamado(); renderSup();
});
function renderTests() {
  const tabs = $("#testModelTabs"); tabs.innerHTML = "";
  Object.entries(MODELS).forEach(([k, m]) => { const b = document.createElement("button"); b.type = "button"; b.className = "tab" + (ui.model === k ? " on" : ""); b.textContent = m.name; b.onclick = () => { ui.model = k; saveUi(); renderTests(); }; tabs.appendChild(b); });
  $("#testsGeral").innerHTML = semAtendimentoAviso() + GERAL.map((g, i) => chkHTML(tkey("geral", i, 0), g)).join("");
  const m = MODELS[ui.model]; $("#symTitle").textContent = "Sintomas · " + m.name;
  const q = ($("#symSearch").value || "").toLowerCase();
  $("#symList").innerHTML = m.syms.map((s, i) => {
    const hay = (s.t + " " + s.ask.join(" ") + " " + s.next).toLowerCase(); if (q && !hay.includes(q)) return "";
    return `<details class="sym"${q ? " open" : ""}><summary><span class="sev" style="background:${SEVC[s.s]}"></span>${esc(s.t)}<span class="pill ${s.s}" style="margin-left:8px">${SEVL[s.s]}</span></summary><div class="bd">
      <div><b style="font-size:13px;color:var(--muted)">PEÇA AO CLIENTE PARA CONFERIR</b>${s.ask.map((a, j) => chkHTML(tkey(ui.model, i, j), s.t + ": " + a, a)).join("")}</div>
      ${s.ok ? `<div class="note ok"><b>Normal</b>${esc(s.ok)}</div>` : ""}
      <div class="note crit"><b>Se não resolver</b>${esc(s.next)}</div>${s.vid.length ? vidHTML(s.vid) : ""}</div></details>`;
  }).join("") || '<p class="lead">Nenhum sintoma encontrado para esta busca.</p>';
  const r = REF[ui.model];
  $("#refTec").innerHTML = r.length ? `<div class="tw"><table><thead><tr><th>Ponto</th><th>Escala</th><th>Esperado</th></tr></thead><tbody>${r.map(x => `<tr><td>${esc(x[0])}</td><td>${esc(x[1])}</td><td class="num">${esc(x[2])}</td></tr>`).join("")}</tbody></table></div><p class="lead" style="margin-top:8px">Troca de peças só com a máquina desligada, cabo fora da tomada e disjuntor desligado.</p>` : '<p class="lead">Pontos de medição pendentes do manual. Consulte o Supervisor.</p>';
}
$("#symSearch").oninput = renderTests;

/* chamado */
function renderChamado() {
  const req = [
    ["Nome do cliente / loja", !!F("cliente")], ["Nº da conversa ou telefone", !!(F("contato") || A?.bitrix_sessao)],
    ["Motivo da abertura em texto", !!F("motivo")], ["Vídeo da primeira análise", !!A?.video_recebido],
    ["Modelo e tipo (aluguel / venda em garantia)", !!F("modelo") && !!F("tipo")], ["Endereço confirmado", !!F("endereco")],
  ];
  $("#reqList").innerHTML = semAtendimentoAviso() + req.map(([l, ok]) => `<div class="chk"><span class="pill ${ok ? "ok" : "crit"}" style="min-width:74px;text-align:center">${ok ? "OK" : "Falta"}</span><span>${l}</span></div>`).join("") + '<p class="lead" style="margin:6px 0 0">Preencha em <a href="#atendimento">Atendimento atual</a>.</p>';
  const all = req.every(x => x[1]);
  $("#reqGate").innerHTML = `<div class="gate ${all ? "yes" : "no"}">${all ? "Tudo pronto para abrir o chamado." : "Complete os campos marcados como Falta antes de abrir."}</div>` +
    (F("tipo") === "Venda fora de garantia" ? `<div class="note warn" style="margin-top:8px"><b>Venda fora de garantia</b>Antes do chamado, siga a <a href="#fora-garantia">liberação por orçamento</a>.</div>` : "");
  if (!$("#motivo").matches(":focus")) $("#motivo").value = F("motivo");
  const testes = Object.values(A?.testes || {});
  $("#chamadoOut").textContent = `CLIENTE: ${v("cliente", "[nome do cliente]")}
CONTATO: ${A?.bitrix_sessao ? "Conversa Bitrix nº " + A.bitrix_sessao + (A.bitrix_dados?.telefone ? " · " + A.bitrix_dados.telefone : "") : v("contato", "[nº conversa Bitrix ou telefone]")} (canal: ${v("canal", "Bitrix")})
EQUIPAMENTO: ${v("modelo", "[modelo]")} · ${v("tipo", "[aluguel / venda em garantia]")}${F("numero_serie") ? " · Nº de série " + F("numero_serie") : ""}
ENDEREÇO: ${v("endereco", "[endereço completo]")}

MOTIVO DA ABERTURA:
${F("motivo") || "[descreva o defeito relatado]"}

TESTES REALIZADOS COM O CLIENTE:
${testes.length ? testes.map(t => "- " + t).join("\n") : "- [marque os testes na etapa 3]"}

VÍDEO DA PRIMEIRA ANÁLISE: ${A?.video_recebido ? "anexado" : "[anexar]"}
ATENDENTE: ${v("atendente", me?.nome || "[seu nome]")}${A ? " · Portal #" + A.id : ""}`;
  msgBox($("#msgOS"), `A ordem de serviço nº ${v("os_numero", "XXXXXXXXX")} foi aberta e incluída na rota do técnico responsável pela região.\n\nO prazo máximo para atendimento é de até 3 dias úteis, mas sempre buscamos realizar o atendimento com a maior agilidade possível.`);
}
$("#motivo").addEventListener("input", () => { patch({ motivo: $("#motivo").value || null }); renderChamado(); });

/* fora de garantia */
const GATE = ["Orçamento de visita gerado no Softdib e enviado", "Cliente aprovou o orçamento", "CNPJ da cobrança confirmado", "E-mail para envio das notas confirmado", "Endereço onde a máquina está instalada confirmado"];
function renderFora() {
  $$("#visitTabs .tab").forEach(x => x.classList.toggle("on", x.dataset.t === (A?.orcamento_visita || ui.visita)));
  msgBox($("#msgVisita"), visitaMsg(A?.orcamento_visita || ui.visita));
  const gate = A?.checklist?.gate || {};
  const auto = [null, null, !!F("cnpj"), !!F("email_nf"), !!F("endereco")];
  $("#gateList").innerHTML = semAtendimentoAviso() + GATE.map((g, i) => { const c = !!gate[i] || auto[i] === true; return `<label class="chk${c ? " done" : ""}"><input type="checkbox" data-g="${i}"${c ? " checked" : ""}><span>${g}${auto[i] !== null ? ' <span class="pill" style="margin-left:4px">do atendimento</span>' : ""}</span></label>`; }).join("");
  $$("#gateList input[data-g]").forEach(i => i.onchange = () => { if (!A) { i.checked = false; return; } const ck = { ...(A.checklist || {}) }; ck.gate = { ...(ck.gate || {}), [i.dataset.g]: i.checked }; patch({ checklist: ck }, true); renderFora(); });
  const ok = GATE.every((g, i) => !!gate[i] || auto[i] === true);
  $("#gateOut").innerHTML = `<div class="gate ${ok ? "yes" : "no"}">${ok ? "Liberado: pode agendar o técnico." : "Não envie o técnico ainda. Faltam itens acima."}</div>`;
  msgBox($("#msgPecas"), pecasMsg());
}
$("#visitTabs").onclick = e => { const b = e.target.closest(".tab"); if (!b) return; ui.visita = b.dataset.t; saveUi(); if (A) patch({ orcamento_visita: b.dataset.t }, true); renderFora(); };

/* acompanhamento */
const AC = () => ({
  "Atualizar cliente": `Olá, ${v("cliente", "[cliente]")}! Passando para atualizar sobre a ordem de serviço nº ${v("os_numero", "XXXX")}: [status: técnico agendado para dd/mm / peça a caminho / visita realizada]. Seguimos acompanhando e te aviso a cada novidade.`,
  "Cobrar técnico": `Olá, ${v("tecnico", "[técnico]")}! Tudo bem? Sobre a O.S. nº ${v("os_numero", "XXXX")} do cliente ${v("cliente", "[cliente]")} (${v("endereco", "[endereço]")}): o prazo de atendimento é de até 3 dias úteis. Consegue me confirmar a data e o horário da visita?`,
  "Técnico sem resposta": `Olá, ${v("tecnico", "[técnico]")}. Ainda não tivemos retorno sobre a O.S. nº ${v("os_numero", "XXXX")} (${v("cliente", "[cliente]")}). Precisamos de uma resposta hoje para não estourar o prazo do cliente; sem retorno, vamos direcionar para outro técnico.`,
  "Peça enviada": `Olá, ${v("tecnico", "[técnico]")}! O pedido de peças da O.S. nº ${v("os_numero", "XXXX")} (${v("cliente", "[cliente]")}) foi feito no Softdib com urgência. Assim que tiver o rastreio, te envio. Me avise quando receber para agendarmos a visita.`,
});
function renderAc() {
  const m = AC(); ui.ac = m[ui.ac] ? ui.ac : Object.keys(m)[0];
  $("#acTabs").innerHTML = Object.keys(m).map(k => `<button type="button" class="tab${k === ui.ac ? " on" : ""}" data-a="${k}">${k}</button>`).join("");
  $("#acTabs").onclick = e => { const b = e.target.closest(".tab"); if (!b) return; ui.ac = b.dataset.a; saveUi(); renderAc(); };
  msgBox($("#acMsg"), m[ui.ac]); msgBox($("#msgFim"), FIM_MSG);
  msgBox($("#msgPos"), `Olá, ${v("cliente", "[cliente]")}! Aqui é ${v("atendente", me?.nome || "[seu nome]")}, do Suporte Técnico Nebulize. Gostaríamos de saber como foi o atendimento da O.S. nº ${v("os_numero", "XXXX")}.\n\nDe 1 a 5, qual nota você dá para o atendimento? O equipamento está funcionando bem?\n\nSua opinião nos ajuda a melhorar. Obrigado!`);
}

/* e-mails */
function renderMails() {
  const at = v("atendente", me?.nome || "[seu nome]");
  const cards = [
    { t: "Peças para técnicos", code: "131 · 165", sub: "131 = simples remessa · 165 = baixa de estoque", to: "logistica@nebulize.com.br; administrativo@nebulize.com.br", cc: "", subj: `Envio de peças para técnico · O.S. ${v("os_numero", "XXXX")} · ${v("cliente", "[cliente]")}`, body: `Olá, equipe!\n\nSolicito o envio das peças abaixo para o técnico ${v("tecnico", "[técnico]")}, referente à O.S. nº ${v("os_numero", "XXXX")} do cliente ${v("cliente", "[cliente]")}.\n\nCódigo da operação: [131 simples remessa / 165 baixa de estoque]\nPedido Softdib nº: [nº]\nPeças: [código · descrição · quantidade]\nEndereço de entrega do técnico: [endereço]\n\nURGENTE: técnico aguardando a peça para finalizar o atendimento.\n\nObrigado(a),\n${at} · Suporte Técnico Nebulize` },
    { t: "Revenda de peças para cliente", code: "102", sub: "Venda de peças ao cliente", to: "logistica@nebulize.com.br; administrativo@nebulize.com.br", cc: "", subj: `Revenda de peças · ${v("cliente", "[cliente]")}`, body: `Olá, equipe!\n\nSegue pedido de revenda de peças para o cliente ${v("cliente", "[cliente]")}.\n\nCódigo da operação: 102\nPedido Softdib nº: [nº]\nCNPJ: ${v("cnpj", "[CNPJ]")}\nE-mail para nota: ${v("email_nf", "[e-mail]")}\nEndereço de entrega: ${v("endereco", "[endereço]")}\nPeças: [código · descrição · quantidade]\n\nObrigado(a),\n${at} · Suporte Técnico Nebulize` },
    { t: "Nota de serviço", code: "108", sub: "NF de serviço gerada no Softdib", to: v("email_nf", "[e-mail fornecido pelo cliente]"), cc: "financeiro@nebulize.com.br", subj: `Nota fiscal de serviço · O.S. ${v("os_numero", "XXXX")} · ${v("cliente", "[cliente]")}`, body: `Olá, ${v("cliente", "[cliente]")}!\n\nSegue em anexo a nota fiscal referente ao serviço realizado na O.S. nº ${v("os_numero", "XXXX")}.\n\nQualquer dúvida, estamos à disposição.\n\nAtenciosamente,\n${at} · Suporte Técnico Nebulize` },
  ];
  $("#mailCards").innerHTML = cards.map((c, i) => `<div class="card" style="display:flex;flex-direction:column;gap:10px">
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><h2 style="margin:0">${c.t}</h2><span class="lead" style="font-size:14px">${c.sub}</span></div><span class="code">${c.code}</span></div>
    <dl class="mail"><dt>Para</dt><dd>${esc(c.to)} <button class="btn sm" type="button" data-mc="${i}|to">Copiar</button></dd>${c.cc ? `<dt>Cópia</dt><dd>${esc(c.cc)} <button class="btn sm" type="button" data-mc="${i}|cc">Copiar</button></dd>` : ""}<dt>Assunto</dt><dd>${esc(c.subj)}</dd></dl>
    <div class="out" style="font-size:14px">${esc(c.body)}</div><div><button class="btn pri" type="button" data-mc="${i}|all">Copiar assunto e texto</button></div></div>`).join("");
  $("#mailCards").onclick = e => { const b = e.target.closest("[data-mc]"); if (!b) return; const [i, w] = b.dataset.mc.split("|"); const c = cards[i]; copyText(w === "to" ? c.to : w === "cc" ? c.cc : `Assunto: ${c.subj}\n\n${c.body}`); };
}
function renderVideos() {
  const G = [["NB400 / NB800 · configuração e manutenção", ["instal400", "config400", "limpeza400"]], ["NB400 / NB800 · testes de erro", ["apagado", "standby", "semnevoa", "fraca", "semagua1", "semagua2", "transb", "grava", "botao"]], ["NB6C", ["cfg6c", "cfg6cav"]], ["NB100 / NB100S", ["cfg100s"]], ["Linha NBi e bancada ED120", ["ed120", "nbi1", "nbi2"]], ["Todos os modelos", ["filtro"]]];
  $("#vidList").innerHTML = G.map(([t, ids]) => `<div class="card"><h2>${t}</h2><div style="display:flex;flex-direction:column;gap:8px">${vidHTML(ids)}</div></div>`).join("") +
    `<div class="card"><h2>Máquina instalada em 3D</h2><p class="lead" style="margin:0 0 10px">Para mostrar ao cliente como fica o equipamento instalado na bancada ou câmara fria.</p><div class="vid"><a href="https://ferramentas-3d-nebulize.netlify.app" target="_blank" rel="noopener">Ferramentas 3D Nebulize</a><button class="btn sm" type="button" data-cl="https://ferramentas-3d-nebulize.netlify.app">Copiar link</button></div></div>`;
}
function renderNovos() {
  msgBox($("#msgRma"), `Olá, ${v("cliente", "[cliente]")}! Para enviar o equipamento para manutenção na fábrica, preencha o formulário de RMA neste link:\nhttps://rma-nebulize.netlify.app\n\nApós o preenchimento, envie o equipamento conforme as orientações do formulário. Avisaremos você em cada etapa: recebimento, manutenção e envio de volta.`);
  msgBox($("#msgNotaTec"), `Olá, ${v("tecnico", "[técnico]")}! Obrigado pelo atendimento da O.S. nº ${v("os_numero", "XXXX")} (${v("cliente", "[cliente]")}). Por favor, envie a nota do serviço pelo Portal do Técnico:\nhttps://portaldotecnico.nebulize.com.br/\n\nPedidos de peças também devem ser feitos por lá.`);
}
function renderSup() { msgBox($("#msgSup"), `Thalison, preciso de apoio em um atendimento:\n\nPortal: #${A?.id ?? "-"}\nCliente: ${v("cliente", "[cliente]")} · ${A?.bitrix_sessao ? "Bitrix nº " + A.bitrix_sessao : v("contato", "[conversa/telefone]")}\nEquipamento: ${v("modelo", "[modelo]")} · ${v("tipo", "[tipo]")}\nO.S.: ${v("os_numero", "[se houver]")}\nSituação: [descreva o que está fora do comum ou a dúvida técnica]\nJá testado: ${Object.values(A?.testes || {}).slice(0, 6).join("; ") || "[testes feitos]"}\n\nVídeo da análise em anexo.`); }

/* ================= DASHBOARD / RELATÓRIO ================= */
const mesAtual = () => new Date().toISOString().slice(0, 7);
$("#dMes").value = mesAtual(); $("#rMes").value = mesAtual();
function doMes(ym) { const [y, m] = ym.split("-").map(Number); const ini = new Date(y, m - 1, 1), fim = new Date(y, m, 1); return lista.filter(a => { const d = new Date(a.created_at); return d >= ini && d < fim; }); }
const charts = {};
function chart(id, cfg) { if (!window.Chart) return; charts[id]?.destroy(); charts[id] = new Chart(document.getElementById(id), cfg); }
const CORES = { "Aluguel": "#1a6b2d", "Venda em garantia": "#8dc63f", "Venda fora de garantia": "#e0a100", "Não informado": "#9db0a2" };
const tipoDe = a => a.tipo || "Não informado";
const auxiliares = () => Object.values(perfis).filter(p => p.ativo && (p.papel === "auxiliar" || lista.some(a => a.criado_por === p.id)));
function horas(a) { return a.finalizado_em ? (new Date(a.finalizado_em) - new Date(a.created_at)) / 36e5 : null; }
function fmtDur(h) { if (h == null || isNaN(h)) return "—"; return h < 24 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} dias`; }
function renderDashboard() {
  if (!isSup()) return;
  const rows = doMes($("#dMes").value);
  const fins = rows.filter(a => FINAIS.includes(a.status));
  const durs = fins.map(horas).filter(x => x != null);
  const media = durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : null;
  const chatRes = rows.filter(a => a.status === "resolvido_chat").length;
  const sats = rows.filter(a => a.satisfacao).map(a => a.satisfacao);
  const parados = lista.filter(a => !FINAIS.includes(a.status) && diasParado(a) >= 3);
  const cnt = t => rows.filter(a => tipoDe(a) === t).length;
  $("#dKpis").innerHTML = `
    <div class="kpi info"><span>Atendimentos no mês</span><b class="v">${rows.length}</b></div>
    <div class="kpi"><span>Aluguel</span><b class="v">${cnt("Aluguel")}</b></div>
    <div class="kpi"><span>Venda em garantia</span><b class="v">${cnt("Venda em garantia")}</b></div>
    <div class="kpi"><span>Venda fora de garantia</span><b class="v">${cnt("Venda fora de garantia")}</b></div>
    <div class="kpi ok"><span>Resolvidos pelo chat</span><b class="v">${chatRes}</b></div>
    <div class="kpi"><span>Com O.S. no Infraspeak</span><b class="v">${rows.filter(a => a.os_numero).length}</b></div>
    <div class="kpi"><span>Tempo médio até finalizar</span><b class="v" style="font-size:22px">${fmtDur(media)}</b></div>
    <div class="kpi"><span>Satisfação média</span><b class="v">${sats.length ? (sats.reduce((a, b) => a + b, 0) / sats.length).toFixed(1) : "—"}</b></div>
    <div class="kpi ${parados.length ? "alerta" : "ok"}"><span>Parados 3+ dias (geral)</span><b class="v">${parados.length}</b></div>`;
  const tipos = [...TIPOS, "Não informado"];
  const css = getComputedStyle(document.documentElement), tx = css.getPropertyValue("--muted").trim() || "#5b6b5f", grid = css.getPropertyValue("--line").trim() || "#dbe4d9";
  if (window.Chart) { Chart.defaults.color = tx; Chart.defaults.borderColor = grid; Chart.defaults.font.family = "'Source Sans 3', system-ui, sans-serif"; }
  const base = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } };
  chart("chTipo", { type: "doughnut", data: { labels: tipos, datasets: [{ data: tipos.map(cnt), backgroundColor: tipos.map(t => CORES[t]) }] }, options: base });
  const aux = auxiliares();
  chart("chAux", { type: "bar", data: { labels: aux.map(p => p.nome), datasets: tipos.map(t => ({ label: t, backgroundColor: CORES[t], data: aux.map(p => rows.filter(a => a.criado_por === p.id && tipoDe(a) === t).length) })) }, options: { ...base, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } } } });
  const sts = Object.keys(STATUS);
  chart("chStatus", { type: "bar", data: { labels: sts.map(s => STATUS[s]), datasets: [{ label: "Atendimentos", backgroundColor: "#1a6b2d", data: sts.map(s => rows.filter(a => a.status === s).length) }] }, options: { ...base, indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } } });
  const [y, m] = $("#dMes").value.split("-").map(Number), nd = new Date(y, m, 0).getDate();
  const dias = [...Array(nd)].map((_, i) => i + 1);
  chart("chDia", { type: "line", data: { labels: dias, datasets: [{ label: "Registrados", borderColor: "#1a6b2d", backgroundColor: "rgba(26,107,45,.12)", fill: true, tension: .3, pointRadius: 2, data: dias.map(d => rows.filter(a => new Date(a.created_at).getDate() === d).length) }] }, options: { ...base, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } } });
  const modelos = [...new Set(rows.map(a => a.modelo || "Não informado"))].sort();
  $("#dModelos").innerHTML = modelos.length ? `<table><thead><tr><th>Modelo</th>${tipos.map(t => `<th>${t}</th>`).join("")}<th>Total</th></tr></thead><tbody>${modelos.map(md => { const r = rows.filter(a => (a.modelo || "Não informado") === md); return `<tr><td>${esc(md)}</td>${tipos.map(t => `<td class="num">${r.filter(a => tipoDe(a) === t).length}</td>`).join("")}<td class="num"><b>${r.length}</b></td></tr>`; }).join("")}</tbody></table>` : '<p class="lead">Sem atendimentos no mês.</p>';
  $("#dParados").innerHTML = parados.length ? `<table class="lista"><thead><tr><th>#</th><th>Cliente</th><th>Tipo</th><th>Status</th><th>Auxiliar</th><th>Parado</th></tr></thead><tbody>${parados.sort((a, b) => diasParado(b) - diasParado(a)).map(a => `<tr data-id="${a.id}"><td>#${a.id}</td><td>${esc(a.cliente || "—")}</td><td>${esc(a.tipo || "—")}</td><td>${stPill(a.status)}</td><td>${esc(perfis[a.criado_por]?.nome || "")}</td><td class="dias alerta">${diasParado(a)} d</td></tr>`).join("")}</tbody></table>` : '<p class="lead">Nenhum atendimento parado.</p>';
}
$("#dMes").onchange = renderDashboard;
$("#dParados").addEventListener("click", e => { const tr = e.target.closest("tr[data-id]"); if (tr) abrirAtendimento(Number(tr.dataset.id), true); });

function renderRelatorio() {
  if (!isSup()) return;
  const ym = $("#rMes").value, rows = doMes(ym).sort((a, b) => a.id - b.id);
  const [y, m] = ym.split("-").map(Number);
  const nomeMes = new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const tipos = [...TIPOS, "Não informado"];
  const aux = auxiliares();
  const resumo = `<table><thead><tr><th>Tipo</th>${aux.map(p => `<th>${esc(p.nome)}</th>`).join("")}<th>Total</th><th>Finalizados</th><th>Resolvidos chat</th><th>Com O.S.</th><th>Tempo médio</th></tr></thead><tbody>${tipos.map(t => {
    const r = rows.filter(a => tipoDe(a) === t); if (!r.length && t === "Não informado") return "";
    const d = r.map(horas).filter(x => x != null);
    return `<tr><td><b>${t}</b></td>${aux.map(p => `<td class="num">${r.filter(a => a.criado_por === p.id).length}</td>`).join("")}<td class="num"><b>${r.length}</b></td><td class="num">${r.filter(a => a.status === "finalizado").length}</td><td class="num">${r.filter(a => a.status === "resolvido_chat").length}</td><td class="num">${r.filter(a => a.os_numero).length}</td><td class="num">${fmtDur(d.length ? d.reduce((a, b) => a + b, 0) / d.length : null)}</td></tr>`;
  }).join("")}<tr><td><b>Total</b></td>${aux.map(p => `<td class="num"><b>${rows.filter(a => a.criado_por === p.id).length}</b></td>`).join("")}<td class="num"><b>${rows.length}</b></td><td class="num">${rows.filter(a => a.status === "finalizado").length}</td><td class="num">${rows.filter(a => a.status === "resolvido_chat").length}</td><td class="num">${rows.filter(a => a.os_numero).length}</td><td></td></tr></tbody></table>`;
  const secao = t => {
    const r = rows.filter(a => tipoDe(a) === t); if (!r.length) return t === "Não informado" ? "" : `<div class="card"><h2>${t} · 0</h2><p class="lead">Sem atendimentos.</p></div>`;
    return `<div class="card"><h2>${t} · ${r.length}</h2><div class="tw"><table><thead><tr><th>#</th><th>Data</th><th>Cliente</th><th>Modelo</th><th>Auxiliar</th><th>Bitrix</th><th>O.S.</th><th>Técnico</th><th>Status</th><th>Finalizado</th><th>Satisf.</th></tr></thead><tbody>${r.map(a => `<tr><td>${a.id}</td><td>${fmtData(a.created_at)}</td><td>${esc(a.cliente || "—")}</td><td>${esc(a.modelo || "—")}</td><td>${esc(perfis[a.criado_por]?.nome || "")}</td><td>${a.bitrix_sessao || "—"}</td><td>${esc(a.os_numero || "—")}</td><td>${esc(a.tecnico || "—")}</td><td>${STATUS[a.status]}</td><td>${fmtData(a.finalizado_em) || "—"}</td><td>${a.satisfacao || "—"}</td></tr>`).join("")}</tbody></table></div></div>`;
  };
  $("#relBody").innerHTML = `<div class="rhd"><img src="${LOGO}" alt="Nebulize"><div><h1 style="margin:0">Relatório mensal · Suporte Técnico</h1><span class="lead">${nomeMes} · gerado em ${new Date().toLocaleString("pt-BR")} por ${esc(me.nome)}</span></div></div>
    <div class="card"><h2>Resumo</h2><div class="tw">${resumo}</div></div>${tipos.map(secao).join("")}`;
}
$("#rMes").onchange = renderRelatorio;
$("#btnPrint").onclick = () => window.print();
$("#btnCsv").onclick = () => {
  const ym = $("#rMes").value, rows = doMes(ym);
  const cols = [["id", "#"], ["created_at", "Data"], ["tipo", "Tipo"], ["cliente", "Cliente"], ["contato", "Contato"], ["modelo", "Modelo"], ["canal", "Canal"], ["atendente", "Auxiliar"], ["status", "Status"], ["bitrix_sessao", "Conversa Bitrix"], ["os_numero", "O.S."], ["os_status", "Status O.S."], ["tecnico", "Técnico"], ["endereco", "Endereço"], ["finalizado_em", "Finalizado em"], ["satisfacao", "Satisfação"], ["pos_atendimento", "Pós-atendimento"], ["rma", "RMA"], ["motivo", "Motivo"]];
  const val = (a, k) => k === "atendente" ? perfis[a.criado_por]?.nome || "" : k === "status" ? STATUS[a.status] : k === "tipo" ? tipoDe(a) : /_em$|created_at/.test(k) ? fmtData(a[k]) : typeof a[k] === "boolean" ? (a[k] ? "Sim" : "Não") : a[k] ?? "";
  const csv = "﻿" + [cols.map(c => c[1]).join(";"), ...rows.map(a => cols.map(([k]) => `"${String(val(a, k)).replace(/"/g, '""').replace(/\n/g, " ")}"`).join(";"))].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const l = document.createElement("a"); l.href = url; l.download = `atendimentos-${ym}.csv`; document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
};

/* ================= ROTAS ================= */
const VIEWS = ["atendimentos", "conversas", "atendimento", "dashboard", "relatorio", "inicio", "recepcao", "identificacao", "testes", "chamado", "fora-garantia", "rma", "acompanhamento", "tecnicos", "emails", "videos", "supervisor"];
function route() {
  const h = (location.hash || "").slice(1);
  let cur = VIEWS.includes(h) ? h : "atendimentos";
  if ((cur === "dashboard" || cur === "relatorio") && !isSup()) cur = "atendimentos";
  $$("section.view").forEach(s => s.classList.toggle("on", s.id === "v-" + cur));
  $$("#nav a").forEach(a => a.classList.toggle("on", a.dataset.v === cur));
  if (cur === "dashboard") renderDashboard();
  if (cur === "relatorio") renderRelatorio();
  if (cur === "atendimento") carregarEventos();
  if (cur === "atendimentos") renderLista();
  if (cur === "conversas") carregarConversas();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);

function renderAll(leve) {
  if (!me) return;
  renderAtendimento(); renderScripts(); renderIdent(); renderChamado(); renderFora(); renderAc(); renderMails(); renderNovos(); renderSup();
  if (!leve) { renderTests(); renderLista(); }
  else renderLista();
}
renderVideos();
const { data: { session } } = await sb.auth.getSession();
if (session) iniciarSessao(session); else $("#lgEmail").focus();
