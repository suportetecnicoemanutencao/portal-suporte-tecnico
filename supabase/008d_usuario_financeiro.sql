-- PORTAL SUPORTE TÉCNICO · 008d — transforma o usuário do financeiro em papel "financeiro"
-- (ao ser criado, todo usuário entra como "auxiliar"). Rode depois do 008.
update public.perfis
   set papel = 'financeiro', nome = 'Financeiro', ativo = true
 where lower(email) = 'financeiro@nebulize.com.br';

-- conferência: deve aparecer papel = financeiro
select email, nome, papel, ativo from public.perfis where lower(email) = 'financeiro@nebulize.com.br';
