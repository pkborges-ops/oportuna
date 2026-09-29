-- SQL Editor: somente oportuna-homologacao, executar TODO o arquivo.
-- Alterar apenas tamanho: 1000, depois 10000 e 50000.
-- Massa sintética; nenhuma medição foi previamente executada.
begin;
set local statement_timeout = '120s';
do $benchmark$
declare
  tamanho integer := 1000;
  plano json;
  resultados jsonb := '[]'::jsonb;
begin
  if tamanho not in (1000,10000,50000) then raise exception 'Tamanho inválido'; end if;
  if exists(select 1 from public.oportunidades_editais) then
    raise exception 'Requer homologação vazia; não apague dados, use projeto descartável'; end if;
  perform set_config('escala.tamanho', tamanho::text, true);
create temporary table pg_temp.benchmark_contexto(u uuid, p uuid);
insert into pg_temp.benchmark_contexto values(gen_random_uuid(),gen_random_uuid());
grant select on pg_temp.benchmark_contexto to authenticated;
insert into auth.users(id,email) select u,u||'@example.invalid' from pg_temp.benchmark_contexto;
insert into public.perfis_empresa(id,usuario_id,nome_empresa,cnpj,segmento,porte,uf,palavras_chave)
select p,u,'Benchmark sintético','00000000000003','tecnologia software','ME','SC',array['software','gestão pública','suporte'] from pg_temp.benchmark_contexto;
insert into public.oportunidades_editais(codigo,origem,tipo,titulo,orgao,modalidade,uf,cidade,objeto,data_publicacao,data_abertura,status,tags)
select 'benchmark-'||n,'PNCP','LICITACAO','Aquisição '||n,'Órgão '||(n%100),'Pregão',
  (array['SC','SP','RJ','MG','PR'])[1+n%5],'Cidade '||(n%200),
  (array['software tecnologia gestão pública suporte','hospital medicamentos','obras engenharia','serviços de limpeza','software licenças'])[1+n%5] || ' ' || repeat('Especificações públicas do objeto. ',30),
  date '2026-01-01'+n%270,date '2026-10-01'+n%120,
  (array['aberta','aberta','aberta','em_analise','encerrada'])[1+n%5],
  array['aquisição','item-'||(n%20)]
from generate_series(1,current_setting('escala.tamanho')::integer)n;
insert into public.oportunidades_favoritos(usuario_id,oportunidade_id)
select c.u,o.id from pg_temp.benchmark_contexto c cross join public.oportunidades_editais o where o.codigo like '%00';
analyze public.oportunidades_editais;
analyze public.perfis_empresa;
analyze public.oportunidades_favoritos;

  perform set_config('request.jwt.claim.sub',u::text,true),
    set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true)
  from pg_temp.benchmark_contexto;
  set local role authenticated;
  if current_user <> 'authenticated' or (select rolsuper or rolbypassrls from pg_roles where rolname=current_user) then
    raise exception 'Benchmark requer papel sujeito a RLS'; end if;
  execute $consulta$explain (analyze,buffers,verbose,format json) select * from public.listar_oportunidades_paginadas_v1(p_ordenacao=>'mais_novas')$consulta$ into plano;
  resultados := resultados || jsonb_build_array(jsonb_build_object('cenario','Sem perfil / mais novas','plano',plano::jsonb));
  execute $consulta$explain (analyze,buffers,verbose,format json) select * from public.listar_oportunidades_paginadas_v1(p_perfil_id=>(select p from pg_temp.benchmark_contexto))$consulta$ into plano;
  resultados := resultados || jsonb_build_array(jsonb_build_object('cenario','Perfil / recomendadas','plano',plano::jsonb));
  execute $consulta$explain (analyze,buffers,verbose,format json) select * from public.listar_oportunidades_paginadas_v1(p_perfil_id=>(select p from pg_temp.benchmark_contexto),p_ordenacao=>'maior_aderencia')$consulta$ into plano;
  resultados := resultados || jsonb_build_array(jsonb_build_object('cenario','Perfil / maior aderencia','plano',plano::jsonb));
  execute $consulta$explain (analyze,buffers,verbose,format json) select * from public.listar_oportunidades_paginadas_v1(p_busca=>'software')$consulta$ into plano;
  resultados := resultados || jsonb_build_array(jsonb_build_object('cenario','Busca textual','plano',plano::jsonb));
  execute $consulta$explain (analyze,buffers,verbose,format json) select * from public.listar_oportunidades_paginadas_v1(p_perfil_id=>(select p from pg_temp.benchmark_contexto),p_aderencia=>'alta')$consulta$ into plano;
  resultados := resultados || jsonb_build_array(jsonb_build_object('cenario','Perfil / aderencia alta','plano',plano::jsonb));
  execute $consulta$explain (analyze,buffers,verbose,format json) select * from public.listar_oportunidades_paginadas_v1(p_perfil_id=>(select p from pg_temp.benchmark_contexto),p_pagina=>current_setting('escala.tamanho')::integer/20)$consulta$ into plano;
  resultados := resultados || jsonb_build_array(jsonb_build_object('cenario','Perfil / pagina profunda','plano',plano::jsonb));
  execute $consulta$explain (analyze,buffers,verbose,format json) select id from public.oportunidades_editais where busca_documento ilike '%software%' and
  (titulo ilike '%software%' or orgao ilike '%software%' or modalidade ilike '%software%' or cidade ilike '%software%' or objeto ilike '%software%')$consulta$ into plano;
  resultados := resultados || jsonb_build_array(jsonb_build_object('cenario','Predicado textual / plano interno do indice','plano',plano::jsonb));
  reset role;
  perform set_config('escala.resultado',jsonb_build_object('tamanho',tamanho,'postgres',version(),
    'encoding',current_setting('server_encoding'),'collation',(select datcollate from pg_catalog.pg_database where datname=current_database()),
    'resultados',resultados)::text,true);
end;
$benchmark$;
select current_setting('escala.resultado')::jsonb as resultado_benchmark;
rollback;
