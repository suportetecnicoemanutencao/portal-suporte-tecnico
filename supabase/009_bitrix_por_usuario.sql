-- =========================================================
-- PORTAL SUPORTE TÉCNICO · atualização 009
-- "Conectar meu Bitrix": cada auxiliar cola no portal o webhook dela (igual ao Monitor
-- da Katielen). O monitor lê a lista de Canais Abertos de cada uma a cada minuto, então
-- aparecem TODAS as conversas que ela vê no Bitrix.
-- O webhook fica numa tabela que o navegador NÃO consegue ler (só as funções do Netlify).
-- Rode no SQL Editor do Supabase (uma vez), depois do 008c.
-- =========================================================
create table if not exists public.bitrix_webhooks (
  perfil_id uuid primary key references public.perfis(id) on delete cascade,
  bitrix_user_id bigint not null,
  webhook text not null,
  validado_em timestamptz not null default now()
);
alter table public.bitrix_webhooks enable row level security;   -- sem políticas: só service_role
revoke all on public.bitrix_webhooks from anon, authenticated;
grant all on public.bitrix_webhooks to service_role;

-- o portal mostra se a lista do Bitrix de cada usuária está conectada e quando foi lida
alter table public.perfis add column if not exists bitrix_conectado_em timestamptz;
alter table public.perfis add column if not exists bitrix_lista_em timestamptz;
alter table public.perfis add column if not exists bitrix_lista_erro text;
