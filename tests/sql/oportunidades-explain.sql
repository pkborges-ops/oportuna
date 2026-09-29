-- Exemplos MANUAIS para homologação, depois de aplicar migration e validar paridade.
-- Substituir os UUIDs por usuário/perfil próprios. Não usar service_role na medição.
-- EXPLAIN executa SELECT; não escreve dados. Nenhuma consulta é executada automaticamente.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

explain (analyze, buffers, verbose)
select * from public.listar_oportunidades_paginadas_v1(p_ordenacao=>'mais_novas');
explain (analyze, buffers, verbose)
select * from public.listar_oportunidades_paginadas_v1(p_perfil_id=>'00000000-0000-0000-0000-000000000002',p_ordenacao=>'recomendadas');
explain (analyze, buffers, verbose)
select * from public.listar_oportunidades_paginadas_v1(p_perfil_id=>'00000000-0000-0000-0000-000000000002',p_ordenacao=>'maior_aderencia');
explain (analyze, buffers, verbose)
select * from public.listar_oportunidades_paginadas_v1(p_busca=>'software');
explain (analyze, buffers, verbose)
select * from public.listar_oportunidades_paginadas_v1(p_perfil_id=>'00000000-0000-0000-0000-000000000002',p_aderencia=>'alta');

-- PL/pgSQL pode exibir apenas Function Scan; este plano adicional inspeciona o
-- pré-filtro indexável. Para ranking, copiar o CTE da RPC com parâmetros literais
-- em homologação ou habilitar auto_explain de statements aninhados se disponível.
explain (analyze, buffers)
select id from public.oportunidades_editais
where busca_documento ilike '%software%' and
  (titulo ilike '%software%' or orgao ilike '%software%' or modalidade ilike '%software%' or cidade ilike '%software%' or objeto ilike '%software%');
rollback;
