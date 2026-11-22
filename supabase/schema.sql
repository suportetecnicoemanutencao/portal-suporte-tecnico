-- =========================================================
-- PORTAL SUPORTE TÉCNICO · Nebulize · Schema Supabase
-- Rode este arquivo inteiro no SQL Editor do Supabase (uma vez).
-- =========================================================

-- ---------- PERFIS ----------
create table if not exists public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  email text,
  papel text not null default 'auxiliar' check (papel in ('supervisor','auxiliar')),
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

-- cria o perfil automaticamente quando um usuário é criado no Auth
create or replace function public.criar_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfis (id, nome, email, papel)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', split_part(new.email,'@',1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'papel', 'auxiliar')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists trg_criar_perfil on auth.users;
create trigger trg_criar_perfil after insert on auth.users
for each row execute function public.criar_perfil();

create or replace function public.is_supervisor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis where id = auth.uid() and papel = 'supervisor' and ativo);
$$;

create or replace function public.is_equipe()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis where id = auth.uid() and ativo);
$$;

-- ---------- ATENDIMENTOS ----------
create table if not exists public.atendimentos (
  id bigint generated always as identity primary key,
  criado_por uuid not null default auth.uid() references public.perfis(id),
  status text not null default 'aberto' check (status in
    ('aberto','aguardando_cliente','aguardando_tecnico','aguardando_peca','resolvido_chat','finalizado','cancelado')),
  etapa text not null default 'recepcao',
  tipo text check (tipo in ('Aluguel','Venda em garantia','Venda fora de garantia')),
  modelo text,
  canal text default 'Bitrix',
  cliente text,
  contato text,
  endereco text,
  cnpj text,
  email_nf text,
  nf_data date,
  motivo text,
  video_recebido boolean not null default false,
  testes jsonb not null default '{}'::jsonb,
  checklist jsonb not null default '{}'::jsonb,
  -- Bitrix
  bitrix_sessao bigint,
  bitrix_chat_id bigint,
  bitrix_link text,
  bitrix_dados jsonb,
  bitrix_vinculado_em timestamptz,
  bitrix_encerrada boolean not null default false,
  -- Infraspeak
  os_numero text,
  os_status text,
  os_aberta_em timestamptz,
  os_fechada_em timestamptz,
  tecnico text,
  -- venda fora de garantia / RMA / pós
  orcamento_visita text check (orcamento_visita in ('simples','completa')),
  rma boolean not null default false,
  pos_atendimento boolean not null default false,
  satisfacao smallint check (satisfacao between 1 and 5),
  observacoes text,
  -- controle
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ultima_atividade timestamptz not null default now(),
  finalizado_em timestamptz
);

create index if not exists idx_atend_status on public.atendimentos(status);
create index if not exists idx_atend_criado on public.atendimentos(created_at);
create index if not exists idx_atend_user on public.atendimentos(criado_por);
create index if not exists idx_atend_os on public.atendimentos(os_numero);
create unique index if not exists uq_atend_bitrix_aberto on public.atendimentos(bitrix_sessao)
  where bitrix_sessao is not null and status not in ('finalizado','resolvido_chat','cancelado');

create or replace function public.atend_before_update()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.ultima_atividade := now();
  if new.status in ('finalizado','resolvido_chat','cancelado') and old.status not in ('finalizado','resolvido_chat','cancelado') then
    new.finalizado_em := now();
  elsif new.status not in ('finalizado','resolvido_chat','cancelado') then
    new.finalizado_em := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_atend_before_update on public.atendimentos;
create trigger trg_atend_before_update before update on public.atendimentos
for each row execute function public.atend_before_update();

-- ---------- HISTÓRICO ----------
create table if not exists public.atendimento_eventos (
  id bigint generated always as identity primary key,
  atendimento_id bigint not null references public.atendimentos(id) on delete cascade,
  autor uuid references public.perfis(id),
  tipo text not null,
  descricao text not null,
  dados jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_evt_atend on public.atendimento_eventos(atendimento_id);

create or replace function public.atend_log()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.atendimento_eventos(atendimento_id, autor, tipo, descricao)
    values (new.id, coalesce(auth.uid(), new.criado_por), 'criado', 'Atendimento registrado');
  else
    if new.status is distinct from old.status then
      insert into public.atendimento_eventos(atendimento_id, autor, tipo, descricao, dados)
      values (new.id, auth.uid(), 'status', 'Status: ' || old.status || ' → ' || new.status,
              jsonb_build_object('de', old.status, 'para', new.status));
    end if;
    if new.os_numero is distinct from old.os_numero and new.os_numero is not null then
      insert into public.atendimento_eventos(atendimento_id, autor, tipo, descricao)
      values (new.id, auth.uid(), 'os', 'O.S. informada: ' || new.os_numero);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_atend_log_ins on public.atendimentos;
create trigger trg_atend_log_ins after insert on public.atendimentos
for each row execute function public.atend_log();
drop trigger if exists trg_atend_log_upd on public.atendimentos;
create trigger trg_atend_log_upd after update on public.atendimentos
for each row execute function public.atend_log();

-- ---------- NOTIFICAÇÕES ----------
create table if not exists public.notificacoes (
  id bigint generated always as identity primary key,
  usuario_id uuid not null references public.perfis(id) on delete cascade,
  atendimento_id bigint references public.atendimentos(id) on delete cascade,
  tipo text not null,
  titulo text not null,
  mensagem text,
  lida boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_notif_user on public.notificacoes(usuario_id, lida);

-- ---------- INFRASPEAK (webhook) ----------
create table if not exists public.infraspeak_eventos (
  id bigint generated always as identity primary key,
  recebido_em timestamptz not null default now(),
  evento text,
  os_numero text,
  atendimento_id bigint references public.atendimentos(id) on delete set null,
  payload jsonb not null
);

-- ---------- RLS ----------
alter table public.perfis enable row level security;
alter table public.atendimentos enable row level security;
alter table public.atendimento_eventos enable row level security;
alter table public.notificacoes enable row level security;
alter table public.infraspeak_eventos enable row level security;

drop policy if exists perfis_sel on public.perfis;
create policy perfis_sel on public.perfis for select to authenticated using (public.is_equipe());
drop policy if exists perfis_upd on public.perfis;
create policy perfis_upd on public.perfis for update to authenticated
  using (id = auth.uid() or public.is_supervisor())
  with check (id = auth.uid() or public.is_supervisor());

-- equipe vê todos os atendimentos (para cobrir ausências); edita os próprios; supervisor edita todos
drop policy if exists atend_sel on public.atendimentos;
create policy atend_sel on public.atendimentos for select to authenticated using (public.is_equipe());
drop policy if exists atend_ins on public.atendimentos;
create policy atend_ins on public.atendimentos for insert to authenticated
  with check (public.is_equipe() and criado_por = auth.uid());
drop policy if exists atend_upd on public.atendimentos;
create policy atend_upd on public.atendimentos for update to authenticated
  using (criado_por = auth.uid() or public.is_supervisor())
  with check (criado_por = auth.uid() or public.is_supervisor());
drop policy if exists atend_del on public.atendimentos;
create policy atend_del on public.atendimentos for delete to authenticated using (public.is_supervisor());

drop policy if exists evt_sel on public.atendimento_eventos;
create policy evt_sel on public.atendimento_eventos for select to authenticated using (public.is_equipe());
drop policy if exists evt_ins on public.atendimento_eventos;
create policy evt_ins on public.atendimento_eventos for insert to authenticated
  with check (public.is_equipe() and autor = auth.uid());

drop policy if exists notif_sel on public.notificacoes;
create policy notif_sel on public.notificacoes for select to authenticated using (usuario_id = auth.uid());
drop policy if exists notif_upd on public.notificacoes;
create policy notif_upd on public.notificacoes for update to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

drop policy if exists infra_sel on public.infraspeak_eventos;
create policy infra_sel on public.infraspeak_eventos for select to authenticated using (public.is_supervisor());

-- ---------- REALTIME (sininho de notificações) ----------
do $$ begin
  alter publication supabase_realtime add table public.notificacoes;
exception when others then null; end $$;
