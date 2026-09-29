-- MANUAL: somente oportuna-homologacao / uzmgxxhiedevsxedgqij.
-- Não altera funções, dados ou estatísticas. Executar inteiro, um cenário por vez.
-- 1 interno recomendadas; 2 leitura tokens; 3 matcher sem sort/cards;
-- 4 preparar perfil; 5 normalizar UF; 6 interno página 2500.
begin;
set local statement_timeout = '120s';
do $diagnostico$
declare
  cenario integer := 5;
  fonte text; consulta text; plano json; perfil jsonb; inicio integer;
  palavras_score text[]; segmento_score text[]; uf_score text; uf_score_valida boolean;
  nome text; definicoes jsonb;
begin
  select prosrc into strict fonte from pg_proc where oid=
    'public.listar_oportunidades_paginadas_v1(uuid,text,text,text,text,text,integer)'::regprocedure;
  fonte := replace(fonte,chr(13),'');
  select jsonb_object_agg(p.proname,pg_get_functiondef(p.oid)) into definicoes
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in
    ('listar_oportunidades_paginadas_v1','matching_calcular_v1','matching_score_v1',
     'matching_preparar_score_v1','matching_preparar_v1','matching_perfil_autorizado_v1');
  perform set_config('request.jwt.claim.sub','a63a0c83-514d-4c70-8c93-68238d4b8101',true);
  perform set_config('request.jwt.claims','{"sub":"a63a0c83-514d-4c70-8c93-68238d4b8101","role":"authenticated"}',true);
  set local role authenticated;
  if current_user <> 'authenticated' or (select rolsuper or rolbypassrls from pg_roles where rolname=current_user) then
    raise exception 'Diagnóstico deve executar sujeito a RLS'; end if;
  perfil := public.matching_perfil_autorizado_v1('a63a0c83-514d-4c70-8c93-68238d4b8102');
  select ps.palavras,ps.segmento,ps.uf,ps.uf_valida
    into palavras_score,segmento_score,uf_score,uf_score_valida
    from public.matching_preparar_score_v1(perfil) ps;
  if (select count(*) from public.oportunidades_editais) <> 50000 then raise exception 'Esperados 50000 registros'; end if;
  if cenario in (1,6) then
    inicio := strpos(fonte,'with elegiveis as materialized (');
    if inicio=0 then raise exception 'Estrutura da RPC mudou: revisar extrator'; end if;
    -- btrim sem segundo argumento só retira espaços; prosrc termina com newline.
    consulta := btrim(split_part(substr(fonte,inicio),'end;',1), E' \t\r\n');
    if right(consulta,1) <> ';' or strpos(consulta,'order by p.posicao;')=0 then
      raise exception 'SELECT interno não reconhecido'; end if;
    -- Substituir apenas identificadores PL/pgSQL; manter CTEs, filtros e ordem reais.
    consulta := regexp_replace(consulta,'\mperfil\M','$1','g');
    consulta := regexp_replace(consulta,'\mmodo\M','$2','g');
    consulta := regexp_replace(consulta,'\mp_status\M','$3','g');
    consulta := regexp_replace(consulta,'\muf_filtro\M','$4','g');
    consulta := regexp_replace(consulta,'\mtermo\M','$5','g');
    consulta := regexp_replace(consulta,'\mpadrao\M','$6','g');
    consulta := regexp_replace(consulta,'\mnivel\M','$7','g');
    consulta := regexp_replace(consulta,'\mp_pagina\M','$8','g');
    consulta := regexp_replace(consulta,'\mpalavras_score\M','$9','g');
    consulta := regexp_replace(consulta,'\msegmento_score\M','$10','g');
    consulta := regexp_replace(consulta,'\muf_score_valida\M','$12','g');
    consulta := regexp_replace(consulta,'\muf_score\M','$11','g');
    nome := case when cenario=1 then 'Interno recomendadas' else 'Interno página 2500' end;
    execute 'explain (analyze,buffers,verbose,format json) ' || consulta into plano
      using perfil,'recomendadas'::text,null::text,null::text,null::text,null::text,null::text,
        case when cenario=1 then 1 else 2500 end,palavras_score,segmento_score,uf_score,uf_score_valida;
  elsif cenario=2 then
    nome := 'Leitura tokens sem matcher';
    consulta := 'select sum(cardinality(matching_tokens)),sum(octet_length(uf::text)) from public.oportunidades_editais';
    execute 'explain (analyze,buffers,verbose,format json) '||consulta into plano;
  elsif cenario=3 then
    nome := 'Matcher scalar sem sort/cards/favoritos (perfil preparado uma vez)';
    consulta := $sql$with p as materialized (
      select * from public.matching_preparar_score_v1($1)
    )
    select sum(public.matching_score_v1(
      p.palavras,p.segmento,p.uf,p.uf_valida,
      o.matching_tokens,o.uf))
    from public.oportunidades_editais o cross join p$sql$;
    execute 'explain (analyze,buffers,verbose,format json) '||consulta into plano using perfil;
  elsif cenario=4 then
    nome := 'Preparação/autorização uma vez';
    consulta := $sql$select * from public.matching_preparar_score_v1(
      public.matching_perfil_autorizado_v1('a63a0c83-514d-4c70-8c93-68238d4b8102'::uuid))$sql$;
    execute 'explain (analyze,buffers,verbose,format json) '||consulta into plano;
  elsif cenario=5 then
    nome := 'Normalização de UF por registro';
    consulta := $sql$select sum(octet_length(public.matching_upper_v1(public.matching_trim_v1(coalesce(uf,''))))) from public.oportunidades_editais$sql$;
    execute 'explain (analyze,buffers,verbose,format json) '||consulta into plano;
  else raise exception 'Cenário deve ser 1 a 6';
  end if;
  reset role;
  perform set_config('escala.diagnostico',jsonb_build_object('cenario',nome,'plano',plano::jsonb,
    'sql_medido',consulta,'definicoes_instaladas',definicoes,'postgres',version(),
    'work_mem',current_setting('work_mem'),'jit',current_setting('jit'),
    'observacao','EXECUTE planeja por chamada; não reproduz eventual plano genérico em cache da RPC')::text,true);
end;
$diagnostico$;
select current_setting('escala.diagnostico')::jsonb as resultado_diagnostico;
rollback;
