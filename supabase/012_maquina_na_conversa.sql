-- =========================================================
-- PORTAL SUPORTE TÉCNICO · atualização 012
-- Nº de série de máquina de aluguel citado na conversa do Bitrix.
-- O monitor procura os nºs de série da base de máquinas nas mensagens; se a máquina
-- estiver (ou ficar) bloqueada pelo financeiro, marca a conversa e avisa a responsável
-- no sino do Bitrix e no sino do portal.
-- Rode no SQL Editor do Supabase (uma vez), depois do 011.
-- =========================================================
create table if not exists public.conversa_maquinas (
  dialog_id text not null,
  serie_norm text not null,      -- nº de série como está na base (maquinas_aluguel.serie_norm)
  serie text,
  trecho text,                   -- trecho da mensagem onde apareceu
  achado_em timestamptz not null default now(),
  primary key (dialog_id, serie_norm)
);
alter table public.conversa_maquinas enable row level security;
drop policy if exists cm_sel on public.conversa_maquinas;
create policy cm_sel on public.conversa_maquinas for select to authenticated using (public.is_equipe());
grant select on public.conversa_maquinas to authenticated;
grant all on public.conversa_maquinas to service_role;
