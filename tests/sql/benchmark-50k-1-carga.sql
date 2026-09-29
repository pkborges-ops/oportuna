-- MANUAL: somente projeto oportuna-homologacao (uzmgxxhiedevsxedgqij).
-- Conferir o projeto no painel antes de executar TODO o arquivo.
-- Dados sintéticos PERSISTEM até a limpeza; não é migration.
-- Executar lote 1, depois 2 até 10. Repetir o mesmo lote não duplica registros.
begin;
set local statement_timeout = '120s';
do $carga$
declare lote integer := 1;
begin
  if lote not between 1 and 10 then raise exception 'Lote deve ser 1 a 10'; end if;
  if exists(select 1 from public.oportunidades_editais where codigo !~ '^escala-bench-v1-[0-9]+$') then
    raise exception 'Base contém dados fora desta fixture. Parar sem apagar dados'; end if;
  if exists(select 1 from auth.users where id='a63a0c83-514d-4c70-8c93-68238d4b8101' and email is distinct from 'escala-bench-v1@example.invalid') then
    raise exception 'Colisão de usuário'; end if;
  if exists(select 1 from public.perfis_empresa where id='a63a0c83-514d-4c70-8c93-68238d4b8102' and (usuario_id<>'a63a0c83-514d-4c70-8c93-68238d4b8101' or nome_empresa<>'Benchmark sintético')) then
    raise exception 'Colisão de perfil'; end if;
  insert into auth.users(id,email) values('a63a0c83-514d-4c70-8c93-68238d4b8101','escala-bench-v1@example.invalid') on conflict(id) do nothing;
  insert into public.perfis_empresa(id,usuario_id,nome_empresa,cnpj,segmento,porte,uf,palavras_chave)
  values('a63a0c83-514d-4c70-8c93-68238d4b8102','a63a0c83-514d-4c70-8c93-68238d4b8101','Benchmark sintético','00000000000003','tecnologia software','ME','SC',array['software','gestão pública','suporte']) on conflict(id) do nothing;
insert into public.oportunidades_editais(codigo,origem,tipo,titulo,orgao,modalidade,uf,cidade,objeto,data_publicacao,data_abertura,status,tags)
select 'escala-bench-v1-'||n,'PNCP','LICITACAO','Aquisição '||n,'Órgão '||(n%100),'Pregão',
  (array['SC','SP','RJ','MG','PR'])[1+n%5],'Cidade '||(n%200),
  (array['software tecnologia gestão pública suporte','hospital medicamentos','obras engenharia','serviços de limpeza','software licenças'])[1+n%5] || ' ' || repeat('Especificações públicas do objeto. ',30),
  date '2026-01-01'+n%270,date '2026-10-01'+n%120,
  (array['aberta','aberta','aberta','em_analise','encerrada'])[1+n%5],
  array['aquisição','item-'||(n%20)]
from generate_series((lote-1)*5000+1,lote*5000)n on conflict (codigo) do nothing;

  insert into public.oportunidades_favoritos(usuario_id,oportunidade_id)
  select 'a63a0c83-514d-4c70-8c93-68238d4b8101',id from public.oportunidades_editais where codigo ~ '^escala-bench-v1-[0-9]+$' and codigo like '%00'
  on conflict do nothing;
end;
$carga$;
commit;
select count(*) as oportunidades_sinteticas from public.oportunidades_editais where codigo ~ '^escala-bench-v1-[0-9]+$';
