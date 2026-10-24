-- QA LOCAL: eventos SINTETICOS, nao assinados/emitidos pelo gateway.
-- Somente PGlite/SQL descartavel. Sem rede, pagamentos ou recursos remotos.
begin;
create temporary table qa_neg_checks(cenario text,ok boolean);
create temporary table qa_neg_mutations(tabela text);
create function pg_temp.qa_neg_count_update() returns trigger language plpgsql as $$
begin insert into qa_neg_mutations values(tg_table_name); return new; end; $$;
create trigger qa_neg_count_update after update on public.billing_subscriptions for each row execute function pg_temp.qa_neg_count_update();
create trigger qa_neg_count_update after update on public.billing_payments for each row execute function pg_temp.qa_neg_count_update();
create trigger qa_neg_count_update after update on public.assinaturas_usuario for each row execute function pg_temp.qa_neg_count_update();
create function pg_temp.qa_neg_check(ok boolean,cenario text) returns void language plpgsql as $$
begin insert into qa_neg_checks values(cenario,coalesce(ok,false)); end; $$;
create function pg_temp.qa_neg_fixture(ancora date,plano text default 'PRO') returns uuid language plpgsql as $$
declare u uuid:=gen_random_uuid(); c uuid; s uuid:=gen_random_uuid();
begin
  insert into auth.users(id,email) values(u,u||'@example.invalid');
  insert into public.billing_customers(usuario_id,gateway_customer_id,status_local)
    values(u,'cus_neg_'||s,'ready') returning id into c;
  insert into public.billing_subscriptions(id,usuario_id,billing_customer_id,plan_code,franquia_ia,
    valor_centavos,status_local,gateway_subscription_id,gateway_checkout_id,criado_em)
    values(s,u,c,plano,37,case when plano='PRO' then 9900 else 19700 end,'checkout_pending','sub_neg_'||s,'chk_neg_'||s,
      ancora::timestamp at time zone 'America/Sao_Paulo');
  return s;
end; $$;
create function pg_temp.qa_neg_event(s uuid,pagamento text,venc date,tipo text) returns jsonb language sql as $$
  select jsonb_build_object('id','evt_neg_'||gen_random_uuid(),'event',tipo,'payment',jsonb_build_object(
    'id',pagamento,'customer','cus_neg_'||s,'subscription','sub_neg_'||s,
    'value',(select valor_centavos::numeric/100 from public.billing_subscriptions where id=s),
    'dueDate',venc,'billingType','CREDIT_CARD'));
$$;
create function pg_temp.qa_neg_cancel(s uuid) returns text language sql as $$
  select public.billing_processar_webhook_v1(jsonb_build_object('id','evt_neg_'||gen_random_uuid(),
    'event','SUBSCRIPTION_DELETED','subscription',jsonb_build_object('id','sub_neg_'||s,'customer','cus_neg_'||s)));
$$;
create function pg_temp.qa_neg_send(s uuid,pagamento text,venc date,tipo text) returns void language plpgsql as $$
begin
  perform pg_temp.qa_neg_check(public.billing_processar_webhook_v1(pg_temp.qa_neg_event(s,pagamento,venc,tipo))='processed',tipo||' processado');
end; $$;

do $matriz$
declare s uuid; u uuid; g uuid; periodo timestamptz; ev jsonb; antes jsonb; depois jsonb; escritas integer;
  ref date:=date_trunc('month',now() at time zone 'America/Sao_Paulo')::date;
begin
  -- 1. Recusa nao e confirmacao; nem recebimento isolado cria concessao.
  s:=pg_temp.qa_neg_fixture(ref);
  perform pg_temp.qa_neg_send(s,'pay_neg_refused',ref,'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED');
  perform pg_temp.qa_neg_check(not exists(select 1 from public.billing_concessoes where assinatura_id=s)
    and (select confirmado_em is null from public.billing_payments where gateway_payment_id='pay_neg_refused'),
    '01 recusa sem concessao ou confirmacao');
  perform pg_temp.qa_neg_check((select plano='FREE' from public.assinaturas_usuario
    where usuario_id=(select usuario_id from public.billing_subscriptions where id=s)),'01 recusa mantem Free');
  perform pg_temp.qa_neg_send(s,'pay_neg_received',ref,'PAYMENT_RECEIVED');
  perform pg_temp.qa_neg_check(not exists(select 1 from public.billing_concessoes where assinatura_id=s),'01 recebimento isolado nao concede');

  -- 2. Expiracao real do checkout e diferente do retorno expiredUrl.
  s:=pg_temp.qa_neg_fixture(ref);
  ev:=jsonb_build_object('id','evt_neg_'||gen_random_uuid(),'event','CHECKOUT_EXPIRED',
    'checkout',jsonb_build_object('id','chk_neg_'||s));
  perform pg_temp.qa_neg_check(public.billing_processar_webhook_v1(ev)='processed','02 expiracao processada');
  perform pg_temp.qa_neg_check((select status_local='expired' and paid_until is null from public.billing_subscriptions where id=s)
    and not exists(select 1 from public.billing_concessoes where assinatura_id=s),'02 expiracao nao concede');

  -- 3 e 4. Atraso nao corta periodo ja pago; confirmacao tardia nao move ciclo.
  s:=pg_temp.qa_neg_fixture(ref);
  perform pg_temp.qa_neg_send(s,'pay_neg_late',ref,'PAYMENT_OVERDUE');
  perform pg_temp.qa_neg_check(not exists(select 1 from public.billing_concessoes where assinatura_id=s),'03 vencido sem credito');
  perform pg_temp.qa_neg_send(s,'pay_neg_late',ref,'PAYMENT_CONFIRMED');
  select id into g from public.billing_concessoes where assinatura_id=s;
  perform pg_temp.qa_neg_check((select inicio=ref::timestamp at time zone 'America/Sao_Paulo'
    and franquia=37 and estado='AUTHORIZED' from public.billing_concessoes where id=g),'04 atraso preserva periodo e termos');
  perform pg_temp.qa_neg_send(s,'pay_neg_next_unpaid',(ref+interval '1 month')::date,'PAYMENT_OVERDUE');
  perform pg_temp.qa_neg_check((select fim_em>now() and plano='PRO' from public.assinaturas_usuario
    where usuario_id=(select usuario_id from public.billing_subscriptions where id=s)),'03 inadimplencia nao apaga periodo pago');
  s:=pg_temp.qa_neg_fixture((ref-interval '2 months')::date);
  perform pg_temp.qa_neg_send(s,'pay_neg_expired_cycle',(ref-interval '2 months')::date,'PAYMENT_OVERDUE');
  perform pg_temp.qa_neg_send(s,'pay_neg_expired_cycle',(ref-interval '2 months')::date,'PAYMENT_CONFIRMED');
  select usuario_id into u from public.billing_subscriptions where id=s;
  select id into g from public.billing_concessoes where assinatura_id=s;
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform pg_temp.qa_neg_check(public.plano_atual_v1()='FREE' and
    not public.billing_concessao_autorizada_v1(public.billing_ambiente_v1(),u,g,1),'04 atraso de ciclo encerrado nao concede mes novo');

  -- 5. Estorno de renovacao FUTURA nao pode retirar o periodo ATUAL pago.
  s:=pg_temp.qa_neg_fixture(ref);
  perform pg_temp.qa_neg_send(s,'pay_neg_current',ref,'PAYMENT_CONFIRMED');
  select id,fim into g,periodo from public.billing_concessoes where assinatura_id=s;
  perform pg_temp.qa_neg_send(s,'pay_neg_future',(ref+interval '1 month')::date,'PAYMENT_CONFIRMED');
  perform pg_temp.qa_neg_send(s,'pay_neg_future',(ref+interval '1 month')::date,'PAYMENT_REFUNDED');
  perform pg_temp.qa_neg_check((select plano='PRO' and fim_em=periodo from public.assinaturas_usuario
    where usuario_id=(select usuario_id from public.billing_subscriptions where id=s)),
    '05 estorno futuro preserva Pro e fim do periodo atual');
  perform pg_temp.qa_neg_check((select paid_until=periodo from public.billing_subscriptions where id=s),
    '05 paid_until recalculado sem periodo estornado');
  perform pg_temp.qa_neg_check((select estado='AUTHORIZED' and revisao=1 from public.billing_concessoes where id=g)
    and (select estado='REVOKED' and revisao=2 from public.billing_concessoes c join public.billing_payments p
      on p.id=c.pagamento_id where p.gateway_payment_id='pay_neg_future'),'05 somente concessao do estorno revogada');
  -- Estorno do ultimo periodo realmente valido retira acesso.
  perform pg_temp.qa_neg_send(s,'pay_neg_current',ref,'PAYMENT_REFUNDED');
  perform pg_temp.qa_neg_check((select plano='FREE' from public.assinaturas_usuario
    where usuario_id=(select usuario_id from public.billing_subscriptions where id=s)),'05 sem outro periodo pago retorna Free');
  select count(*) into escritas from qa_neg_mutations;
  perform pg_temp.qa_neg_send(s,'pay_neg_current',ref,'PAYMENT_REFUNDED');
  perform pg_temp.qa_neg_send(s,'pay_neg_current',ref,'PAYMENT_CHARGEBACK_REQUESTED');
  perform pg_temp.qa_neg_check((select count(*)=escritas from qa_neg_mutations),'05 eventos novos do estorno nao reescrevem estado financeiro');

  -- 6. Chargeback terminal, confirmacao repetida nao ressuscita.
  s:=pg_temp.qa_neg_fixture(ref);
  perform pg_temp.qa_neg_send(s,'pay_neg_chargeback',ref,'PAYMENT_CONFIRMED');
  perform pg_temp.qa_neg_send(s,'pay_neg_chargeback',ref,'PAYMENT_CHARGEBACK_REQUESTED');
  perform pg_temp.qa_neg_send(s,'pay_neg_chargeback',ref,'PAYMENT_CONFIRMED');
  perform pg_temp.qa_neg_check((select estado='REVOKED' and revisao=2 from public.billing_concessoes where assinatura_id=s)
    and (select plano='FREE' from public.assinaturas_usuario where usuario_id=
      (select usuario_id from public.billing_subscriptions where id=s)),'06 chargeback terminal sem reativacao');

  -- 7 e 9. Recorrencia cancelada, depois chega confirmacao de outro ciclo pago.
  s:=pg_temp.qa_neg_fixture(ref);
  perform pg_temp.qa_neg_send(s,'pay_neg_cancel_first',ref,'PAYMENT_CONFIRMED');
  perform pg_temp.qa_neg_check(pg_temp.qa_neg_cancel(s)='processed','07 cancelamento processado');
  perform pg_temp.qa_neg_send(s,'pay_neg_cancel_next',(ref+interval '1 month')::date,'PAYMENT_CONFIRMED');
  perform pg_temp.qa_neg_check((select status_local='canceled' and paid_until>now() from public.billing_subscriptions where id=s),
    '09 confirmacao apos cancelamento nao reativa recorrencia');
  perform pg_temp.qa_neg_check((select count(*)=2 and bool_and(estado='AUTHORIZED') from public.billing_concessoes where assinatura_id=s),
    '07 cancelamento nao revoga periodos pagos');

  -- 8. Mesmo ID e outro ID para o mesmo pagamento nao duplicam concessao/outbox.
  s:=pg_temp.qa_neg_fixture(ref);
  ev:=pg_temp.qa_neg_event(s,'pay_neg_duplicate',ref,'PAYMENT_CONFIRMED');
  perform pg_temp.qa_neg_check(public.billing_processar_webhook_v1(ev)='processed','08 primeira entrega');
  select jsonb_build_object('concessoes',(select jsonb_agg(to_jsonb(c)) from public.billing_concessoes c where assinatura_id=s),
    'outbox',(select jsonb_agg(to_jsonb(e)) from public.billing_concessoes_entregas e join public.billing_concessoes c
      on c.id=e.concessao_id where c.assinatura_id=s)) into antes;
  perform pg_temp.qa_neg_check(public.billing_processar_webhook_v1(ev)='duplicate','08 duplicado mesmo ID');
  perform pg_temp.qa_neg_send(s,'pay_neg_duplicate',ref,'PAYMENT_CONFIRMED');
  select jsonb_build_object('concessoes',(select jsonb_agg(to_jsonb(c)) from public.billing_concessoes c where assinatura_id=s),
    'outbox',(select jsonb_agg(to_jsonb(e)) from public.billing_concessoes_entregas e join public.billing_concessoes c
      on c.id=e.concessao_id where c.assinatura_id=s)) into depois;
  perform pg_temp.qa_neg_check(antes=depois,'08 idempotencia integral concessao/outbox');

  -- 9. Evento atrasado de checkout nao apaga uma confirmacao financeira.
  perform pg_temp.qa_neg_check(public.billing_processar_webhook_v1(jsonb_build_object('id','evt_neg_'||gen_random_uuid(),
    'event','CHECKOUT_EXPIRED','checkout',jsonb_build_object('id','chk_neg_'||s)))='processed','09 expiracao tardia reconhecida');
  perform pg_temp.qa_neg_check((select status_local='active' from public.billing_subscriptions where id=s)
    and (select estado='AUTHORIZED' from public.billing_concessoes where assinatura_id=s),'09 expiracao tardia nao remove pagamento');
  perform pg_temp.qa_neg_send(s,'pay_neg_duplicate',ref,'PAYMENT_OVERDUE');
  perform pg_temp.qa_neg_check((select status_local='active' from public.billing_subscriptions where id=s),'09 overdue antigo nao regride confirmado');

  -- Mesmas correcoes devem preservar BUSINESS sem projetar PRO por engano.
  s:=pg_temp.qa_neg_fixture(ref,'BUSINESS');
  perform pg_temp.qa_neg_send(s,'pay_neg_business_current',ref,'PAYMENT_CONFIRMED');
  select fim into periodo from public.billing_concessoes where assinatura_id=s;
  perform pg_temp.qa_neg_send(s,'pay_neg_business_next',(ref+interval '1 month')::date,'PAYMENT_CONFIRMED');
  perform pg_temp.qa_neg_send(s,'pay_neg_business_next',(ref+interval '1 month')::date,'PAYMENT_REFUNDED');
  perform pg_temp.qa_neg_check((select plano='BUSINESS' and fim_em=periodo from public.assinaturas_usuario
    where usuario_id=(select usuario_id from public.billing_subscriptions where id=s)),'05 Business preservado apos estorno futuro');
  perform pg_temp.qa_neg_check(pg_temp.qa_neg_cancel(s)='processed','07 cancelamento Business');
  perform pg_temp.qa_neg_send(s,'pay_neg_business_replacement',(ref+interval '1 month')::date,'PAYMENT_CONFIRMED');
  perform pg_temp.qa_neg_check((select status_local='canceled' from public.billing_subscriptions where id=s)
    and (select plano='BUSINESS' from public.assinaturas_usuario where usuario_id=
      (select usuario_id from public.billing_subscriptions where id=s)),'09 Business cancelado nao reativa recorrencia nem vira Pro');
end $matriz$;

-- 10. Falha transacional na confirmacao e repeticao LOCAL do mesmo evento.
create function pg_temp.qa_neg_fault() returns trigger language plpgsql as $$
begin raise exception 'Falha local controlada'; end; $$;
create trigger qa_neg_fault after insert on public.billing_concessoes_entregas
  for each row execute function pg_temp.qa_neg_fault();
do $falha$
declare ref date:=date_trunc('month',now() at time zone 'America/Sao_Paulo')::date; s uuid; ev jsonb;
begin
  s:=pg_temp.qa_neg_fixture(ref); ev:=pg_temp.qa_neg_event(s,'pay_neg_retry',ref,'PAYMENT_CONFIRMED');
  perform pg_temp.qa_neg_check(public.billing_processar_webhook_v1(ev)='retry','10 falha solicita retry');
  perform pg_temp.qa_neg_check(not exists(select 1 from public.billing_payments where billing_subscription_id=s)
    and not exists(select 1 from public.billing_concessoes where assinatura_id=s),'10 rollback financeiro completo');
  perform pg_temp.qa_neg_check((select status_processamento='error' and erro='SQLSTATE P0001'
    from public.billing_webhook_events where gateway_event_id=ev->>'id'),'10 erro persistido sem dado sensivel');
  drop trigger qa_neg_fault on public.billing_concessoes_entregas;
  perform pg_temp.qa_neg_check(public.billing_processar_webhook_v1(ev)='processed','10 retry do mesmo evento recupera');
  perform pg_temp.qa_neg_check((select count(*)=1 from public.billing_concessoes where assinatura_id=s),'10 uma unica concessao apos recuperacao');
end $falha$;

do $resultado$
declare falhas text;
begin
  select string_agg(cenario,'; ') into falhas from qa_neg_checks where not ok;
  if falhas is not null then raise exception 'Negativos SQL: %',falhas; end if;
end $resultado$;
select count(*) as verificacoes_negativas from qa_neg_checks;
rollback;
