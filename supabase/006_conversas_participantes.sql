-- =========================================================
-- PORTAL SUPORTE TÉCNICO · atualização 006
-- "Minhas conversas" igual à lista do Bitrix de cada usuária:
-- além da responsável, a conversa aparece para quem a tem na lista (gerente da conversa,
-- convidada ou conversa ainda na fila). Lido com o webhook de cada usuária
-- (variável BITRIX_WEBHOOKS_USUARIOS no Netlify).
-- Rode no SQL Editor do Supabase (uma vez), depois do 005.
-- =========================================================
alter table public.bitrix_sessoes add column if not exists participantes uuid[] not null default '{}';
alter table public.bitrix_sessoes add column if not exists na_fila boolean not null default false;
create index if not exists idx_bxs_participantes on public.bitrix_sessoes using gin (participantes);

-- quem vê a conversa na lista também pode Pausar, Cobrar e marcar Respondido
drop policy if exists bxs_upd on public.bitrix_sessoes;
create policy bxs_upd on public.bitrix_sessoes for update to authenticated
  using (operador = auth.uid() or auth.uid() = any(participantes) or public.is_supervisor())
  with check (operador = auth.uid() or auth.uid() = any(participantes) or public.is_supervisor());
