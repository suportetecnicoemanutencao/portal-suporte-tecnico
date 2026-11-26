-- =========================================================
-- PORTAL SUPORTE TÉCNICO · atualização 011
-- "Resp." na fila do Monitor: passar a conversa para outra pessoa da equipe.
-- A fila é recalculada a cada minuto, então a tabela pode ser recriada sem perder nada.
-- Rode no SQL Editor do Supabase (uma vez), depois do 010.
-- =========================================================
drop table if exists public.fila_conversas;
create table public.fila_conversas (
  origem_id uuid not null references public.perfis(id) on delete cascade,   -- de quem é a lista do Bitrix
  perfil_id uuid not null references public.perfis(id) on delete cascade,   -- quem é a responsável (Resp.)
  dialog_id text not null,
  chat_id bigint,
  tipo text not null,            -- pedido | cliente | retornar | promessa | nova | respondido
  msg_id text,
  nome text,
  texto text,
  ts timestamptz,
  na_fila boolean not null default false,
  pausado boolean not null default false,
  pausado_em timestamptz,
  motivo text,
  atualizado_em timestamptz not null default now(),
  primary key (origem_id, dialog_id)
);
create index if not exists idx_fila_perfil on public.fila_conversas(perfil_id);
alter table public.fila_conversas enable row level security;
drop policy if exists fc_sel on public.fila_conversas;
create policy fc_sel on public.fila_conversas for select to authenticated using (public.is_equipe());
grant select on public.fila_conversas to authenticated;
grant all on public.fila_conversas to service_role;
do $$ begin
  alter publication supabase_realtime add table public.fila_conversas;
exception when others then null; end $$;

-- Resp.: para quem a conversa foi passada (vale até alguém voltar ao responsável do Bitrix)
alter table public.fila_estado add column if not exists repassado_para uuid references public.perfis(id) on delete set null;
alter table public.fila_estado add column if not exists repassado_em timestamptz;
alter table public.fila_estado add column if not exists repassado_por uuid references public.perfis(id) on delete set null;
