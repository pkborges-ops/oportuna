-- MANUAL: somente projeto oportuna-homologacao (uzmgxxhiedevsxedgqij).
-- Conferir o projeto no painel antes de executar TODO o arquivo.
-- Executar SOMENTE após guardar todos os resultados. Remove apenas a fixture.
begin;
do $limpeza$
begin
  if not exists(select 1 from auth.users where id='a63a0c83-514d-4c70-8c93-68238d4b8101' and email='escala-bench-v1@example.invalid') then
    raise exception 'Identidade da fixture não confere'; end if;
  delete from public.oportunidades_favoritos where usuario_id='a63a0c83-514d-4c70-8c93-68238d4b8101'
    and oportunidade_id in(select id from public.oportunidades_editais where codigo ~ '^escala-bench-v1-[0-9]+$');
  delete from public.oportunidades_editais where codigo ~ '^escala-bench-v1-[0-9]+$';
  delete from public.perfis_empresa where id='a63a0c83-514d-4c70-8c93-68238d4b8102' and usuario_id='a63a0c83-514d-4c70-8c93-68238d4b8101';
  -- Usuário sintético é mantido para evitar cascatas sobre dados não previstos.
end;
$limpeza$;
commit;
select count(*) as oportunidades_sinteticas_restantes from public.oportunidades_editais where codigo ~ '^escala-bench-v1-[0-9]+$';
