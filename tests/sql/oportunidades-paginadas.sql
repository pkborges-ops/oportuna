-- ROTEIRO MANUAL DE INTEGRAÇÃO: executar somente em homologação após a migration.
-- Requer papel administrativo para fixtures + SET ROLE. Tudo termina em ROLLBACK.
-- Não é executado por npm test, build, workflow ou aplicação.
-- Executar o arquivo inteiro: setup e asserções ficam no mesmo bloco no servidor.
begin;
do $homologacao$
begin
begin
  if has_function_privilege('anon','public.listar_oportunidades_paginadas_v1(uuid,text,text,text,text,text,integer)','EXECUTE') then raise exception 'Anon tem execução da RPC'; end if;
  if public.matching_prazo_v1('infinity','2026-10-01') <> '2026-10-01T00:00:00Z'::timestamptz then raise exception 'Fallback de data inválida'; end if;
  if public.matching_prazo_v1(null,null) is not null then raise exception 'Prazo nulo inválido'; end if;
end;
create temporary table pg_temp.escala_fixture (u1 uuid, u2 uuid, p1 uuid, p2 uuid, alta uuid, prefixo text);
insert into pg_temp.escala_fixture select gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'escala-'||gen_random_uuid();
grant select on pg_temp.escala_fixture to authenticated;
insert into auth.users (id, email) select u1, u1||'@example.invalid' from pg_temp.escala_fixture
union all select u2,u2||'@example.invalid' from pg_temp.escala_fixture;
insert into public.perfis_empresa(id,usuario_id,nome_empresa,cnpj,segmento,porte,uf,palavras_chave)
select p1,u1,'Teste escala','00000000000001',(select string_agg('termo'||n,' ' order by n) from generate_series(1,40)n),'ME','SC','{}' from pg_temp.escala_fixture
union all select p2,u2,'Privado','00000000000002','hospital','ME','SP',array['hospital'] from pg_temp.escala_fixture;
insert into public.oportunidades_editais(id,codigo,origem,tipo,titulo,orgao,modalidade,uf,cidade,objeto,data_publicacao,data_abertura,status)
select gen_random_uuid(),prefixo||'-'||n,'PNCP','LICITACAO',prefixo||' Item '||n,'Órgão','Pregão','SP','Cidade',
  case when n=1 then prefixo||' pct% '||prefixo||' un_d' when n=2 then prefixo||' pctX '||prefixo||' unXd' else 'hospital' end,'2026-09-20','2026-10-01','aberta'
from pg_temp.escala_fixture cross join generate_series(1,25)n;
insert into public.oportunidades_editais(id,codigo,origem,tipo,titulo,orgao,modalidade,uf,cidade,objeto,data_publicacao,data_abertura,status)
select alta,prefixo||'-alta','PNCP','LICITACAO',prefixo||' Alta antiga','Órgão','Pregão','SC','Cidade',
  (select string_agg('termo'||n,' ' order by n) from generate_series(1,39)n),'2025-01-01','2027-01-01','aberta' from pg_temp.escala_fixture;
insert into public.oportunidades_favoritos(usuario_id,oportunidade_id) select u1,alta from pg_temp.escala_fixture;
perform set_config('request.jwt.claim.sub',u1::text,true) from pg_temp.escala_fixture;
perform set_config('request.jwt.claims',jsonb_build_object('sub',u1,'role','authenticated')::text,true) from pg_temp.escala_fixture;
set local role authenticated;

declare f record; r record; ids1 uuid[]; ids2 uuid[]; qtd integer; resultado jsonb;
begin
  select * into f from pg_temp.escala_fixture;
  if current_user <> 'authenticated' or (select rolsuper or rolbypassrls from pg_roles where rolname=current_user) then
    raise exception 'Teste deve executar sem superuser/BYPASSRLS'; end if;
  if exists(select 1 from public.perfis_empresa where id=f.p2) then raise exception 'RLS expôs perfil alheio'; end if;
  if not exists(select 1 from public.perfis_empresa where id=f.p1) then raise exception 'RLS ocultou perfil próprio'; end if;
  select count(*) into qtd from public.listar_oportunidades_paginadas_v1(p_perfil_id=>f.p1,p_busca=>f.prefixo);
  if qtd <> 21 then raise exception 'Listagem com perfil vazia/incompleta'; end if;
  if exists(select 1 from public.listar_oportunidades_paginadas_v1(p_busca=>f.prefixo,p_ordenacao=>'mais_novas') where (oportunidade->>'id')::uuid=f.alta) then
    raise exception 'Fixture 98 precisa ficar fora do primeiro lote por data'; end if;
  select count(*) into qtd from public.listar_oportunidades_paginadas_v1(p_perfil_id=>f.p1,p_busca=>f.prefixo,p_uf=>'SC',p_status=>'aberta');
  if qtd <> 1 then raise exception 'Filtros UF/status falharam'; end if;
  resultado := public.calcular_match_oportunidade_v1(f.p1,f.alta);
  if (resultado->>'score')::integer is distinct from 98 then raise exception 'Score próprio esperado 98'; end if;
  begin
    perform public.calcular_match_oportunidade_v1(f.p2,f.alta);
    raise exception 'Perfil alheio aceito';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.listar_oportunidades_paginadas_v1(p_perfil_id=>f.p2,p_busca=>f.prefixo);
    raise exception 'Listagem aceitou perfil alheio';
  exception when insufficient_privilege then null; end;
  select count(*) into qtd from public.listar_oportunidades_paginadas_v1(p_busca=>f.prefixo,p_aderencia=>'alta',p_ordenacao=>'maior_aderencia') where match is not null;
  if qtd <> 0 then raise exception 'Sem perfil não pode gerar score'; end if;
  select * into strict r from public.listar_oportunidades_paginadas_v1(p_perfil_id=>f.p1,p_busca=>f.prefixo,p_ordenacao=>'maior_aderencia') limit 1;
    if (r.oportunidade->>'id')::uuid <> f.alta or not r.favorito or r.match <> resultado then raise exception 'Ranking global/detalhe/favorito divergente'; end if;
  select * into strict r from public.listar_oportunidades_paginadas_v1(p_perfil_id=>f.p1,p_busca=>f.prefixo) limit 1;
    if (r.oportunidade->>'id')::uuid <> f.alta then raise exception 'Recomendadas não globais'; end if;
  select count(*) into qtd from public.listar_oportunidades_paginadas_v1(p_perfil_id=>f.p1,p_busca=>f.prefixo,p_aderencia=>'alta');
  if qtd <> 1 then raise exception 'Aderência precisa filtrar antes do corte'; end if;
  select * into strict r from public.listar_oportunidades_paginadas_v1(p_perfil_id=>f.p1,p_busca=>f.prefixo,p_ordenacao=>'mais_novas') limit 1;
    if (r.oportunidade->>'id')::uuid = f.alta then raise exception 'Mais novas incorreta'; end if;
  select * into strict r from public.listar_oportunidades_paginadas_v1(p_perfil_id=>f.p1,p_busca=>f.prefixo,p_ordenacao=>'prazo_proximo') limit 1;
    if (r.oportunidade->>'id')::uuid = f.alta then raise exception 'Prazo incorreto'; end if;
  select array_agg((oportunidade->>'id')::uuid) into ids1 from public.listar_oportunidades_paginadas_v1(p_busca=>f.prefixo,p_ordenacao=>'mais_novas');
  if cardinality(ids1) <> 21 then raise exception 'RPC deve retornar sentinela 21'; end if;
  select array_agg((oportunidade->>'id')::uuid) into ids2 from public.listar_oportunidades_paginadas_v1(p_busca=>f.prefixo,p_ordenacao=>'mais_novas',p_pagina=>2);
  if cardinality(ids2) <> 6 or ids1[1:20] && ids2 then raise exception 'Paginação repete ou perde itens'; end if;
  if ids1 <> (select array_agg(x order by x) from unnest(ids1)x) then raise exception 'ID não desempata'; end if;
  select count(*) into qtd from public.listar_oportunidades_paginadas_v1(p_busca=>f.prefixo||' pct%');
  if qtd <> 1 then raise exception 'Busca literal percentual falhou'; end if;
  select count(*) into qtd from public.listar_oportunidades_paginadas_v1(p_busca=>f.prefixo||' un_d');
  if qtd <> 1 then raise exception 'Busca literal underscore falhou'; end if;
  -- Este teste isolado também garante que '%' não lista todos os 26 itens.
  select count(*) into qtd from public.listar_oportunidades_paginadas_v1(p_busca=>f.prefixo||' Item 1');
  if qtd <> 11 then raise exception 'Substring não preservada'; end if;
  select count(*) into qtd from public.listar_oportunidades_paginadas_v1(p_busca=>f.prefixo||' Item 1'||chr(10)||'Órgão');
  if qtd <> 0 then raise exception 'Falso positivo entre campos'; end if;
  raise notice 'RPC: autorização, ranking, filtros, datas, paginação, favorito e ID OK';
end;
reset role;
-- Colunas geradas se mantêm mesmo em escrita SQL direta.
update public.oportunidades_editais set tags=array['gerada'], cidade='Teste derivado' where id=(select alta from pg_temp.escala_fixture);
begin
  if not exists(select 1 from public.oportunidades_editais where id=(select alta from pg_temp.escala_fixture)
    and matching_tokens @> array['gerada'] and busca_documento like '%Teste derivado%') then
    raise exception 'Colunas geradas desatualizadas'; end if;
end;
-- Alterações de status não mudam score; prazo da participação prevalece sobre abertura.
update public.oportunidades_editais set status='encerrada',participacao_prazo_limite='2020-01-01T00:00:00Z'
where id=(select alta from pg_temp.escala_fixture);
set local role authenticated;
declare f record; r record; begin
  select * into f from pg_temp.escala_fixture;
  if (public.calcular_match_oportunidade_v1(f.p1,f.alta)->>'score')::integer<>98 then raise exception 'Status mudou score'; end if;
  select * into strict r from public.listar_oportunidades_paginadas_v1(p_perfil_id=>f.p1,p_busca=>f.prefixo) limit 1;
  if (r.oportunidade->>'id')::uuid=f.alta then raise exception 'Encerrada passou aberta em recomendadas'; end if;
  select * into strict r from public.listar_oportunidades_paginadas_v1(p_perfil_id=>f.p1,p_busca=>f.prefixo,p_ordenacao=>'maior_aderencia') limit 1;
  if (r.oportunidade->>'id')::uuid<>f.alta then raise exception 'Maior aderência deixou de priorizar score'; end if;
end;
reset role;
update public.oportunidades_editais set status='aberta' where id=(select alta from pg_temp.escala_fixture);
set local role authenticated;
declare f record; r record; begin
  select * into f from pg_temp.escala_fixture;
  select * into strict r from public.listar_oportunidades_paginadas_v1(p_busca=>f.prefixo,p_ordenacao=>'prazo_proximo') limit 1;
  if (r.oportunidade->>'id')::uuid<>f.alta then raise exception 'Prazo de participação não prevaleceu'; end if;
end;
reset role;
-- Troca usuário: favorito do primeiro usuário nunca deve vazar.
perform set_config('request.jwt.claim.sub',u2::text,true) from pg_temp.escala_fixture;
perform set_config('request.jwt.claims',jsonb_build_object('sub',u2,'role','authenticated')::text,true) from pg_temp.escala_fixture;
set local role authenticated;
declare f record; begin
  select * into f from pg_temp.escala_fixture;
  if current_user <> 'authenticated' or auth.uid() is distinct from f.u2 then raise exception 'Contexto do segundo usuário inválido'; end if;
  if exists(select 1 from public.perfis_empresa where id=f.p1) then raise exception 'RLS expôs perfil do primeiro usuário'; end if;
  if not exists(select 1 from public.perfis_empresa where id=f.p2) then raise exception 'Segundo perfil próprio invisível'; end if;
  if exists(select 1 from public.oportunidades_favoritos where usuario_id=f.u1) then raise exception 'RLS expôs favorito diretamente'; end if;
  if public.calcular_match_oportunidade_v1(f.p2,f.alta) is null then raise exception 'RPC própria do segundo usuário falhou'; end if;
  begin
    perform public.calcular_match_oportunidade_v1(f.p1,f.alta);
    raise exception 'Segundo usuário acessou primeiro perfil';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.oportunidades_favoritos(usuario_id,oportunidade_id) values(f.u1,f.alta);
    raise exception 'Segundo usuário escreveu favorito alheio';
  exception when insufficient_privilege then null; end;
  -- O item favoritado antigo deve estar efetivamente presente para comprovar isolamento.
  if not exists(select 1 from public.listar_oportunidades_paginadas_v1(p_busca=>f.prefixo,p_uf=>'SC') where (oportunidade->>'id')::uuid=f.alta and favorito=false) then
    raise exception 'Favorito alheio ausente ou exposto na RPC'; end if;
  if exists(select 1 from public.listar_oportunidades_paginadas_v1(p_busca=>f.prefixo) where favorito) then raise exception 'Favorito de outro usuário vazou'; end if;
end;
reset role;
-- Sem JWT, execução deve ser rejeitada mesmo com permissão de EXECUTE.
perform set_config('request.jwt.claim.sub','',true);
perform set_config('request.jwt.claims','{}',true);
set local role authenticated;
begin
  begin perform * from public.listar_oportunidades_paginadas_v1(); raise exception 'Não autenticado aceito';
  exception when insufficient_privilege then null; end;
end;
reset role;

end;
$homologacao$;
rollback;
