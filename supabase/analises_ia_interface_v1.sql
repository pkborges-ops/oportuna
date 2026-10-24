-- Instalar após IA v1, conteúdo v2 e adaptador financeiro. Somente leitura.
begin;
create function public.ia_consultar_interface_v1(p_perfil uuid,p_oportunidade uuid,p_hash text,p_versao text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare u uuid:=auth.uid(); resultado public.ia_execucoes_v1; ativa public.ia_execucoes_v1; ultima public.ia_execucoes_v1;
begin
  if u is null or not exists(select 1 from public.perfis_empresa where id=p_perfil and usuario_id=u)
    or not exists(select 1 from public.oportunidades_editais where id=p_oportunidade) then
    raise exception 'Acesso negado' using errcode='42501';
  end if;
  -- Preferir resultado dos dados atuais, inclusive quando os dados voltaram a uma versão anterior.
  select * into resultado from public.ia_execucoes_v1
    where usuario_id=u and perfil_id=p_perfil and oportunidade_id=p_oportunidade and estado='completed'
    order by (dados_hash=p_hash and versao=p_versao) desc, criado_em desc limit 1;
  -- Bloqueio conservador entre versões: uma execução incerta não deve induzir nova chamada paga.
  select * into ativa from public.ia_execucoes_v1
    where usuario_id=u and perfil_id=p_perfil and oportunidade_id=p_oportunidade
      and (estado in ('processing','uncertain') or (estado='pending' and expira_em>clock_timestamp()))
    order by (estado='uncertain' or expira_em<=clock_timestamp()) desc, criado_em desc limit 1;
  select * into ultima from public.ia_execucoes_v1
    where usuario_id=u and perfil_id=p_perfil and oportunidade_id=p_oportunidade
    order by criado_em desc limit 1;
  return jsonb_build_object(
    'estado',case when ativa.id is null then case when (ultima.estado='failed' or (ultima.estado='pending' and ultima.expira_em<=clock_timestamp())) and (resultado.id is null or ultima.criado_em>resultado.criado_em) then 'failed' else null end
      when ativa.estado='uncertain' or ativa.expira_em<=clock_timestamp() then 'uncertain' else ativa.estado end,
    'resultado',case when resultado.id is null then null else jsonb_build_object(
      'id',resultado.id,'hash',resultado.dados_hash,'versao',resultado.versao,'snapshot',resultado.snapshot) end);
end; $$;
revoke all on function public.ia_consultar_interface_v1(uuid,uuid,text,text) from public,anon,service_role;
grant execute on function public.ia_consultar_interface_v1(uuid,uuid,text,text) to authenticated;
commit;
