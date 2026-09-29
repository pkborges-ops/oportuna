-- MANUAL: somente projeto oportuna-homologacao (uzmgxxhiedevsxedgqij).
-- Conferir o projeto no painel antes de executar TODO o arquivo.
-- Rodar depois dos dez lotes e do ANALYZE. Um cenário por chamada.
-- cenario: 1 mais novas; 2 recomendadas; 3 aderência; 4 busca;
-- 5 aderência alta; 6 página profunda; 7 predicado textual.
begin;
set local statement_timeout = '120s';
do $medicao$
declare cenario integer := 1; pagina integer := 2500; plano json; nome text;
begin
  if (select count(*) from public.oportunidades_editais) <> 50000 or
     exists(select 1 from public.oportunidades_editais where codigo !~ '^escala-bench-v1-[0-9]+$') then
    raise exception 'Esperados 50000 registros sintéticos e nenhum outro'; end if;
  perform set_config('request.jwt.claim.sub','a63a0c83-514d-4c70-8c93-68238d4b8101',true);
  perform set_config('request.jwt.claims','{"sub":"a63a0c83-514d-4c70-8c93-68238d4b8101","role":"authenticated"}',true);
  set local role authenticated;
  if current_user <> 'authenticated' or (select rolsuper or rolbypassrls from pg_roles where rolname=current_user) then
    raise exception 'Papel deve estar sujeito a RLS'; end if;
  case cenario
    when 1 then
      nome := 'Sem perfil / mais novas';
      execute $consulta$explain (analyze,buffers,verbose,format json) select * from public.listar_oportunidades_paginadas_v1(p_ordenacao=>'mais_novas')$consulta$ into plano;
    when 2 then
      nome := 'Perfil / recomendadas';
      execute $consulta$explain (analyze,buffers,verbose,format json) select * from public.listar_oportunidades_paginadas_v1(p_perfil_id=>'a63a0c83-514d-4c70-8c93-68238d4b8102'::uuid)$consulta$ into plano;
    when 3 then
      nome := 'Perfil / maior aderencia';
      execute $consulta$explain (analyze,buffers,verbose,format json) select * from public.listar_oportunidades_paginadas_v1(p_perfil_id=>'a63a0c83-514d-4c70-8c93-68238d4b8102'::uuid,p_ordenacao=>'maior_aderencia')$consulta$ into plano;
    when 4 then
      nome := 'Busca textual';
      execute $consulta$explain (analyze,buffers,verbose,format json) select * from public.listar_oportunidades_paginadas_v1(p_busca=>'software')$consulta$ into plano;
    when 5 then
      nome := 'Perfil / aderencia alta';
      execute $consulta$explain (analyze,buffers,verbose,format json) select * from public.listar_oportunidades_paginadas_v1(p_perfil_id=>'a63a0c83-514d-4c70-8c93-68238d4b8102'::uuid,p_aderencia=>'alta')$consulta$ into plano;
    when 6 then
      nome := 'Perfil / pagina ' || pagina;
      execute $consulta$explain (analyze,buffers,verbose,format json)
        select * from public.listar_oportunidades_paginadas_v1(
          p_perfil_id=>'a63a0c83-514d-4c70-8c93-68238d4b8102'::uuid,p_pagina=>$1)$consulta$
        into plano using pagina;
    when 7 then
      nome := 'Predicado textual / plano interno do indice';
      execute $consulta$explain (analyze,buffers,verbose,format json) select id from public.oportunidades_editais where busca_documento ilike '%software%' and
  (titulo ilike '%software%' or orgao ilike '%software%' or modalidade ilike '%software%' or cidade ilike '%software%' or objeto ilike '%software%')$consulta$ into plano;
    else raise exception 'Cenário deve ser 1 a 7';
  end case;
  reset role;
  perform set_config('escala.resultado',jsonb_build_object('tamanho',50000,'postgres',version(),
    'resultados',jsonb_build_array(jsonb_build_object('cenario',nome,'plano',plano::jsonb)))::text,true);
end;
$medicao$;
select current_setting('escala.resultado')::jsonb as resultado_benchmark;
rollback;
