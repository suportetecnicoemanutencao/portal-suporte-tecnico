-- =========================================================
-- PORTAL SUPORTE TÉCNICO · 008c — permissões das tabelas de máquinas
-- Este projeto do Supabase não libera tabelas novas automaticamente para o portal
-- (por isso a busca voltava vazia). Rode uma vez, depois do 008.
-- =========================================================
grant select, insert, update, delete on public.maquinas_aluguel, public.maquinas_bloqueio, public.maquinas_bloqueio_hist to authenticated;
grant all on public.maquinas_aluguel, public.maquinas_bloqueio, public.maquinas_bloqueio_hist to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on function public.is_financeiro(), public.is_equipe(), public.is_supervisor() to authenticated, service_role;

-- conferência: deve mostrar 373 (se mostrar 0, rode o 008b_maquinas_carga.sql)
select count(*) as maquinas_na_base from public.maquinas_aluguel;
