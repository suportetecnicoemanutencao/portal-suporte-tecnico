-- =========================================================
-- PORTAL SUPORTE TÉCNICO · atualização 008
-- Máquinas de aluguel (base de consulta) + bloqueio para atendimento pelo financeiro
--   · papel novo "financeiro": entra no portal e vê só a página Máquinas de aluguel
--   · financeiro/supervisor bloqueiam ou liberam a máquina pelo nº de série
--   · auxiliares consultam a base e são avisadas no atendimento quando a máquina está bloqueada
-- O VALOR do aluguel não é guardado no portal.
-- Rode no SQL Editor do Supabase (uma vez), depois do 007. Depois rode o 008b (carga da planilha).
-- =========================================================

-- papel financeiro
alter table public.perfis drop constraint if exists perfis_papel_check;
alter table public.perfis add constraint perfis_papel_check check (papel in ('supervisor','auxiliar','financeiro'));

create or replace function public.is_financeiro()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis where id = auth.uid() and papel = 'financeiro' and ativo);
$$;
-- "equipe" do suporte = supervisor e auxiliares (o financeiro NÃO vê atendimentos, conversas etc.)
create or replace function public.is_equipe()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis where id = auth.uid() and ativo and papel in ('supervisor','auxiliar'));
$$;
-- todo usuário enxerga o próprio perfil (o financeiro precisa dele para entrar)
drop policy if exists perfis_sel_proprio on public.perfis;
create policy perfis_sel_proprio on public.perfis for select to authenticated using (id = auth.uid());

-- base de máquinas (carregada da planilha MAQUINAS DE ALUGUEL NEBULIZE)
create table if not exists public.maquinas_aluguel (
  id bigint generated always as identity primary key,
  serie text,
  serie_norm text,               -- só letras e números, maiúsculas
  ano int,
  modelo text,
  kit text,
  descricao text,
  contrato text,
  cod_cliente text,
  nome text,
  estabelecimento text,
  endereco text,
  uf text,
  cidade text,
  representante text,
  nr_pedido text,
  nf text,
  nfs_ref text,
  data_envio date,
  data_entrega date,
  data_instalacao date,
  observacoes text,
  importado_em timestamptz not null default now()
);
create index if not exists idx_maq_serie on public.maquinas_aluguel(serie_norm);
create index if not exists idx_maq_cod on public.maquinas_aluguel(cod_cliente);

-- bloqueio por nº de série (continua valendo quando a base é recarregada)
create table if not exists public.maquinas_bloqueio (
  serie_norm text primary key,
  serie text not null,
  bloqueado boolean not null default true,
  motivo text,
  atualizado_por uuid default auth.uid() references public.perfis(id) on delete set null,
  atualizado_por_nome text,
  atualizado_em timestamptz not null default now()
);
create table if not exists public.maquinas_bloqueio_hist (
  id bigint generated always as identity primary key,
  serie_norm text not null,
  serie text,
  acao text not null check (acao in ('bloqueou','liberou')),
  motivo text,
  autor uuid,
  autor_nome text,
  created_at timestamptz not null default now()
);
create index if not exists idx_maq_hist on public.maquinas_bloqueio_hist(created_at desc);

create or replace function public.maquinas_bloqueio_log()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.atualizado_por := coalesce(auth.uid(), new.atualizado_por);
  new.atualizado_por_nome := coalesce((select nome from public.perfis where id = new.atualizado_por), new.atualizado_por_nome);
  new.atualizado_em := now();
  if tg_op = 'UPDATE' then
    if new.bloqueado is not distinct from old.bloqueado and new.motivo is not distinct from old.motivo then
      return new;
    end if;
  end if;
  insert into public.maquinas_bloqueio_hist(serie_norm, serie, acao, motivo, autor, autor_nome)
  values (new.serie_norm, new.serie, case when new.bloqueado then 'bloqueou' else 'liberou' end, new.motivo, new.atualizado_por, new.atualizado_por_nome);
  return new;
end $$;
drop trigger if exists trg_maq_bloqueio on public.maquinas_bloqueio;
create trigger trg_maq_bloqueio before insert or update on public.maquinas_bloqueio
  for each row execute function public.maquinas_bloqueio_log();

alter table public.maquinas_aluguel enable row level security;
alter table public.maquinas_bloqueio enable row level security;
alter table public.maquinas_bloqueio_hist enable row level security;

drop policy if exists maq_sel on public.maquinas_aluguel;
create policy maq_sel on public.maquinas_aluguel for select to authenticated using (public.is_equipe() or public.is_financeiro());
drop policy if exists maq_sup on public.maquinas_aluguel;
create policy maq_sup on public.maquinas_aluguel for all to authenticated using (public.is_supervisor()) with check (public.is_supervisor());

drop policy if exists mqb_sel on public.maquinas_bloqueio;
create policy mqb_sel on public.maquinas_bloqueio for select to authenticated using (public.is_equipe() or public.is_financeiro());
drop policy if exists mqb_ins on public.maquinas_bloqueio;
create policy mqb_ins on public.maquinas_bloqueio for insert to authenticated with check (public.is_financeiro() or public.is_supervisor());
drop policy if exists mqb_upd on public.maquinas_bloqueio;
create policy mqb_upd on public.maquinas_bloqueio for update to authenticated
  using (public.is_financeiro() or public.is_supervisor()) with check (public.is_financeiro() or public.is_supervisor());

drop policy if exists mqh_sel on public.maquinas_bloqueio_hist;
create policy mqh_sel on public.maquinas_bloqueio_hist for select to authenticated using (public.is_equipe() or public.is_financeiro());

-- o portal recebe na hora quando o financeiro bloqueia ou libera
do $$ begin
  alter publication supabase_realtime add table public.maquinas_bloqueio;
exception when others then null; end $$;

-- ---------------------------------------------------------
-- Usuário do financeiro: crie em Authentication → Users → Add user
-- (financeiro@nebulize.com.br, marque "Auto Confirm User") e depois rode:
--   update public.perfis set papel = 'financeiro', nome = 'Financeiro', ativo = true
--   where email = 'financeiro@nebulize.com.br';
-- ---------------------------------------------------------
