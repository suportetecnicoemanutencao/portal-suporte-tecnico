-- =========================================================
-- PORTAL SUPORTE TÉCNICO · atualização 002
-- Captura automática de dados do Bitrix + abertura automática pela saudação.
-- Rode no SQL Editor do Supabase (uma vez).
-- =========================================================

alter table public.atendimentos add column if not exists numero_serie text;
alter table public.atendimentos add column if not exists origem text not null default 'manual';

-- nome usado na saudação do Bitrix ("... me chamo Katielen"). Por padrão = primeiro nome.
alter table public.perfis add column if not exists nome_bitrix text;
update public.perfis set nome_bitrix = split_part(nome, ' ', 1) where nome_bitrix is null;

-- sessões do Canal Aberto acompanhadas pelo monitor
create table if not exists public.bitrix_sessoes (
  sessao bigint primary key,
  chat_id bigint,
  nome text,
  status text not null default 'pendente' check (status in ('pendente','aberto','ignorada')),
  atendimento_id bigint references public.atendimentos(id) on delete set null,
  descoberta_em timestamptz not null default now(),
  verificada_em timestamptz
);
create index if not exists idx_bxs_status on public.bitrix_sessoes(status, descoberta_em);

-- configurações simples (ex.: última sessão lida)
create table if not exists public.config_portal (
  chave text primary key,
  valor jsonb not null,
  atualizado_em timestamptz not null default now()
);

alter table public.bitrix_sessoes enable row level security;
alter table public.config_portal enable row level security;
drop policy if exists bxs_sel on public.bitrix_sessoes;
create policy bxs_sel on public.bitrix_sessoes for select to authenticated using (public.is_supervisor());
drop policy if exists cfg_sel on public.config_portal;
create policy cfg_sel on public.config_portal for select to authenticated using (public.is_supervisor());

grant select, insert, update, delete on public.bitrix_sessoes, public.config_portal to authenticated;
grant all on public.bitrix_sessoes, public.config_portal to service_role;
