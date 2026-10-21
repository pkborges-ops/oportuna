-- Suite financeira SINTETICA, sem Asaas, rede ou dados reais. Sempre ROLLBACK.
begin;
create temporary table fin_checks(nome text);
create function pg_temp.check_fin(ok boolean,nome text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'Contrato financeiro: %',nome; end if;
  insert into fin_checks values(nome);
end; $$;
create function pg_temp.fin_fixture(plano text,quota integer,ancora date) returns uuid
language plpgsql as $$
declare u uuid:=gen_random_uuid(); c uuid; s uuid:=gen_random_uuid();
begin
  insert into auth.users(id,email) values(u,u||'@example.invalid');
  insert into public.billing_customers(usuario_id,gateway_customer_id,status_local)
    values(u,'cus_'||s,'ready') returning id into c;
  insert into public.billing_subscriptions(id,usuario_id,billing_customer_id,plan_code,franquia_ia,
    valor_centavos,status_local,gateway_subscription_id,gateway_checkout_id,criado_em)
    values(s,u,c,plano,quota,12345,'checkout_pending','sub_'||s,'chk_'||s,
      ancora::timestamp at time zone 'America/Sao_Paulo');
  return s;
end; $$;
create function pg_temp.fin_event(s uuid,pagamento text,venc date,tipo text default 'PAYMENT_CONFIRMED',eid text default null)
returns jsonb language sql as $$
  select jsonb_build_object('id',coalesce(eid,'evt_'||gen_random_uuid()),'event',tipo,
    'payment',jsonb_build_object('id',pagamento,'subscription','sub_'||s,'customer','cus_'||s,
      'value',123.45,'dueDate',venc,'billingType','CREDIT_CARD'));
$$;
create function pg_temp.fin_pay(s uuid,pagamento text,venc date,tipo text default 'PAYMENT_CONFIRMED')
returns uuid language plpgsql as $$
declare resultado text; g uuid;
begin
  resultado:=public.billing_processar_webhook_v1(pg_temp.fin_event(s,pagamento,venc,tipo));
  perform pg_temp.check_fin(resultado='processed','webhook '||tipo||' processado');
  select c.id into g from public.billing_concessoes c join public.billing_payments p on p.id=c.pagamento_id
    where p.gateway_payment_id=pagamento;
  return g;
end; $$;

do $primeira_renovacao$
declare s uuid; g uuid; g2 uuid; ev jsonb; r public.billing_concessoes%rowtype; fim1 timestamptz;
begin
  s:=pg_temp.fin_fixture('PRO',17,'2024-01-31');
  ev:=pg_temp.fin_event(s,'pay_fin_1','2024-01-31');
  perform pg_temp.check_fin(public.billing_processar_webhook_v1(ev)='processed','primeira cobranca');
  select * into strict r from public.billing_concessoes where assinatura_id=s;
  g:=r.id; fim1:=r.fim;
  perform pg_temp.check_fin(r.estado='AUTHORIZED' and r.franquia=17 and r.plano='PRO'
    and r.inicio='2024-01-31 00:00 America/Sao_Paulo'::timestamptz
    and r.fim='2024-02-29 00:00 America/Sao_Paulo'::timestamptz,'termos e periodo imutaveis');
  perform pg_temp.check_fin((select count(*)=1 from public.billing_concessoes_entregas where concessao_id=g
    and status='pending' and revisao=1),'entrega criada atomicamente');
  perform pg_temp.check_fin(public.billing_processar_webhook_v1(ev)='duplicate','mesmo evento duplicado');
  perform pg_temp.fin_pay(s,'pay_fin_1','2024-01-31');
  perform pg_temp.check_fin((select count(*)=1 from public.billing_concessoes where assinatura_id=s),
    'eventos distintos mesmo pagamento nao duplicam concessao');
  g2:=pg_temp.fin_pay(s,'pay_fin_2','2024-02-29');
  perform pg_temp.check_fin((select inicio=fim1 and fim='2024-03-31 00:00 America/Sao_Paulo'::timestamptz
    and franquia=17 and id<>g from public.billing_concessoes where id=g2),'renovacao sem deriva do dia 31');
  perform pg_temp.fin_pay(s,'pay_fin_1','2024-01-31','PAYMENT_REFUNDED');
  perform pg_temp.check_fin((select estado='REVOKED' and revisao=2 from public.billing_concessoes where id=g),
    'estorno revoga ciclo anterior mesmo com pagamento posterior');
  perform pg_temp.check_fin((select estado='AUTHORIZED' and revisao=1 from public.billing_concessoes where id=g2),
    'periodo posterior pago preservado');
  perform pg_temp.fin_pay(s,'pay_fin_1','2024-01-31','PAYMENT_CHARGEBACK_REQUESTED');
  perform pg_temp.fin_pay(s,'pay_fin_1','2024-01-31');
  perform pg_temp.check_fin((select estado='REVOKED' and revisao=2 and fim=fim1 from public.billing_concessoes where id=g),
    'revogacao terminal inclusive confirmacao atrasada');
  perform pg_temp.fin_pay(s,'pay_fin_2','2024-02-29','PAYMENT_CHARGEBACK_REQUESTED');
  perform pg_temp.check_fin((select estado='REVOKED' and revisao=2 from public.billing_concessoes where id=g2),
    'chargeback revoga concessao correspondente');
end $primeira_renovacao$;

do $ordem_e_calendario$
declare s uuid; g uuid; g2 uuid; alinhado boolean; d integer; periodo record; ref date;
begin
  s:=pg_temp.fin_fixture('BUSINESS',53,'2024-01-30');
  g2:=pg_temp.fin_pay(s,'pay_fin_fev','2024-02-29');
  g:=pg_temp.fin_pay(s,'pay_fin_jan','2024-01-30');
  perform pg_temp.check_fin((select count(*)=2 and bool_and(estado='AUTHORIZED' and franquia=53 and plano='BUSINESS')
    from public.billing_concessoes where assinatura_id=s),'pagamentos fora de ordem e Business');
  perform pg_temp.check_fin((select fim=(select inicio from public.billing_concessoes where id=g2)
    from public.billing_concessoes where id=g),'periodos adjacentes nao sobrepoem');
  for d in 29..31 loop
    select * into periodo from public.billing_periodo_financeiro_v1(make_date(2025,1,d),'2025-02-28');
    perform pg_temp.check_fin(periodo.alinhado and (periodo.fim at time zone 'America/Sao_Paulo')::date=make_date(2025,3,d),
      'fevereiro nao bissexto aniversario '||d);
  end loop;
  ref:=(date_trunc('month',now() at time zone 'America/Sao_Paulo')+interval '1 month')::date;
  s:=pg_temp.fin_fixture('PRO',19,ref);
  g:=pg_temp.fin_pay(s,'pay_fin_early',ref);
  perform pg_temp.check_fin(not public.billing_concessao_autorizada_v1(public.billing_ambiente_v1(),
    (select usuario_id from public.billing_subscriptions where id=s),g,1),'antecipado nao antecipa franquia');
  s:=pg_temp.fin_fixture('PRO',23,'2024-01-01');
  g:=pg_temp.fin_pay(s,'pay_fin_late','2024-01-01');
  perform pg_temp.check_fin((select inicio='2024-01-01 00:00 America/Sao_Paulo'::timestamptz from public.billing_concessoes where id=g)
    and not public.billing_concessao_autorizada_v1(public.billing_ambiente_v1(),
    (select usuario_id from public.billing_subscriptions where id=s),g,1),'atrasado nao desloca periodo vencido');
end $ordem_e_calendario$;

do $termos_e_cancelamento$
declare s uuid; g uuid; g2 uuid; ev jsonb; bloqueado boolean:=false;
begin
  s:=pg_temp.fin_fixture('PRO',29,'2024-01-01');
  perform pg_temp.fin_pay(s,'pay_fin_due','2024-01-01','PAYMENT_CREATED');
  g:=pg_temp.fin_pay(s,'pay_fin_due','2024-01-15');
  perform pg_temp.check_fin((select inicio='2024-01-01 00:00 America/Sao_Paulo'::timestamptz
    from public.billing_concessoes where id=g),'vencimento alterado nao muda ciclo capturado');
  begin update public.billing_subscriptions set franquia_ia=999 where id=s;
  exception when check_violation then bloqueado:=true; end;
  perform pg_temp.check_fin(bloqueado,'alteracao de contrato com pagamento rejeitada');
  g2:=pg_temp.fin_pay(s,'pay_fin_overlap','2024-01-01');
  perform pg_temp.check_fin((select estado='REVIEW' and motivo_estado='OVERLAPPING_PERIOD'
    from public.billing_concessoes where id=g2),'sobreposicao nao duplica credito');
  g2:=pg_temp.fin_pay(s,'pay_fin_shift','2024-02-15');
  perform pg_temp.check_fin((select estado='REVIEW' and motivo_estado='DUE_DATE_CHANGED'
    from public.billing_concessoes where id=g2),'vencimento inicial desalinhado em revisao');
  ev:=jsonb_build_object('id','evt_'||gen_random_uuid(),'event','SUBSCRIPTION_DELETED',
    'subscription',jsonb_build_object('id','sub_'||s,'customer','cus_'||s));
  perform pg_temp.check_fin(public.billing_processar_webhook_v1(ev)='processed','cancelamento processado');
  perform pg_temp.check_fin((select estado='AUTHORIZED' and revisao=1 from public.billing_concessoes where id=g),
    'cancelamento da recorrencia preserva periodo pago');
  s:=pg_temp.fin_fixture('BUSINESS',null,'2024-01-01');
  g:=pg_temp.fin_pay(s,'pay_fin_missing','2024-01-01');
  perform pg_temp.check_fin((select estado='REVIEW' and franquia is null and motivo_estado='MISSING_QUOTA'
    from public.billing_concessoes where id=g),'franquia ausente sem fallback fixo');
  s:=pg_temp.fin_fixture('BUSINESS',71,'2024-01-01');
  g:=pg_temp.fin_pay(s,'pay_fin_tombstone','2024-01-01','PAYMENT_REFUNDED');
  perform pg_temp.fin_pay(s,'pay_fin_tombstone','2024-01-01');
  perform pg_temp.check_fin((select estado='REVOKED' and revisao=1 and franquia=71
    from public.billing_concessoes where id=g),'estorno anterior a confirmacao impede concessao posterior');
end $termos_e_cancelamento$;

do $manual$
declare u uuid:=gen_random_uuid(); ref uuid:=gen_random_uuid(); g uuid; x uuid; rejeitado boolean:=false;
  inicio timestamptz:=now()-interval '1 day'; fim timestamptz:=now()+interval '1 day';
begin
  insert into auth.users(id,email) values(u,u||'@example.invalid');
  g:=public.billing_conceder_administrativa_v1(public.billing_ambiente_v1(),ref,u,'PRO',31,inicio,fim,'Credito de suporte sintetico');
  x:=public.billing_conceder_administrativa_v1(public.billing_ambiente_v1(),ref,u,'PRO',31,inicio,fim,'Credito de suporte sintetico');
  perform pg_temp.check_fin(g=x and (select origem='ADMIN' and pagamento_id is null and assinatura_id is null
    and justificativa is not null from public.billing_concessoes where id=g),'manual com identidade e justificativa proprias');
  perform pg_temp.check_fin(public.billing_concessao_autorizada_v1(public.billing_ambiente_v1(),u,g,1)
    and not public.billing_concessao_autorizada_v1(public.billing_ambiente_v1(),gen_random_uuid(),g,1),
    'guard de consumo autentica usuario, revisao e periodo');
  begin perform public.billing_conceder_administrativa_v1(public.billing_ambiente_v1(),ref,u,'PRO',32,inicio,fim,'Credito de suporte sintetico');
  exception when raise_exception then rejeitado:=true; end;
  perform pg_temp.check_fin(rejeitado,'referencia manual nao altera termos'); rejeitado:=false;
  begin perform public.billing_conceder_administrativa_v1(public.billing_ambiente_v1(),gen_random_uuid(),u,'PRO',31,inicio,fim,'Sobreposto');
  exception when raise_exception then rejeitado:=true; end;
  perform pg_temp.check_fin(rejeitado,'manual sobreposto rejeitado'); rejeitado:=false;
  begin perform public.billing_conceder_administrativa_v1(public.billing_ambiente_v1(),gen_random_uuid(),u,'PRO',31,inicio,fim,null);
  exception when raise_exception then rejeitado:=true; end;
  perform pg_temp.check_fin(rejeitado,'justificativa obrigatoria');
  perform public.billing_revogar_administrativa_v1(public.billing_ambiente_v1(),g,'Fim do credito sintetico');
  perform public.billing_revogar_administrativa_v1(public.billing_ambiente_v1(),g,'Repeticao');
  perform pg_temp.check_fin((select estado='REVOKED' and revisao=2 from public.billing_concessoes where id=g),
    'revogacao manual idempotente');
end $manual$;

do $contrato_novo$
declare s uuid; s2 uuid:=gen_random_uuid(); g uuid; novo uuid; u uuid; fim_anterior timestamptz; bloqueado boolean:=false;
begin
  s:=pg_temp.fin_fixture('PRO',47,current_date);
  g:=pg_temp.fin_pay(s,'pay_fin_cancel',current_date);
  select usuario_id into u from public.billing_subscriptions where id=s;
  perform pg_temp.check_fin(public.billing_processar_webhook_v1(jsonb_build_object('id','evt_'||gen_random_uuid(),
    'event','SUBSCRIPTION_DELETED','subscription',jsonb_build_object('id','sub_'||s,'customer','cus_'||s)))='processed',
    'cancelamento de periodo atual pago');
  perform pg_temp.check_fin(public.billing_concessao_autorizada_v1(public.billing_ambiente_v1(),u,g,1),
    'cancelamento mantem acesso financeiro ate fim pago');
  -- Mudanca de contrato somente em outro caso, apos expiracao do periodo antigo.
  s:=pg_temp.fin_fixture('PRO',47,'2024-01-01');
  g:=pg_temp.fin_pay(s,'pay_fin_old_terms','2024-01-01');
  select usuario_id into u from public.billing_subscriptions where id=s;
  select c.fim into fim_anterior from public.billing_concessoes c where id=g;
  update public.billing_subscriptions set status_local='canceled' where id=s;
  insert into public.billing_subscriptions(id,usuario_id,billing_customer_id,plan_code,franquia_ia,
    valor_centavos,status_local,gateway_subscription_id,criado_em)
    select s2,usuario_id,billing_customer_id,'BUSINESS',79,valor_centavos,'checkout_pending','sub_'||s2,criado_em
    from public.billing_subscriptions where id=s;
  -- Novo contrato futuro e controlado, nao um endpoint de upgrade automatico.
  perform pg_temp.check_fin(public.billing_processar_webhook_v1(jsonb_build_object('id','evt_'||gen_random_uuid(),
    'event','PAYMENT_CONFIRMED','payment',jsonb_build_object('id','pay_fin_new_terms','customer','cus_'||s,
    'subscription','sub_'||s2,'billingType','CREDIT_CARD','value',123.45,
    'dueDate',(fim_anterior at time zone 'America/Sao_Paulo')::date)))='processed','novo contrato independente');
  select id into novo from public.billing_concessoes where assinatura_id=s2;
  perform pg_temp.check_fin((select franquia=79 and plano='BUSINESS' and inicio=fim_anterior and estado='AUTHORIZED'
    from public.billing_concessoes where id=novo) and (select franquia=47 and plano='PRO' from public.billing_concessoes where id=g),
    'novo contrato nao altera termos historicos');
  begin update public.billing_concessoes set franquia=99 where id=g;
  exception when check_violation then bloqueado:=true; end;
  perform pg_temp.check_fin(bloqueado,'concessao financeira nao pode ter termos reescritos');
end $contrato_novo$;

-- Sem consumidor instalado, nao ha ACK ficticio nem perda da entrega.
do $sem_consumidor$
declare lote jsonb; item jsonb;
begin
  lote:=public.billing_concessoes_reservar_entregas_v1(public.billing_ambiente_v1(),100);
  for item in select value from jsonb_array_elements(lote) loop
    perform pg_temp.check_fin(public.billing_concessoes_entregar_v1(public.billing_ambiente_v1(),
      (item->>'entrega_id')::uuid,(item->>'token')::uuid)='pending','consumidor ausente permanece pendente');
  end loop;
  perform pg_temp.check_fin((select bool_and(status='pending' or status='superseded')
    from public.billing_concessoes_entregas),'nenhuma entrega perdida');
end $sem_consumidor$;

-- DUBLE descartavel de consumidor. Nao e implementacao/migration da frente IA.
create temporary table fin_projection(id uuid primary key,revisao bigint,estado text,franquia integer,chamadas integer);
create function public.ia_receber_concessao_financeira_v1(p jsonb) returns boolean
language plpgsql as $$
begin
  insert into fin_projection values((p->>'concessao_id')::uuid,(p->>'revisao')::bigint,
    p->>'estado',(p->>'franquia')::integer,1)
  on conflict(id) do update set revisao=excluded.revisao,estado=excluded.estado,
    chamadas=fin_projection.chamadas+1 where fin_projection.revisao<excluded.revisao;
  if current_setting('fixture.consumer',true)='error' then raise exception 'DADO_SENSIVEL_NAO_LOGAR'; end if;
  return current_setting('fixture.consumer',true) is distinct from 'false';
end; $$;
revoke all on function public.ia_receber_concessao_financeira_v1(jsonb) from public;

do $consumidor_nao_confiavel$
declare item jsonb;
begin
  alter function public.ia_receber_concessao_financeira_v1(jsonb) owner to authenticated;
  update public.billing_concessoes_entregas set disponivel_em=now()-interval '1 second' where status='pending';
  item:=public.billing_concessoes_reservar_entregas_v1(public.billing_ambiente_v1(),1)->0;
  perform pg_temp.check_fin(public.billing_concessoes_entregar_v1(public.billing_ambiente_v1(),
    (item->>'entrega_id')::uuid,(item->>'token')::uuid)='pending','hook de role nao confiavel rejeitado');
  perform pg_temp.check_fin(not exists(select 1 from fin_projection) and
    (select ultimo_erro='CONSUMER_INCOMPATIBLE' from public.billing_concessoes_entregas
      where id=(item->>'entrega_id')::uuid),'hook nao confiavel nao executado como owner');
  alter function public.ia_receber_concessao_financeira_v1(jsonb) owner to current_user;
end $consumidor_nao_confiavel$;

do $recuperacao$
declare lote jsonb; item jsonb; token_antigo uuid; entrega uuid; g uuid; s uuid; resultado text;
begin
  update public.billing_concessoes_entregas set disponivel_em=now()-interval '1 minute' where status='pending';
  lote:=public.billing_concessoes_reservar_entregas_v1(public.billing_ambiente_v1(),100);
  perform pg_temp.check_fin(public.billing_concessoes_reservar_entregas_v1(public.billing_ambiente_v1(),100)='[]',
    'lease vivo impede segunda reserva');
  item:=lote->0; entrega:=(item->>'entrega_id')::uuid; token_antigo:=(item->>'token')::uuid;
  update public.billing_concessoes_entregas set lease_ate=now()-interval '1 second' where id=entrega;
  item:=public.billing_concessoes_reservar_entregas_v1(public.billing_ambiente_v1(),100)->0;
  perform pg_temp.check_fin((item->>'token')::uuid<>token_antigo and
    public.billing_concessoes_entregar_v1(public.billing_ambiente_v1(),entrega,token_antigo)='lease_lost',
    'lease expirado recuperavel sem aceitar token antigo');
  perform set_config('fixture.consumer','error',true);
  perform pg_temp.check_fin(public.billing_concessoes_entregar_v1(public.billing_ambiente_v1(),entrega,
    (item->>'token')::uuid)='retry','erro do consumidor permite retry');
  perform pg_temp.check_fin((select ultimo_erro='SQLSTATE P0001' and status='pending'
    from public.billing_concessoes_entregas where id=entrega) and not exists(select 1 from fin_projection),
    'erro sanitizado e escrita parcial do consumidor desfeita');
  perform set_config('fixture.consumer','false',true);
  update public.billing_concessoes_entregas set disponivel_em=now()-interval '1 second' where id=entrega;
  item:=public.billing_concessoes_reservar_entregas_v1(public.billing_ambiente_v1(),100)->0;
  perform pg_temp.check_fin(public.billing_concessoes_entregar_v1(public.billing_ambiente_v1(),entrega,
    (item->>'token')::uuid)='retry' and not exists(select 1 from fin_projection),'ACK false nao confirma entrega');
  perform set_config('fixture.consumer','ok',true);
  update public.billing_concessoes_entregas set status='pending',disponivel_em=now()-interval '1 second',
    token=null,lease_ate=null where status='processing' or id=entrega;
  lote:=public.billing_concessoes_reservar_entregas_v1(public.billing_ambiente_v1(),100);
  for item in select value from jsonb_array_elements(lote) loop
    perform pg_temp.check_fin(public.billing_concessoes_entregar_v1(public.billing_ambiente_v1(),
      (item->>'entrega_id')::uuid,(item->>'token')::uuid)='delivered','recuperacao sem novo webhook');
    perform pg_temp.check_fin(public.billing_concessoes_entregar_v1(public.billing_ambiente_v1(),
      (item->>'entrega_id')::uuid,(item->>'token')::uuid)='duplicate','ACK repetido idempotente');
  end loop;
  perform pg_temp.check_fin((select bool_and(chamadas=1) from fin_projection),'consumidor recebe cada revisao uma vez');
  s:=pg_temp.fin_fixture('PRO',41,current_date);
  g:=pg_temp.fin_pay(s,'pay_fin_race',current_date);
  item:=public.billing_concessoes_reservar_entregas_v1(public.billing_ambiente_v1(),100)->0;
  perform pg_temp.fin_pay(s,'pay_fin_race',current_date,'PAYMENT_REFUNDED');
  perform pg_temp.check_fin(public.billing_concessoes_entregar_v1(public.billing_ambiente_v1(),
    (item->>'entrega_id')::uuid,(item->>'token')::uuid)='stale' and not exists(select 1 from fin_projection where id=g),
    'revogacao impede entrega antiga de reativar');
  item:=public.billing_concessoes_reservar_entregas_v1(public.billing_ambiente_v1(),100)->0;
  resultado:=public.billing_concessoes_entregar_v1(public.billing_ambiente_v1(),
    (item->>'entrega_id')::uuid,(item->>'token')::uuid);
  perform pg_temp.check_fin(resultado='delivered' and
    (select estado='REVOKED' and revisao=2 from fin_projection where id=g),'revogacao entregue sem webhook novo');
  perform pg_temp.check_fin(not public.billing_concessao_autorizada_v1(public.billing_ambiente_v1(),
    (select usuario_id from public.billing_subscriptions where id=s),g,1),'revisao antiga rejeitada no consumo');
end $recuperacao$;

do $revogacao_com_projecao_antiga$
declare s uuid; g uuid; u uuid; item jsonb; resultado text;
begin
  s:=pg_temp.fin_fixture('BUSINESS',83,current_date);
  g:=pg_temp.fin_pay(s,'pay_fin_delivered',current_date);
  select usuario_id into u from public.billing_subscriptions where id=s;
  item:=public.billing_concessoes_reservar_entregas_v1(public.billing_ambiente_v1(),100)->0;
  resultado:=public.billing_concessoes_entregar_v1(public.billing_ambiente_v1(),
    (item->>'entrega_id')::uuid,(item->>'token')::uuid);
  perform pg_temp.check_fin(resultado='delivered' and (select estado='AUTHORIZED' and franquia=83
    from fin_projection where id=g),'projecao autorizada antes do estorno');
  perform pg_temp.fin_pay(s,'pay_fin_delivered',current_date,'PAYMENT_CHARGEBACK_REQUESTED');
  perform pg_temp.check_fin((select estado='AUTHORIZED' from fin_projection where id=g)
    and not public.billing_concessao_autorizada_v1(public.billing_ambiente_v1(),u,g,1)
    and not public.billing_concessao_autorizada_v1(public.billing_ambiente_v1(),u,g,2),
    'origem revogada bloqueia consumo mesmo com projecao antiga e entrega pendente');
  perform pg_temp.check_fin(public.billing_concessoes_entregar_v1(public.billing_ambiente_v1(),
    (item->>'entrega_id')::uuid,(item->>'token')::uuid)='stale','entrega autorizada antiga nao reexecuta apos chargeback');
end $revogacao_com_projecao_antiga$;

-- Falha na outbox deve desfazer confirmacao/concessao, preservando evento para retry.
create function pg_temp.fin_fault() returns trigger language plpgsql as $$
begin raise exception 'Falha sintetica outbox'; end; $$;
create trigger fin_fault after insert on public.billing_concessoes_entregas for each row execute function pg_temp.fin_fault();
do $atomicidade$
declare s uuid; ev jsonb;
begin
  s:=pg_temp.fin_fixture('PRO',43,current_date);
  ev:=pg_temp.fin_event(s,'pay_fin_atomic',current_date);
  perform pg_temp.check_fin(public.billing_processar_webhook_v1(ev)='retry','falha da outbox nao processa evento');
  perform pg_temp.check_fin(not exists(select 1 from public.billing_payments where gateway_payment_id='pay_fin_atomic')
    and not exists(select 1 from public.billing_concessoes where assinatura_id=s),'transacao financeira atomica');
  perform pg_temp.check_fin((select status_processamento='error' from public.billing_webhook_events
    where gateway_event_id=ev->>'id'),'evento retry preservado');
  drop trigger fin_fault on public.billing_concessoes_entregas;
  perform pg_temp.check_fin(public.billing_processar_webhook_v1(ev)='processed','retry do mesmo evento processado');
  perform pg_temp.check_fin((select count(*)=1 from public.billing_concessoes where assinatura_id=s),
    'retry do mesmo evento recupera uma concessao');
end $atomicidade$;

do $seguranca$
declare t text; fn regprocedure; negado boolean:=false; a text:=public.billing_ambiente_v1();
begin
  foreach t in array array['billing_concessoes','billing_concessoes_revisoes','billing_concessoes_entregas'] loop
    perform pg_temp.check_fin((select relrowsecurity from pg_class where oid=('public.'||t)::regclass),'RLS ativa '||t);
    perform pg_temp.check_fin(not has_table_privilege('authenticated','public.'||t,'SELECT,INSERT,UPDATE,DELETE')
      and not has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE'),'sem acesso cliente '||t);
    perform pg_temp.check_fin(not has_table_privilege('service_role','public.'||t,'INSERT,UPDATE,DELETE'),
      'servico nao altera concessao/outbox diretamente '||t);
  end loop;
  for fn in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace
    and proname in ('billing_concessao_autorizada_v1','billing_concessoes_reservar_entregas_v1',
      'billing_concessoes_entregar_v1','billing_conceder_administrativa_v1','billing_revogar_administrativa_v1') loop
    perform pg_temp.check_fin(not has_function_privilege('authenticated',fn,'EXECUTE')
      and not has_function_privilege('anon',fn,'EXECUTE'),'RPC financeira privada '||fn::text);
  end loop;
  perform pg_temp.check_fin(not has_function_privilege('service_role',
    'public.billing_conceder_administrativa_v1(text,uuid,uuid,text,integer,timestamptz,timestamptz,text)','EXECUTE'),
    'servico de recuperacao nao concede credito manual');
  begin perform public.billing_concessoes_reservar_entregas_v1(case a when 'sandbox' then 'production' else 'sandbox' end,1);
  exception when insufficient_privilege then negado:=true; end;
  perform pg_temp.check_fin(negado,'ambientes cruzados rejeitados');
end $seguranca$;

do $roles_reais$
declare negado boolean:=false; a text:=public.billing_ambiente_v1();
begin
  set local role authenticated;
  begin perform count(*) from public.billing_concessoes;
  exception when insufficient_privilege then negado:=true; end;
  reset role;
  perform pg_temp.check_fin(negado,'authenticated nao le concessoes de outro usuario ou do proprio');
  negado:=false;
  set local role anon;
  begin perform public.billing_concessoes_reservar_entregas_v1(a,1);
  exception when insufficient_privilege then negado:=true; end;
  reset role;
  perform pg_temp.check_fin(negado,'anon nao recupera nem cria concessao');
  set local role service_role;
  perform public.billing_concessoes_reservar_entregas_v1(a,1);
  negado:=false;
  begin update public.billing_payments set valor_centavos=1;
  exception when insufficient_privilege then negado:=true; end;
  reset role;
  perform pg_temp.check_fin(negado,'service_role recupera mas nao falsifica pagamento direto');
end $roles_reais$;

select count(*) as verificacoes_financeiras from fin_checks;
rollback;
