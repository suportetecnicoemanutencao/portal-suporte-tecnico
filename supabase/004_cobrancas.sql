-- =========================================================
-- PORTAL SUPORTE TÉCNICO · atualização 004
-- "Minhas conversas": cobranças citadas no chat + botão Respondido + status do atendimento.
-- Rode no SQL Editor do Supabase (uma vez), depois do 003.
-- =========================================================
alter table public.bitrix_sessoes add column if not exists cobranca boolean not null default false;
alter table public.bitrix_sessoes add column if not exists cobranca_texto text;
alter table public.bitrix_sessoes add column if not exists cobranca_em timestamptz;
alter table public.bitrix_sessoes add column if not exists cobranca_msg_id bigint;
alter table public.bitrix_sessoes add column if not exists cobranca_feita_msg_id bigint;   -- "Cobrança feita" até aparecer novo pedido
alter table public.bitrix_sessoes add column if not exists cobranca_feita_em timestamptz;
