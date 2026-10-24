\set ON_ERROR_STOP on
create function public.ia_test_check(ok boolean,msg text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL %',msg; end if;
raise notice 'PASS %',msg; end $$;
select public.ia_test_check((select dados=(select jsonb_agg(to_jsonb(r) order by execucao_id) from public.ia_resultados_v1 r) from public.ia_test_antes_adapter where tipo='resultados'),'instalação preserva resultados v1');
select public.ia_test_check((select dados=(select jsonb_agg(to_jsonb(r) order by id) from public.ia_execucoes_v1 r) from public.ia_test_antes_adapter where tipo='execucoes'),'instalação preserva reservas existentes');
select public.ia_test_check((select dados=(select jsonb_agg(to_jsonb(r) order by execucao_id) from public.ia_consumos_v1 r) from public.ia_test_antes_adapter where tipo='consumos'),'instalação preserva consumos');
select public.ia_test_check((select dados=(select jsonb_agg(to_jsonb(r) order by id) from public.ia_ciclos_v1 r) from public.ia_test_antes_adapter where tipo='ciclos'),'instalação preserva ciclos sem remapeamento');
select public.ia_test_check((select proowner=(select proowner from pg_proc where oid='public.billing_concessoes_entregar_v1(text,uuid,uuid)'::regprocedure)
 from pg_proc where oid='public.ia_receber_concessao_financeira_v1(jsonb)'::regprocedure),'hook pertence ao owner financeiro');
-- Helpers exclusivos do banco de testes. Sem SECURITY DEFINER.
create function public.ia_test_usuario() returns uuid language plpgsql as $$
declare u uuid:=gen_random_uuid(); begin
 insert into auth.users values(u,u||'@example.invalid');
 perform set_config('request.jwt.claim.sub',u::text,true);
 insert into public.perfis_empresa(id,usuario_id,nome_empresa,cnpj,segmento,porte,uf)
 values(u,u,'Teste',u::text,'TI','ME','SP');
 return u;
end $$;
insert into public.oportunidades_editais(id,codigo,titulo,orgao,modalidade,uf,cidade,objeto,data_publicacao,data_abertura,status)
values('20000000-0000-0000-0000-000000000001','ia_billing','Objeto','Órgão','Pregão','SP','SP','Objeto',current_date,current_date,'aberta');

create function public.ia_test_assinatura(u uuid,plano text,quota integer,ancora date) returns uuid language plpgsql as $$
declare c uuid; s uuid:=gen_random_uuid(); begin
 insert into public.billing_customers(usuario_id,gateway_customer_id,status_local)
 values(u,'cus_'||s,'ready') returning id into c;
 insert into public.billing_subscriptions(id,usuario_id,billing_customer_id,plan_code,franquia_ia,valor_centavos,
 status_local,gateway_subscription_id,gateway_checkout_id,criado_em)
 values(s,u,c,plano,quota,12345,'checkout_pending','sub_'||s,'chk_'||s,ancora::timestamp at time zone 'America/Sao_Paulo');
 return s;
end $$;
create function public.ia_test_pagamento(s uuid,pag text,d date,tipo text default 'PAYMENT_CONFIRMED') returns uuid language plpgsql as $$
declare g uuid; resultado text; begin
 resultado:=public.billing_executar_v1('sandbox','billing_processar_webhook_v1',
 jsonb_build_object('p',jsonb_build_object('id','evt_'||gen_random_uuid(),'event',tipo,
 'payment',jsonb_build_object('id',pag,'subscription','sub_'||s,'customer','cus_'||s,'value',123.45,'dueDate',d,'billingType','CREDIT_CARD'))));
 if resultado<>'"processed"' then raise exception 'Webhook falhou: %',resultado; end if;
 select c.id into g from public.billing_concessoes c join public.billing_payments p on p.id=c.pagamento_id
 where p.gateway_payment_id=pag;
 return g;
end $$;
create function public.ia_test_entregar() returns void language plpgsql as $$
declare lote jsonb; item jsonb; r text; begin
 lote:=public.billing_concessoes_reservar_entregas_v1('sandbox',100);
 for item in select value from jsonb_array_elements(lote) loop
  r:=public.billing_concessoes_entregar_v1('sandbox',(item->>'entrega_id')::uuid,(item->>'token')::uuid);
  if r<>'delivered' then raise exception 'Entrega falhou: %',r; end if;
 end loop;
end $$;
create function public.ia_test_reserva(u uuid,h text default 'a') returns jsonb language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub',u::text,true);
 return public.ia_reservar_v1(u,u,'20000000-0000-0000-0000-000000000001',repeat(h,64),'analise-v2-comercial-p1','{}');
end $$;
create function public.ia_test_resultado() returns jsonb language sql as $$
 select '{"resumo":"Software","compatibilidade_empresa":"TI corresponde ao objeto.","pontos_atencao":[],"informacoes_nao_verificadas":[],"proximo_passo":"Consultar portal."}'::jsonb;
$$;
create function public.ia_test_concluir(u uuid,e uuid) returns jsonb language plpgsql as $$
declare t uuid; begin
 t:=(public.ia_iniciar_v1(u,e)->>'token')::uuid;
 return public.ia_finalizar_v1(u,e,t,public.ia_test_resultado());
end $$;

do $primeira$
declare u uuid; s uuid; g uuid; e uuid; c uuid; r jsonb; antes jsonb; atual date:=(date_trunc('month',now() at time zone 'America/Sao_Paulo'))::date;
begin
 u:=public.ia_test_usuario(); s:=public.ia_test_assinatura(u,'PRO',1,atual);
 g:=public.ia_test_pagamento(s,'pag_'||s,atual);
 perform public.ia_test_entregar();
 select ciclo_id into c from public.ia_concessoes_financeiras_v1 where concessao_id=g;
 perform public.ia_test_check(c is not null,'primeiro pagamento -> outbox -> ciclo real');
 r:=public.ia_test_reserva(u); e:=(r->>'execucao_id')::uuid;
 perform public.ia_test_check(r->>'codigo'='RESERVADA','reserva autenticada autorizada');
 perform public.ia_test_check(public.ia_test_concluir(u,e)->>'codigo'='CONCLUIDA','finalização v2 real');
 perform public.ia_test_check(public.ia_test_reserva(u,'b')->>'codigo'='LIMITE_ATINGIDO','saldo esgotado');
 select to_jsonb(x) into antes from public.ia_resultados_v1 x where execucao_id=e;
 perform public.ia_receber_concessao_financeira_v1(public.billing_concessao_envelope_v1(g));
 perform public.ia_test_pagamento(s,'pag_'||s,atual);
 perform public.ia_test_entregar();
 perform public.ia_test_check((select count(*)=1 from public.ia_ciclos_v1 where usuario_id=u),'reentrega não duplica ciclo');
 perform public.ia_test_check(public.ia_test_reserva(u,'b')->>'codigo'='LIMITE_ATINGIDO','reentrega não reinicia consumo');
 perform public.ia_test_check((select to_jsonb(x)=antes from public.ia_resultados_v1 x where execucao_id=e),'histórico v2 imutável');
 perform public.ia_test_pagamento(s,'pag_proximo_'||s,(atual+interval '1 month')::date);
 perform public.ia_test_entregar();
 perform public.ia_test_check((select count(*)=2 from public.ia_ciclos_v1 where usuario_id=u),'renovação tem outra identidade');
 perform public.ia_test_check(public.ia_test_reserva(u,'c')->>'codigo'='LIMITE_ATINGIDO','pagamento futuro não soma saldo atual');
 -- Cancelamento de recorrência não apaga período pago.
 update public.billing_subscriptions set status_local='canceled' where id=s;
 perform public.ia_test_check((public.ia_ciclo_atual_v1(u)).id=c,'cancelamento mantém ciclo pago');
end $primeira$;

do $revogacao$
declare u uuid; s uuid; g uuid; e uuid; t uuid; anterior jsonb; d date:=date_trunc('month',now())::date;
begin
 u:=public.ia_test_usuario(); s:=public.ia_test_assinatura(u,'BUSINESS',3,d);
 g:=public.ia_test_pagamento(s,'rev_'||s,d);
 anterior:=public.billing_concessao_envelope_v1(g);
 perform public.ia_test_entregar();
 e:=(public.ia_test_reserva(u)->>'execucao_id')::uuid;
 t:=(public.ia_iniciar_v1(u,e)->>'token')::uuid;
 perform public.ia_test_pagamento(s,'rev_'||s,d,'PAYMENT_REFUNDED');
 -- Revogação financeira ainda NÃO entregue à IA.
 perform public.ia_test_check(public.ia_test_reserva(u,'b')->>'codigo'='CICLO_NAO_AUTORIZADO','guard bloqueia antes da entrega da revogação');
 perform public.ia_test_check(public.ia_finalizar_v1(u,e,t,public.ia_test_resultado())->>'codigo'='CICLO_ENCERRADO','revogação bloqueia conclusão em andamento');
 perform public.ia_test_check((select estado='uncertain' from public.ia_execucoes_v1 where id=e),'reserva incerta preservada');
 perform public.ia_test_check(not exists(select 1 from public.ia_consumos_v1 where execucao_id=e),'revogação não cobra outro ciclo');
 perform public.ia_test_entregar();
 perform public.ia_receber_concessao_financeira_v1(anterior);
 perform public.ia_test_check((select revisao=2 and estado='REVOKED' from public.ia_concessoes_financeiras_v1 where concessao_id=g),'revisão antiga não reativa');
 -- Estorno antes da primeira entrega.
 u:=public.ia_test_usuario(); s:=public.ia_test_assinatura(u,'PRO',2,d);
 g:=public.ia_test_pagamento(s,'rev_antes_'||s,d); anterior:=public.billing_concessao_envelope_v1(g);
 perform public.ia_test_pagamento(s,'rev_antes_'||s,d,'PAYMENT_CHARGEBACK_REQUESTED');
 perform public.ia_test_entregar();
 perform public.ia_receber_concessao_financeira_v1(anterior);
 perform public.ia_test_check((select estado='REVOKED' and revisao=2 and ciclo_id is null
 from public.ia_concessoes_financeiras_v1 where concessao_id=g),'revogação antes da autorização mantém tombstone sem saldo');
end $revogacao$;

do $termos$
declare u uuid; s uuid; g uuid; env jsonb; bad jsonb; d date:=date_trunc('month',now())::date;
begin
 u:=public.ia_test_usuario(); s:=public.ia_test_assinatura(u,'PRO',7,d);
 g:=public.ia_test_pagamento(s,'termos_'||s,d); perform public.ia_test_entregar();
 env:=public.billing_concessao_envelope_v1(g);
 foreach bad in array array[
   env||'{"contrato_versao":2}',env||'{"plano":"BUSINESS"}',env||'{"franquia":99}',
   env||jsonb_build_object('usuario_id',gen_random_uuid()),env||jsonb_build_object('assinatura_id',gen_random_uuid()),
   env||'{"origem":"ADMIN"}',env||'{"ambiente":"production"}',
   env||jsonb_build_object('inicio',now()),env||'{"revisao":99}',env||'{"estado":"REVIEW"}'
 ] loop
   begin
     perform public.ia_receber_concessao_financeira_v1(bad);
     raise exception 'Aceitou adulteração';
   exception when invalid_parameter_value or insufficient_privilege then null;
   end;
 end loop;
 perform public.ia_test_check((select franquia=7 and revisao=1 from public.ia_concessoes_financeiras_v1 where concessao_id=g),'identidade/ambiente/origem/plano/termos adulterados rejeitados');
 begin
   update public.billing_subscriptions set plan_code='BUSINESS',franquia_ia=40 where id=s;
   raise exception 'Aceitou troca de termos';
 exception when check_violation then null; end;
 perform public.ia_test_check((select plano='PRO' and limite=7 from public.ia_ciclos_v1 where usuario_id=u),'mudança de contrato não altera franquia');
end $termos$;

do $periodos$
declare u uuid; s uuid; g uuid; d date:=date_trunc('month',now())::date; r jsonb;
begin
 u:=public.ia_test_usuario(); s:=public.ia_test_assinatura(u,'PRO',null,d);
 g:=public.ia_test_pagamento(s,'review_'||s,d); perform public.ia_test_entregar();
 perform public.ia_test_check((select estado='REVIEW' and ciclo_id is null from public.ia_concessoes_financeiras_v1 where concessao_id=g),'REVIEW sem ciclo');
 perform public.ia_test_check(public.ia_test_reserva(u)->>'codigo'='CICLO_NAO_AUTORIZADO','REVIEW não autoriza');
 u:=public.ia_test_usuario(); s:=public.ia_test_assinatura(u,'PRO',2,(d+interval '1 month')::date);
 g:=public.ia_test_pagamento(s,'futuro_'||s,(d+interval '1 month')::date); perform public.ia_test_entregar();
 perform public.ia_test_check(public.ia_test_reserva(u)->>'codigo'='CICLO_NAO_AUTORIZADO','antecipação não autoriza ciclo futuro');
 u:=public.ia_test_usuario(); s:=public.ia_test_assinatura(u,'PRO',2,(d-interval '2 months')::date);
 g:=public.ia_test_pagamento(s,'velho_'||s,(d-interval '2 months')::date); perform public.ia_test_entregar();
 perform public.ia_receber_concessao_financeira_v1(public.billing_concessao_envelope_v1(g));
 perform public.ia_test_check((select fim_em<now() from public.ia_ciclos_v1 where usuario_id=u and plano='PRO'),'entrega tardia mantém fim original');
 r:=public.ia_test_reserva(u);
 perform public.ia_test_check(not exists(select 1 from public.ia_execucoes_v1 e join public.ia_ciclos_v1 c on c.id=e.ciclo_id where e.usuario_id=u and c.plano<>'FREE'),'período encerrado nunca financia reserva');
 -- ADMIN não precisa alterar a projeção de assinatura para conceder IA.
 u:=public.ia_test_usuario();
 g:=public.billing_conceder_administrativa_v1('sandbox',gen_random_uuid(),u,'BUSINESS',4,now()-interval '1 day',now()+interval '1 day','fixture autorizada');
 perform public.ia_test_entregar();
 perform public.ia_test_check(public.ia_test_reserva(u)->>'codigo'='RESERVADA','ADMIN autorizado independente de projeção de plano');
end $periodos$;

do $downgrade$
declare u uuid; g uuid; novo uuid; e uuid; pendente uuid; token uuid; c uuid;
begin
 u:=public.ia_test_usuario();
 g:=public.billing_conceder_administrativa_v1('sandbox',gen_random_uuid(),u,'BUSINESS',5,now()-interval '1 day',now()+interval '1 day','Contrato inicial');
 perform public.ia_test_entregar();
 e:=(public.ia_test_reserva(u)->>'execucao_id')::uuid;
 perform public.ia_test_concluir(u,e);
 pendente:=(public.ia_test_reserva(u,'b')->>'execucao_id')::uuid;
 token:=(public.ia_iniciar_v1(u,pendente)->>'token')::uuid;
 perform public.billing_revogar_administrativa_v1('sandbox',g,'Encerrar contrato anterior');
 perform public.ia_test_entregar();
 novo:=public.billing_conceder_administrativa_v1('sandbox',gen_random_uuid(),u,'PRO',2,now()-interval '1 hour',now()+interval '1 day','Novo contrato separado');
 perform public.ia_test_entregar();
 select ciclo_id into c from public.ia_concessoes_financeiras_v1 where concessao_id=novo;
 perform public.ia_test_check((select limite=2 and plano='PRO' from public.ia_ciclos_v1 where id=c),'downgrade explícito usa franquia do novo contrato');
 perform public.ia_test_check((select count(*)=1 from public.ia_consumos_v1 where usuario_id=u),'downgrade preserva consumo anterior');
 perform public.ia_test_check(public.ia_finalizar_v1(u,pendente,token,public.ia_test_resultado())->>'codigo'='CICLO_ENCERRADO','execução antiga não migra para novo contrato');
 perform public.ia_test_check((select count(*)=0 from public.ia_consumos_v1 where ciclo_id=c),'downgrade não transfere consumo');
end $downgrade$;

do $seguranca$
declare u uuid; outro uuid; g uuid; e uuid;
begin
 u:=public.ia_test_usuario(); outro:=public.ia_test_usuario();
 g:=public.billing_conceder_administrativa_v1('sandbox',gen_random_uuid(),u,'PRO',2,now()-interval '1 day',now()+interval '1 day','Permissões');
 perform public.ia_test_entregar();
 perform set_config('request.jwt.claim.sub',u::text,true);
 execute 'set local role authenticated';
 begin perform public.ia_reservar_v1(outro,outro,'20000000-0000-0000-0000-000000000001',repeat('a',64),'v1','{}');
   raise exception 'Aceitou outra identidade';
 exception when insufficient_privilege then null; end;
 begin perform public.ia_reservar_v1(u,outro,'20000000-0000-0000-0000-000000000001',repeat('a',64),'v1','{}');
   raise exception 'Aceitou outro perfil';
 exception when insufficient_privilege then null; end;
 begin perform public.ia_receber_concessao_financeira_v1('{}'); raise exception 'Hook publico';
 exception when insufficient_privilege then null; end;
 begin perform public.billing_concessao_autorizada_v1('sandbox',u,g,1); raise exception 'Guard publico';
 exception when insufficient_privilege then null; end;
 begin perform 1 from public.billing_concessoes; raise exception 'Financeiro publico';
 exception when insufficient_privilege then null; end;
 begin update public.ia_concessoes_financeiras_v1 set revisao=99; raise exception 'Revisao publica';
 exception when insufficient_privilege then null; end;
 begin delete from public.ia_consumos_v1; raise exception 'Consumo publico';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.ia_reservar_v1(u,u,'20000000-0000-0000-0000-000000000001',repeat('a',64),'v1','{}');
   raise exception 'Aceitou sem JWT';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub',u::text,true);
 e:=(public.ia_test_reserva(u)->>'execucao_id')::uuid;
 perform public.ia_test_check(e is not null,'authenticated reserva a própria franquia');
 begin perform public.ia_iniciar_v1(u,e); raise exception 'Expos token';
 exception when insufficient_privilege then null; end;
 execute 'reset role';
 execute 'set local role service_role';
 begin perform public.ia_receber_concessao_financeira_v1('{}'); raise exception 'Servico cria concessao';
 exception when insufficient_privilege then null; end;
 begin perform public.ia_autorizar_ciclo_v1(u,'x','y',now(),now()+interval '1 day'); raise exception 'Concessao legada aberta';
 exception when insufficient_privilege then null; end;
 begin perform public.ia_revogar_ciclo_v1(u,gen_random_uuid()); raise exception 'Revogacao legada aberta';
 exception when insufficient_privilege then null; end;
 begin perform public.ia_test_reserva(u,'b'); raise exception 'Reserva usa service_role';
 exception when insufficient_privilege then null; end;
 perform public.ia_iniciar_v1(u,e);
 execute 'reset role';
 perform public.ia_test_check(true,'RLS e privilégios: sem hook, guard, financeiro, revisão, consumo ou token no cliente');
end $seguranca$;

do $free$
declare u uuid; e uuid;
begin
 u:=public.ia_test_usuario();
 e:=(public.ia_test_reserva(u)->>'execucao_id')::uuid;
 perform public.ia_test_check(public.ia_test_concluir(u,e)->>'codigo'='CONCLUIDA','Free mantém demonstração vitalícia');
 perform public.ia_test_check(public.ia_test_reserva(u,'b')->>'codigo'='LIMITE_ATINGIDO','Free não reinicia demo');
end $free$;

-- Falha após escrita parcial do hook: outbox e consumidor devem reverter juntos.
create function public.ia_test_falhar_projecao() returns trigger language plpgsql as $$
begin raise exception 'Falha artificial após inserir ciclo'; end $$;
create trigger ia_test_falha before insert on public.ia_concessoes_financeiras_v1
for each row execute function public.ia_test_falhar_projecao();
do $atomicidade$
declare u uuid; g uuid; item jsonb; r text;
begin
 u:=public.ia_test_usuario();
 g:=public.billing_conceder_administrativa_v1('sandbox',gen_random_uuid(),u,'PRO',3,now()-interval '1 day',now()+interval '1 day','Recuperação');
 item:=public.billing_concessoes_reservar_entregas_v1('sandbox',100)->0;
 r:=public.billing_concessoes_entregar_v1('sandbox',(item->>'entrega_id')::uuid,(item->>'token')::uuid);
 perform public.ia_test_check(r='retry','falha intermediária mantém entrega pendente');
 perform public.ia_test_check(not exists(select 1 from public.ia_ciclos_v1 where usuario_id=u),'rollback remove concessão parcial');
 perform public.ia_test_check((select status='pending' and ultimo_erro like 'SQLSTATE %' from public.billing_concessoes_entregas where concessao_id=g),'erro seguro no outbox');
end $atomicidade$;
drop trigger ia_test_falha on public.ia_concessoes_financeiras_v1;
update public.billing_concessoes_entregas set disponivel_em=clock_timestamp() where status='pending';
select public.ia_test_entregar();
select public.ia_test_check(not exists(select 1 from public.billing_concessoes_entregas where status in ('pending','processing')),'worker recupera sem webhook novo');

-- Conciliação do saldo anterior é deliberadamente separada e não automática.
begin;
do $legado$
declare u uuid:='00000000-0000-0000-0000-000000000091'; g uuid; item jsonb;
begin
 perform public.ia_test_check(public.ia_test_reserva(u,'c')->>'codigo'='CICLO_NAO_AUTORIZADO','saldo pago antigo sem vínculo não autoriza');
 g:=public.billing_conceder_administrativa_v1('sandbox',gen_random_uuid(),u,'PRO',4,now()-interval '1 hour',now()+interval '1 hour','Conciliação ainda pendente');
 item:=public.billing_concessoes_reservar_entregas_v1('sandbox',100)->0;
 perform public.ia_test_check(public.billing_concessoes_entregar_v1('sandbox',(item->>'entrega_id')::uuid,(item->>'token')::uuid)='retry','sobreposição com saldo legado exige conciliação');
 perform public.ia_test_check((select count(*)=1 from public.ia_ciclos_v1 where usuario_id=u),'conciliação não duplica saldo');
end $legado$;
rollback;
