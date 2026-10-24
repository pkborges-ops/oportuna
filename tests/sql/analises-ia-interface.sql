\set ON_ERROR_STOP on
begin;
-- Fixtures alteradas somente dentro desta transação, desfeitas ao fim.
create function public.ia_ui_assert(ok boolean,msg text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL %',msg; end if; raise notice 'PASS interface %',msg; end $$;
do $$ declare e public.ia_execucoes_v1; r jsonb; n bigint;
begin
 select * into e from public.ia_execucoes_v1 where estado='completed' limit 1;
 if e.id is null then raise exception 'Fixture concluída ausente'; end if;
 perform public.ia_ui_assert(has_function_privilege('authenticated','public.ia_consultar_interface_v1(uuid,uuid,text,text)','EXECUTE'),'authenticated pode consultar');
 perform public.ia_ui_assert(not has_function_privilege('anon','public.ia_consultar_interface_v1(uuid,uuid,text,text)','EXECUTE'),'anon bloqueado');
 perform public.ia_ui_assert(not has_function_privilege('service_role','public.ia_consultar_interface_v1(uuid,uuid,text,text)','EXECUTE'),'service_role sem consulta direta');
 perform public.ia_ui_assert(not has_table_privilege('authenticated','public.ia_execucoes_v1','SELECT'),'tabela privada preservada');
 perform set_config('request.jwt.claim.sub',e.usuario_id::text,true);
 select count(*) into n from public.ia_consumos_v1;
 set local role authenticated;
 r:=public.ia_consultar_interface_v1(e.perfil_id,e.oportunidade_id,e.dados_hash,e.versao);
 reset role;
 perform public.ia_ui_assert(r#>>'{resultado,id}'=e.id::text,'reconsulta identifica resultado atual');
 perform public.ia_ui_assert(not (r->'resultado' ?| array['token','metadados','erro_codigo','usuario_id']),'DTO não expõe segredos');
 perform public.ia_ui_assert((select count(*)=n from public.ia_consumos_v1),'consulta não consome');
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin
   perform public.ia_consultar_interface_v1(e.perfil_id,e.oportunidade_id,e.dados_hash,e.versao);
   raise exception 'Perfil alheio autorizado';
 exception when insufficient_privilege then raise notice 'PASS interface isolamento de usuário'; end;
 perform set_config('request.jwt.claim.sub','',true);
 begin
   perform public.ia_consultar_interface_v1(e.perfil_id,e.oportunidade_id,e.dados_hash,e.versao);
   raise exception 'Sem JWT autorizado';
 exception when insufficient_privilege then raise notice 'PASS interface JWT obrigatório'; end;
 perform set_config('request.jwt.claim.sub',e.usuario_id::text,true);
 -- Isola o par da fixture para testar precedência e expiração sem executar recuperação.
 delete from public.ia_consumos_v1 where execucao_id in (select id from public.ia_execucoes_v1 where usuario_id=e.usuario_id and perfil_id=e.perfil_id and oportunidade_id=e.oportunidade_id and id<>e.id);
 delete from public.ia_resultados_v1 where execucao_id in (select id from public.ia_execucoes_v1 where usuario_id=e.usuario_id and perfil_id=e.perfil_id and oportunidade_id=e.oportunidade_id and id<>e.id);
 delete from public.ia_execucoes_v1 where usuario_id=e.usuario_id and perfil_id=e.perfil_id and oportunidade_id=e.oportunidade_id and id<>e.id;
 update public.ia_execucoes_v1 set estado='pending',expira_em=now()+interval '1 minute' where id=e.id;
 r:=public.ia_consultar_interface_v1(e.perfil_id,e.oportunidade_id,repeat('f',64),e.versao);
 perform public.ia_ui_assert(r->>'estado'='pending','pending bloqueia mesmo com hash diferente');
 update public.ia_execucoes_v1 set estado='processing',expira_em=now()+interval '1 minute' where id=e.id;
 r:=public.ia_consultar_interface_v1(e.perfil_id,e.oportunidade_id,e.dados_hash,e.versao);
 perform public.ia_ui_assert(r->>'estado'='processing','processing recuperado na recarga');
 update public.ia_execucoes_v1 set expira_em=now()-interval '1 minute' where id=e.id;
 r:=public.ia_consultar_interface_v1(e.perfil_id,e.oportunidade_id,e.dados_hash,e.versao);
 perform public.ia_ui_assert(r->>'estado'='uncertain','processing expirado nunca libera outra chamada');
 perform public.ia_ui_assert((select estado='processing' from public.ia_execucoes_v1 where id=e.id),'leitura não modifica estado');
 update public.ia_execucoes_v1 set estado='pending' where id=e.id;
 r:=public.ia_consultar_interface_v1(e.perfil_id,e.oportunidade_id,e.dados_hash,e.versao);
 perform public.ia_ui_assert(r->>'estado'='failed','pending expirado pode ser reavaliado pela reserva');
 update public.ia_execucoes_v1 set estado='failed' where id=e.id;
 r:=public.ia_consultar_interface_v1(e.perfil_id,e.oportunidade_id,e.dados_hash,e.versao);
 perform public.ia_ui_assert(r->>'estado'='failed','falha recuperada na recarga');
end $$;
rollback;
