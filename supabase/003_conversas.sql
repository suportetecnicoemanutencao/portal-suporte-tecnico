-- =========================================================
-- PORTAL SUPORTE TÉCNICO · atualização 003
-- Aba "Minhas conversas": acompanhamento das conversas do Bitrix
-- (sem resposta, promessas pendentes, novas, chamados a atualizar) + avisos no Bitrix.
-- Rode no SQL Editor do Supabase (uma vez), depois do 002.
-- =========================================================

-- ID do usuário no Bitrix (quem é o operador da conversa)
alter table public.perfis add column if not exists bitrix_user_id bigint;
update public.perfis set bitrix_user_id = 51    where email = 'manutencao@nebulize.com.br'   and bitrix_user_id is null;
update public.perfis set bitrix_user_id = 8937  where email = 'manutencao02@nebulize.com.br' and bitrix_user_id is null;
update public.perfis set bitrix_user_id = 14305 where email = 'manutencao03@nebulize.com.br' and bitrix_user_id is null;

-- situação de cada conversa (atualizada pelo bitrix-monitor a cada 5 min)
alter table public.bitrix_sessoes add column if not exists owner_bitrix_id bigint;
alter table public.bitrix_sessoes add column if not exists operador uuid references public.perfis(id) on delete set null;
alter table public.bitrix_sessoes add column if not exists cliente text;
alter table public.bitrix_sessoes add column if not exists encerrada boolean not null default false;
alter table public.bitrix_sessoes add column if not exists ultimo_msg_id bigint;
alter table public.bitrix_sessoes add column if not exists ultima_msg_em timestamptz;
alter table public.bitrix_sessoes add column if not exists ultima_msg_de text;          -- cliente | operador
alter table public.bitrix_sessoes add column if not exists ultimo_texto text;
alter table public.bitrix_sessoes add column if not exists cliente_desde timestamptz;   -- 1ª msg do cliente ainda sem resposta
alter table public.bitrix_sessoes add column if not exists operador_respondeu boolean not null default false;
alter table public.bitrix_sessoes add column if not exists ultima_resposta_em timestamptz;
alter table public.bitrix_sessoes add column if not exists promessa boolean not null default false;
alter table public.bitrix_sessoes add column if not exists situacao text;               -- sem_resposta | promessa | nova | chamado | em_dia
alter table public.bitrix_sessoes add column if not exists resolvido_msg_id bigint;     -- "✓ Resolvido" até chegar mensagem nova
alter table public.bitrix_sessoes add column if not exists alertas jsonb not null default '{}'::jsonb;
alter table public.bitrix_sessoes add column if not exists atualizada_em timestamptz;
create index if not exists idx_bxs_operador on public.bitrix_sessoes(operador, encerrada);

-- equipe vê e marca "Resolvido"
drop policy if exists bxs_sel on public.bitrix_sessoes;
create policy bxs_sel on public.bitrix_sessoes for select to authenticated using (public.is_equipe());
drop policy if exists bxs_upd on public.bitrix_sessoes;
create policy bxs_upd on public.bitrix_sessoes for update to authenticated
  using (operador = auth.uid() or public.is_supervisor())
  with check (operador = auth.uid() or public.is_supervisor());

grant select, update on public.bitrix_sessoes to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.bitrix_sessoes;
exception when others then null; end $$;
