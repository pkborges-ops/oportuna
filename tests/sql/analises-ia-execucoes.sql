\set ON_ERROR_STOP on
-- Executar exclusivamente no banco descartável criado por run-ia-local.py.
create function public.ia_test_assert(ok boolean,msg text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'FAIL: %',msg; end if; end $$;
create function public.ia_test_reservar(u uuid,p uuid,o uuid,h text) returns uuid language sql as $$
 select (public.ia_reservar_v1(u,p,o,repeat(h,64),'v1','{}')->>'execucao_id')::uuid
$$;
create function public.ia_test_concluir(u uuid,e uuid) returns jsonb language plpgsql as $$
declare t uuid; begin
 t:=(public.ia_iniciar_v1(u,e)->>'token')::uuid;
 return public.ia_finalizar_v1(u,e,t,'{"score":70,"justificativa":"Compatível","resumo":"Resumo","pontos_atencao":["Conferir edital"]}');
end $$;

-- Fixtures: legado, Free, Pro, Business, outra conta e usuários de concorrência.
insert into auth.users select ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid from generate_series(2,9) n;
insert into public.perfis_empresa(id,usuario_id,nome_empresa,cnpj,segmento,porte,uf)
select ('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'Empresa',n::text,'TI','ME','SP' from generate_series(2,9) n;
insert into public.oportunidades_editais(id,codigo,titulo,orgao,modalidade,uf,cidade,objeto,data_publicacao,data_abertura,status)
select ('20000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,n::text,'Objeto','Órgão','Pregão','SP','SP','Objeto',current_date,current_date,'aberta' from generate_series(2,5) n;
insert into public.assinaturas_usuario(usuario_id,plano,franquia_ia,fim_em,billing_subscription_id)
values ('00000000-0000-0000-0000-000000000003','PRO',2,now()+interval '30 days','30000000-0000-0000-0000-000000000003'),
 ('00000000-0000-0000-0000-000000000004','BUSINESS',3,now()+interval '30 days','30000000-0000-0000-0000-000000000004');

do $$ declare
 u uuid:='00000000-0000-0000-0000-000000000002'; p uuid:='10000000-0000-0000-0000-000000000002';
 o uuid:='20000000-0000-0000-0000-000000000001'; e uuid; t uuid; c uuid; r jsonb;
begin
 perform public.ia_test_assert((public.ia_saldo_interno_v1('00000000-0000-0000-0000-000000000001')->>'disponiveis')::int=0,'legado não recria demo');
 perform public.ia_test_assert((select count(*)=1 from public.analises_oportunidades),'histórico preservado');
 e:=public.ia_test_reservar(u,p,o,'a');
 perform public.ia_test_assert(e is not null,'Free reserva');
 perform public.ia_test_assert(public.ia_reservar_v1(u,p,o,repeat('a',64),'v1','{}')->>'codigo'='EM_ANDAMENTO','dois cliques');
 perform public.ia_test_assert(public.ia_reservar_v1(u,p,o,repeat('b',64),'v1','{}')->>'codigo'='LIMITE_ATINGIDO','última unidade reservada');
 t:=(public.ia_iniciar_v1(u,e)->>'token')::uuid;
 perform public.ia_test_assert(public.ia_iniciar_v1(u,e)->>'codigo'='NAO_INICIADA','início não repete provedor');
 begin
  perform public.ia_finalizar_v1(u,e,t,'{"score":70,"justificativa":"","resumo":"","pontos_atencao":[]}');
  raise exception 'Resultado vazio aceito';
 exception when check_violation or not_null_violation then null; end;
 perform public.ia_test_assert((select count(*)=0 from public.ia_consumos_v1 where execucao_id=e),'resultado inválido não consome');
 r:=public.ia_finalizar_v1(u,e,t,'{"score":70,"justificativa":"J","resumo":"R","pontos_atencao":["P"]}');
 perform public.ia_test_assert(r->>'codigo'='CONCLUIDA','conclusão Free');
 perform public.ia_finalizar_v1(u,e,t,'{}');
 perform public.ia_test_assert((select count(*)=1 from public.ia_consumos_v1 where execucao_id=e),'finalização idempotente');
 perform public.ia_test_assert(public.ia_reservar_v1(u,p,o,repeat('a',64),'v1','{}')->>'codigo'='EXISTENTE','reconsulta gratuita');
 perform public.ia_test_assert(public.ia_reservar_v1(u,p,o,repeat('b',64),'v1','{}')->>'codigo'='LIMITE_ATINGIDO','demo vitalícia');
 perform public.ia_test_assert((public.ia_saldo_interno_v1(u)->>'reservadas')::int=0,'finalização encerra reserva atomicamente');
 begin
  perform public.ia_finalizar_v1('00000000-0000-0000-0000-000000000005',e,t,'{}');
  raise exception 'Acesso cruzado aceito';
 exception when insufficient_privilege then null; end;
 begin
  perform public.ia_finalizar_v1(u,e,gen_random_uuid(),'{}');
  raise exception 'Token errado aceito';
 exception when insufficient_privilege then null; end;
 begin
  perform public.ia_reservar_v1(u,'10000000-0000-0000-0000-000000000005',o,repeat('c',64),'v1','{}');
  raise exception 'Perfil alheio aceito';
 exception when insufficient_privilege then null; end;
 -- PRO: assinatura ativa sem contrato de ciclo deve falhar fechada.
 u:='00000000-0000-0000-0000-000000000003'; p:='10000000-0000-0000-0000-000000000003';
 perform public.ia_test_assert(public.ia_saldo_interno_v1(u)->>'codigo'='CICLO_NAO_AUTORIZADO','sem datas não inventa ciclo');
 c:=public.ia_autorizar_ciclo_v1(u,'30000000-0000-0000-0000-000000000003','periodo-1',now()-interval '1 day',now()+interval '1 day');
 perform public.ia_test_assert(c=public.ia_autorizar_ciclo_v1(u,'30000000-0000-0000-0000-000000000003','periodo-1',now()-interval '1 day',now()+interval '1 day'),'evento duplicado mesmo ciclo');
 e:=public.ia_test_reservar(u,p,o,'a'); perform public.ia_test_concluir(u,e);
 e:=public.ia_test_reservar(u,p,o,'b'); perform public.ia_test_concluir(u,e);
 perform public.ia_test_assert((select count(*)=2 from public.ia_resultados_v1 where usuario_id=u),'atualização preserva versões');
 perform public.ia_test_assert((public.ia_saldo_interno_v1(u)->>'consumidas')::int=2,'atualização consome nova unidade');
 perform public.ia_test_assert(public.ia_reservar_v1(u,p,o,repeat('c',64),'v1','{}')->>'codigo'='LIMITE_ATINGIDO','Pro limite contratado');
 -- Simula passagem do tempo apenas nas fixtures, sem inventar período no produto.
 update public.ia_ciclos_v1 set inicio_em=now()-interval '31 days',fim_em=now()-interval '1 day' where id=c;
 perform public.ia_test_assert(public.ia_saldo_interno_v1(u)->>'codigo'='CICLO_NAO_AUTORIZADO','fim do ciclo não renova sozinho');
 update public.assinaturas_usuario set status='expired' where usuario_id=u;
 begin
  perform public.ia_autorizar_ciclo_v1(u,'30000000-0000-0000-0000-000000000003','periodo-2',now()-interval '1 day',now()+interval '29 days');
  raise exception 'Renovação sem confirmação aceita';
 exception when raise_exception then if sqlerrm<>'Assinatura sem concessão compatível' then raise; end if; end;
 update public.assinaturas_usuario set status='active' where usuario_id=u;
 c:=public.ia_autorizar_ciclo_v1(u,'30000000-0000-0000-0000-000000000003','periodo-2',now()-interval '1 day',now()+interval '29 days');
 perform public.ia_test_assert((public.ia_saldo_interno_v1(u)->>'disponiveis')::int=2,'renovação não carrega consumos antigos');
 perform public.ia_autorizar_ciclo_v1(u,'30000000-0000-0000-0000-000000000003','periodo-2',now()-interval '1 day',now()+interval '29 days');
 perform public.ia_test_assert((select count(*)=2 from public.ia_ciclos_v1 where usuario_id=u and plano='PRO'),'webhook duplicado não duplica ciclo');
 update public.assinaturas_usuario set status='canceled' where usuario_id=u;
 perform public.ia_test_assert(public.ia_saldo_interno_v1(u)->>'plano'='FREE','downgrade');
 perform public.ia_test_assert((select count(*)=2 from public.ia_resultados_v1 where usuario_id=u),'downgrade preserva histórico');
 -- BUSINESS é resolvido sem copiar o catálogo financeiro.
 u:='00000000-0000-0000-0000-000000000004'; p:='10000000-0000-0000-0000-000000000004';
 c:=public.ia_autorizar_ciclo_v1(u,'30000000-0000-0000-0000-000000000004','periodo-1',now()-interval '1 day',now()+interval '1 day');
 perform public.ia_test_assert((public.ia_saldo_interno_v1(u)->>'limite')::int=3,'Business usa limite da assinatura');
 e:=public.ia_test_reservar(u,p,o,'a');
 update public.ia_execucoes_v1 set expira_em=now()-interval '1 second' where id=e;
 perform public.ia_recuperar_v1(u);
 perform public.ia_test_assert(public.ia_iniciar_v1(u,e)->>'codigo'='NAO_INICIADA','reserva expirada não inicia');
 perform public.ia_test_assert((public.ia_saldo_interno_v1(u)->>'disponiveis')::int=3,'pending expirado libera saldo');
 e:=public.ia_test_reservar(u,p,o,'a'); t:=(public.ia_iniciar_v1(u,e)->>'token')::uuid;
 update public.ia_execucoes_v1 set expira_em=now()-interval '1 second' where id=e;
 r:=public.ia_finalizar_v1(u,e,t,'{"score":70,"justificativa":"J","resumo":"R","pontos_atencao":["P"]}');
 perform public.ia_test_assert(r->>'estado'='uncertain','resposta atrasada não finaliza automaticamente');
 perform public.ia_test_assert((public.ia_saldo_interno_v1(u)->>'reservadas')::int=1,'incerteza mantém reserva');
 perform public.ia_test_assert(public.ia_reservar_v1(u,p,o,repeat('a',64),'v1','{}')->>'codigo'='INCERTA','incerteza não dispara chamada nova');
 perform public.ia_test_assert(public.ia_falhar_v1(u,e,t,false,'sem resultado')='uncertain','incerteza exige reconciliação');
 perform public.ia_test_assert(public.ia_falhar_v1(u,e,t,false,'confirmado sem resultado',true)='failed','reconciliação explícita libera');
 e:=public.ia_test_reservar(u,p,o,'a'); t:=(public.ia_iniciar_v1(u,e)->>'token')::uuid;
 perform public.ia_falhar_v1(u,e,t,true,'falha de persistência');
 r:=public.ia_finalizar_v1(u,e,t,'{"score":70,"justificativa":"J","resumo":"R","pontos_atencao":["P"]}','{}',true);
 perform public.ia_test_assert(r->>'codigo'='CONCLUIDA','reconciliação persiste resposta conhecida');
 perform public.ia_test_assert(public.ia_falhar_v1(u,e,t,true,'resposta perdida')='completed','falha após commit não reverte conclusão');
 -- Execução antiga não debita o novo ciclo.
 e:=public.ia_test_reservar(u,p,o,'b'); t:=(public.ia_iniciar_v1(u,e)->>'token')::uuid;
 update public.ia_ciclos_v1 set inicio_em=now()-interval '31 days',fim_em=now()-interval '1 day' where id=c;
 c:=public.ia_autorizar_ciclo_v1(u,'30000000-0000-0000-0000-000000000004','periodo-2',now()-interval '1 day',now()+interval '29 days');
 perform public.ia_test_assert(public.ia_finalizar_v1(u,e,t,'{}')->>'codigo'='CICLO_ENCERRADO','virada de ciclo bloqueia conclusão antiga');
 perform public.ia_test_assert((public.ia_saldo_interno_v1(u)->>'disponiveis')::int=3,'execução velha não debita novo ciclo');
 perform public.ia_test_assert(public.ia_inspecionar_v1(u,e)->>'estado'='uncertain','backend consegue reconciliar após perder o token local');
 perform public.ia_test_assert(public.ia_inspecionar_v1('00000000-0000-0000-0000-000000000005',e) is null,'inspeção cruzada não retorna dados');
 e:=public.ia_test_reservar(u,p,o,'c'); perform public.ia_test_concluir(u,e);
 e:=public.ia_test_reservar(u,p,o,'d'); perform public.ia_test_concluir(u,e);
 e:=public.ia_test_reservar(u,p,o,'e'); perform public.ia_test_concluir(u,e);
 perform public.ia_test_assert(public.ia_reservar_v1(u,p,o,repeat('f',64),'v1','{}')->>'codigo'='LIMITE_ATINGIDO','Business respeita teto');
 begin
  perform public.ia_autorizar_ciclo_v1(u,'30000000-0000-0000-0000-000000000004','duplicado-com-outro-id',now()-interval '1 day',now()+interval '29 days');
  raise exception 'Sobreposição aceita';
 exception when raise_exception then if sqlerrm<>'Períodos sobrepostos' then raise; end if; end;
 begin
  perform public.ia_autorizar_ciclo_v1(u,'30000000-0000-0000-0000-000000000004','nao-pago',now()+interval '29 days',now()+interval '59 days');
  raise exception 'Período não pago aceito';
 exception when raise_exception then if sqlerrm<>'Assinatura sem concessão compatível' then raise; end if; end;
 perform public.ia_revogar_ciclo_v1(u,c);
 perform public.ia_autorizar_ciclo_v1(u,'30000000-0000-0000-0000-000000000004','periodo-2',now()-interval '1 day',now()+interval '29 days');
 perform public.ia_test_assert(public.ia_saldo_interno_v1(u)->>'codigo'='CICLO_NAO_AUTORIZADO','evento duplicado não reativa ciclo revogado');
 raise notice 'PASS: Free, Pro, Business, ciclos, histórico, falhas e idempotência';
end $$;

-- Testes de privilégios reais, com roles de cliente.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ begin
 if (select count(*) from public.ia_resultados_v1)<>1 then raise exception 'RLS vazou resultados'; end if;
 if public.ia_consultar_franquia_v1()->>'plano'<>'FREE' then raise exception 'Saldo incorreto'; end if;
 begin update public.analises_oportunidades set score=100; raise exception 'Update legado permitido'; exception when insufficient_privilege then null; end;
 begin insert into public.analises_oportunidades(usuario_id) values(auth.uid()); raise exception 'Insert legado permitido'; exception when insufficient_privilege then null; end;
 begin update public.ia_resultados_v1 set score=100; raise exception 'Update novo permitido'; exception when insufficient_privilege then null; end;
 begin insert into public.ia_resultados_v1(usuario_id) values(auth.uid()); raise exception 'Insert novo permitido'; exception when insufficient_privilege then null; end;
 begin perform public.ia_reservar_v1(auth.uid(),null,null,repeat('a',64),'v1','{}'); raise exception 'Reserva privilegiada exposta'; exception when insufficient_privilege then null; end;
 begin perform public.ia_autorizar_ciclo_v1(auth.uid(),'x','x',now(),now()+interval '1 day'); raise exception 'Ciclo manipulável'; exception when insufficient_privilege then null; end;
 begin perform public.reservar_analise_ia_v1(null,null); raise exception 'RPC legada aberta'; exception when insufficient_privilege then null; end;
 begin update public.assinaturas_usuario set franquia_ia=99999; raise exception 'Plano manipulável'; exception when insufficient_privilege then null; end;
 begin delete from public.ia_consumos_v1; raise exception 'Consumo manipulável'; exception when insufficient_privilege then null; end;
 begin select token from public.ia_execucoes_v1; raise exception 'Token exposto'; exception when insufficient_privilege then null; end;
 raise notice 'PASS: privilégios e RLS reais';
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);
do $$ begin if exists(select 1 from public.ia_resultados_v1) then raise exception 'Leitura cruzada'; end if; end $$;
reset role;
select public.ia_test_assert(not has_function_privilege('anon','public.ia_consultar_franquia_v1()','EXECUTE'),'anon sem saldo');
select public.ia_test_assert(has_function_privilege('service_role','public.ia_reservar_v1(uuid,uuid,uuid,text,text,jsonb)','EXECUTE'),'backend pode reservar');
-- Nenhum helper privilegiado de IA pode ficar público por engano.
select public.ia_test_assert(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like 'ia_%' and p.prosecdef and has_function_privilege('anon',p.oid,'EXECUTE')),'helpers fechados');
