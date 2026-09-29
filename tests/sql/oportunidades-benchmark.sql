-- Somente banco DESCARTÁVEL, vazio de oportunidades. Executar via psql.
-- psql -X -v ON_ERROR_STOP=1 -v tamanho=1000 -f tests/sql/oportunidades-benchmark.sql
-- Repetir com tamanho=10000 e 50000. Todos os dados sintéticos sofrem ROLLBACK.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '120s';
select set_config('escala.tamanho', :'tamanho', true);
do $$ begin
  if current_setting('escala.tamanho')::integer not in (1000,10000,50000) then
    raise exception 'Tamanho permitido: 1000, 10000 ou 50000'; end if;
  if exists(select 1 from public.oportunidades_editais) then
    raise exception 'Benchmark exige banco descartável sem oportunidades'; end if;
end; $$;
create temporary table benchmark_contexto(u uuid, p uuid);
insert into benchmark_contexto values(gen_random_uuid(),gen_random_uuid());
grant select on benchmark_contexto to authenticated;
insert into auth.users(id,email) select u,u||'@example.invalid' from benchmark_contexto;
insert into public.perfis_empresa(id,usuario_id,nome_empresa,cnpj,segmento,porte,uf,palavras_chave)
select p,u,'Benchmark sintético','00000000000003','tecnologia software','ME','SC',array['software','gestão pública','suporte'] from benchmark_contexto;
insert into public.oportunidades_editais(codigo,origem,tipo,titulo,orgao,modalidade,uf,cidade,objeto,data_publicacao,data_abertura,status,tags)
select 'benchmark-'||n,'PNCP','LICITACAO','Aquisição '||n,'Órgão '||(n%100),'Pregão',
  (array['SC','SP','RJ','MG','PR'])[1+n%5],'Cidade '||(n%200),
  (array['software tecnologia gestão pública suporte','hospital medicamentos','obras engenharia','serviços de limpeza','software licenças'])[1+n%5] || ' ' || repeat('Especificações públicas do objeto. ',30),
  date '2026-01-01'+n%270,date '2026-10-01'+n%120,
  (array['aberta','aberta','aberta','em_analise','encerrada'])[1+n%5],
  array['aquisição','item-'||(n%20)]
from generate_series(1,current_setting('escala.tamanho')::integer)n;
insert into public.oportunidades_favoritos(usuario_id,oportunidade_id)
select c.u,o.id from benchmark_contexto c cross join public.oportunidades_editais o where o.codigo like '%00';
analyze public.oportunidades_editais;
analyze public.perfis_empresa;
analyze public.oportunidades_favoritos;
select version(),current_setting('server_encoding'),(select datcollate from pg_catalog.pg_database where datname=current_database()),current_setting('escala.tamanho') as tamanho;
select set_config('request.jwt.claim.sub',u::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true) from benchmark_contexto;
set local role authenticated;
do $$ begin
  if current_user <> 'authenticated' or (select rolsuper or rolbypassrls from pg_roles where rolname=current_user) then
    raise exception 'Benchmark requer papel sujeito a RLS'; end if;
end; $$;
\echo Sem perfil / mais novas
explain (analyze,buffers,verbose) select * from public.listar_oportunidades_paginadas_v1(p_ordenacao=>'mais_novas');
\echo Perfil / recomendadas
explain (analyze,buffers,verbose) select * from public.listar_oportunidades_paginadas_v1(p_perfil_id=>(select p from benchmark_contexto));
\echo Perfil / maior aderencia
explain (analyze,buffers,verbose) select * from public.listar_oportunidades_paginadas_v1(p_perfil_id=>(select p from benchmark_contexto),p_ordenacao=>'maior_aderencia');
\echo Busca textual
explain (analyze,buffers,verbose) select * from public.listar_oportunidades_paginadas_v1(p_busca=>'software');
\echo Perfil / aderencia alta
explain (analyze,buffers,verbose) select * from public.listar_oportunidades_paginadas_v1(p_perfil_id=>(select p from benchmark_contexto),p_aderencia=>'alta');
\echo Perfil / pagina profunda
explain (analyze,buffers,verbose) select * from public.listar_oportunidades_paginadas_v1(p_perfil_id=>(select p from benchmark_contexto),p_pagina=>current_setting('escala.tamanho')::integer/20);
\echo Predicado textual / plano interno do indice
explain (analyze,buffers,verbose) select id from public.oportunidades_editais where busca_documento ilike '%software%' and
  (titulo ilike '%software%' or orgao ilike '%software%' or modalidade ilike '%software%' or cidade ilike '%software%' or objeto ilike '%software%');
reset role;
rollback;
