-- =========================================================
-- PORTAL SUPORTE TÉCNICO · atualização 010
-- "Minhas conversas" com o MESMO motor do Monitor Bitrix da Katielen (Codigo.gs):
-- lista de Canais Abertos de cada usuária (webhook dela, "Conectar meu Bitrix"),
-- mesma classificação (pedido, cliente esperando, retornar, promessa, novas, respondidas,
-- pausados), mesmas cobranças e mesmos avisos no sino do Bitrix + resumo do dia.
-- Rode no SQL Editor do Supabase (uma vez), depois do 009.
-- =========================================================

-- fila calculada a cada minuto (uma linha por conversa de cada usuária)
create table if not exists public.fila_conversas (
  perfil_id uuid not null references public.perfis(id) on delete cascade,
  dialog_id text not null,
  chat_id bigint,
  tipo text not null,            -- pedido | cliente | retornar | promessa | nova | respondido
  msg_id text,                   -- última mensagem da conversa (para Pronto/Pausar)
  nome text,
  texto text,
  ts timestamptz,                -- desde quando conta o tempo
  na_fila boolean not null default false,
  pausado boolean not null default false,
  pausado_em timestamptz,
  motivo text,
  atualizado_em timestamptz not null default now(),
  primary key (perfil_id, dialog_id)
);

-- marcações da usuária (valem até chegar mensagem nova, igual ao Monitor)
create table if not exists public.fila_estado (
  perfil_id uuid not null references public.perfis(id) on delete cascade,
  dialog_id text not null,
  ignorado_msg text,             -- "✓ Pronto": some até chegar mensagem nova
  pausado_msg text,              -- pausado nessa mensagem
  pausado_em timestamptz,
  motivo text,
  atualizado_em timestamptz not null default now(),
  primary key (perfil_id, dialog_id)
);

-- cobranças (achadas na conversa ou marcadas com "Cobrar")
create table if not exists public.fila_cobrancas (
  id bigint generated always as identity primary key,
  perfil_id uuid not null references public.perfis(id) on delete cascade,
  dialog_id text,
  nome text,
  texto text,
  valor text,
  origem text,
  quando timestamptz not null default now(),
  status text not null default 'pendente' check (status in ('pendente','cobrado')),
  concluido_em timestamptz,
  concluido_por uuid references public.perfis(id) on delete set null
);
create index if not exists idx_fila_cob on public.fila_cobrancas(perfil_id, status);

-- uso interno do monitor (o navegador não lê)
create table if not exists public.fila_mensagens (   -- cache das mensagens + varredura de cobrança
  perfil_id uuid not null references public.perfis(id) on delete cascade,
  dialog_id text not null,
  ultimo_id text,
  msgs jsonb,
  cob_ultimo_id text,
  primary key (perfil_id, dialog_id)
);
create table if not exists public.fila_notificados (
  perfil_id uuid not null references public.perfis(id) on delete cascade,
  chave text not null,
  em timestamptz not null default now(),
  primary key (perfil_id, chave)
);
create table if not exists public.bitrix_usuarios (
  id bigint primary key,
  tipo text not null,            -- op | empresa | bot | cliente
  atualizado_em timestamptz not null default now()
);

alter table public.fila_conversas enable row level security;
alter table public.fila_estado enable row level security;
alter table public.fila_cobrancas enable row level security;
alter table public.fila_mensagens enable row level security;
alter table public.fila_notificados enable row level security;
alter table public.bitrix_usuarios enable row level security;

drop policy if exists fc_sel on public.fila_conversas;
create policy fc_sel on public.fila_conversas for select to authenticated using (public.is_equipe());
drop policy if exists fe_all on public.fila_estado;
create policy fe_all on public.fila_estado for all to authenticated using (public.is_equipe()) with check (public.is_equipe());
drop policy if exists fcb_all on public.fila_cobrancas;
create policy fcb_all on public.fila_cobrancas for all to authenticated using (public.is_equipe()) with check (public.is_equipe());

grant select on public.fila_conversas to authenticated;
grant select, insert, update, delete on public.fila_estado, public.fila_cobrancas to authenticated;
revoke all on public.fila_mensagens, public.fila_notificados, public.bitrix_usuarios from anon, authenticated;
grant all on public.fila_conversas, public.fila_estado, public.fila_cobrancas, public.fila_mensagens, public.fila_notificados, public.bitrix_usuarios to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

do $$ begin
  alter publication supabase_realtime add table public.fila_conversas;
exception when others then null; end $$;
