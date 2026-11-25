-- =========================================================
-- PORTAL SUPORTE TÉCNICO · atualização 007
-- "Minhas conversas": escolher a responsável da conversa no portal
-- e adicionar uma conversa pelo nº (quando ela não apareceu sozinha).
-- Rode no SQL Editor do Supabase (uma vez), depois do 006.
-- =========================================================
alter table public.bitrix_sessoes add column if not exists responsavel_manual uuid references public.perfis(id) on delete set null;
alter table public.bitrix_sessoes add column if not exists responsavel_manual_em timestamptz;
alter table public.bitrix_sessoes add column if not exists responsavel_manual_por uuid references public.perfis(id) on delete set null;
create index if not exists idx_bxs_resp_manual on public.bitrix_sessoes(responsavel_manual) where responsavel_manual is not null;

-- qualquer pessoa da equipe pode repassar a conversa, pausar, marcar cobrança e respondido
drop policy if exists bxs_upd on public.bitrix_sessoes;
create policy bxs_upd on public.bitrix_sessoes for update to authenticated
  using (public.is_equipe()) with check (public.is_equipe());
