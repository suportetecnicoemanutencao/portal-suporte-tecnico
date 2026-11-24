-- =========================================================
-- PORTAL SUPORTE TÉCNICO · atualização 005
-- "Minhas conversas" com as regras do Monitor Bitrix da Katielen:
--   · novas situações: pedido (prometeu gerar pedido) e retornar (cliente só respondeu "ok/obrigado")
--   · Pausar conversa com justificativa (volta sozinha quando chega mensagem nova)
--   · opção "Cobrar" no seletor de situação (cobrança marcada à mão)
--   · preferência de exibição (Vertical / Horizontal) salva no perfil
-- Rode no SQL Editor do Supabase (uma vez), depois do 004.
-- =========================================================

-- pausa
alter table public.bitrix_sessoes add column if not exists pausado_em timestamptz;
alter table public.bitrix_sessoes add column if not exists pausado_motivo text;
alter table public.bitrix_sessoes add column if not exists pausado_msg_id bigint;      -- pausada até chegar mensagem mais nova que esta
alter table public.bitrix_sessoes add column if not exists pausado_por uuid references public.perfis(id) on delete set null;

-- cobrança marcada à mão (opção "Cobrar" do seletor)
alter table public.bitrix_sessoes add column if not exists cobranca_manual boolean not null default false;
alter table public.bitrix_sessoes add column if not exists cobranca_manual_em timestamptz;
alter table public.bitrix_sessoes add column if not exists cobranca_manual_por uuid references public.perfis(id) on delete set null;

-- situacao passa a aceitar também: pedido | retornar
comment on column public.bitrix_sessoes.situacao is 'pedido | sem_resposta | promessa | nova | chamado | retornar | responder | em_dia';

-- preferências de tela de cada usuário (ex.: {"cv_layout":"horizontal"})
alter table public.perfis add column if not exists preferencias jsonb not null default '{}'::jsonb;

-- segurança: cada um pode atualizar o próprio perfil (preferências), mas só o supervisor
-- muda papel, ativo e e-mail. As funções do Netlify (service_role) não passam por aqui.
create or replace function public.proteger_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_supervisor()
     and (new.papel is distinct from old.papel or new.ativo is distinct from old.ativo or new.email is distinct from old.email) then
    raise exception 'Somente o supervisor pode alterar papel, acesso ou e-mail.';
  end if;
  return new;
end $$;
drop trigger if exists trg_proteger_perfil on public.perfis;
create trigger trg_proteger_perfil before update on public.perfis
  for each row execute function public.proteger_perfil();
