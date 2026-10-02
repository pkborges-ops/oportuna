-- MANUAL: somente homologacao apos asaas_assinaturas_v1.sql. Termina em ROLLBACK.
-- Eventos sao sinteticos e NAO chamam a API do Asaas.
begin;
set local statement_timeout='30s';
create temporary table billing_fixture(a uuid,b uuid,c text,sub text,chk text,payid text);
do $teste$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid();
  c uuid; s uuid; ch text:='chk_'||gen_random_uuid();
  cliente text:='cus_'||gen_random_uuid(); assinatura text:='sub_'||gen_random_uuid();
  pagamento text:='pay_'||gen_random_uuid(); invalid_rejected boolean:=false;
begin
  insert into billing_fixture values(a,b,cliente,assinatura,ch,pagamento);
  insert into auth.users(id,email) values(a,a||'@example.invalid'),(b,b||'@example.invalid');
  insert into public.billing_customers(usuario_id,gateway_customer_id,status_local)
    values(a,cliente,'ready') returning id into c;
  insert into public.billing_subscriptions(usuario_id,billing_customer_id,plan_code,gateway_checkout_id,
    gateway_checkout_url,status_local,valor_centavos,checkout_expira_em)
    values(a,c,'PRO',ch,'https://sandbox.asaas.com/checkoutSession/show/'||ch,
      'checkout_pending',3990,now()+interval '1 hour') returning id into s;
  if (public.billing_reservar_cliente_v1(a)->>'customer_id') is distinct from cliente then
    raise exception 'Cliente nao foi reutilizado'; end if;
  if (public.billing_reservar_checkout_v1(a,'PRO',3990,null)->>'state') is distinct from 'reuse' then
    raise exception 'Checkout repetido nao foi reutilizado'; end if;
  if (public.billing_reservar_checkout_v1(a,'BUSINESS',3990,20)->>'state') is distinct from 'plan_conflict' then
    raise exception 'Checkout de outro plano reutilizou reserva Pro'; end if;
  if (select count(*) from public.billing_subscriptions where usuario_id=a)<>1 then
    raise exception 'Checkout duplicado'; end if;
  update public.assinaturas_usuario set plano='PRO',origem='MANUAL' where usuario_id=b;
  insert into public.billing_customers(usuario_id,gateway_customer_id,status_local)
    values(b,'cus_'||gen_random_uuid(),'ready');
  if (public.billing_reservar_checkout_v1(b,'BUSINESS',3990,20)->>'state') is distinct from 'paid_active' then
    raise exception 'Pro manual permitiu checkout';
  end if;
  begin
    perform public.billing_reservar_checkout_v1(a,'FREE',3990,null);
  exception when raise_exception then invalid_rejected:=true;
  end;
  if not invalid_rejected then raise exception 'FREE permitiu checkout'; end if;
end $teste$;

do $conciliacao$
declare u uuid:=gen_random_uuid(); reserva uuid:=gen_random_uuid();
  c uuid; cliente text:='cus_'||gen_random_uuid();
  checkout uuid:=gen_random_uuid(); ev jsonb;
begin
  insert into auth.users(id,email) values(u,u||'@example.invalid');
  insert into public.billing_customers(usuario_id,gateway_customer_id,status_local)
    values(u,cliente,'ready') returning id into c;
  insert into public.billing_subscriptions(id,usuario_id,billing_customer_id,
    plan_code,status_local,valor_centavos) values(reserva,u,c,'PRO','uncertain',3990);
  ev:=jsonb_build_object('id','evt_'||gen_random_uuid(),'event','CHECKOUT_CREATED',
    'checkout',jsonb_build_object('id',checkout,'customer',cliente,
      'externalReference',reserva));
  if public.billing_processar_webhook_v1(ev)<>'processed' then
    raise exception 'Checkout sem resposta nao foi conciliado'; end if;
  if (select gateway_checkout_id from public.billing_subscriptions where id=reserva)
      is distinct from checkout::text then
    raise exception 'Referencia local nao recuperou checkout'; end if;
  if (select plano from public.assinaturas_usuario where usuario_id=u)<>'FREE' then
    raise exception 'CHECKOUT_CREATED ativou Pro'; end if;
end $conciliacao$;

do $fluxo$
declare a uuid; b uuid; c text; sub text; chk text; payid text;
  ev jsonb; antes timestamptz; depois timestamptz; pay2 text:='pay_'||gen_random_uuid();
begin
  select f.a,f.b,f.c,f.sub,f.chk,f.payid into a,b,c,sub,chk,payid
    from billing_fixture f;
  ev:=jsonb_build_object('id','evt_'||gen_random_uuid(),'event','CHECKOUT_PAID',
    'checkout',jsonb_build_object('id',chk));
  if public.billing_processar_webhook_v1(ev)<>'processed' then raise exception 'Checkout pago'; end if;
  if (select plano from public.assinaturas_usuario where usuario_id=a)<>'FREE' then
    raise exception 'CHECKOUT_PAID ativou Pro'; end if;
  ev:=jsonb_build_object('id','evt_'||gen_random_uuid(),'event','SUBSCRIPTION_CREATED',
    'subscription',jsonb_build_object('id',sub,'customer',c,'nextDueDate',current_date));
  if public.billing_processar_webhook_v1(ev)<>'processed' then raise exception 'Assinatura criada'; end if;
  if (select gateway_subscription_id from public.billing_subscriptions where usuario_id=a) is not null then
    raise exception 'Assinatura vinculada sem checkout verificado'; end if;
  if (select plano from public.assinaturas_usuario where usuario_id=a)<>'FREE' then
    raise exception 'SUBSCRIPTION_CREATED ativou Pro'; end if;
  ev:=jsonb_build_object('id','evt_'||gen_random_uuid(),'event','PAYMENT_CONFIRMED',
    'payment',jsonb_build_object('id',payid,'subscription',sub,'customer',c,
      'value',39.90,'dueDate',current_date,'billingType','CREDIT_CARD'));
  if public.billing_processar_webhook_v1(ev)<>'retry' then
    raise exception 'Pagamento sem checkout verificado aceito'; end if;
  if public.billing_processar_webhook_v1(ev,chk)<>'processed' then
    raise exception 'Pagamento confirmado'; end if;
  select fim_em into antes from public.assinaturas_usuario where usuario_id=a and
    plano='PRO' and origem='ASAAS';
  if antes is null or antes<=now() then raise exception 'Pro nao ativou'; end if;
  if (select plano from public.assinaturas_usuario where usuario_id=a)='BUSINESS' then
    raise exception 'Checkout Pro ativou Business'; end if;
  if (public.billing_reservar_checkout_v1(a,'BUSINESS',3990,20)->>'state') is distinct from 'paid_active' then
    raise exception 'Assinatura Pro ativa permitiu segunda assinatura'; end if;
  if public.billing_processar_webhook_v1(ev)<>'duplicate' then raise exception 'Evento duplicado'; end if;
  if not public.billing_evento_processado_v1(ev->>'id') then
    raise exception 'Evento concluido nao detectado'; end if;
  select fim_em into depois from public.assinaturas_usuario where usuario_id=a;
  if depois<>antes then raise exception 'Periodo duplicado'; end if;
  ev:=jsonb_build_object('id','evt_'||gen_random_uuid(),'event','PAYMENT_OVERDUE',
    'payment',jsonb_build_object('id','pay_'||gen_random_uuid(),
      'subscription',sub,'customer',c,'value',39.90,'dueDate',current_date+30));
  if public.billing_processar_webhook_v1(ev)<>'processed' then raise exception 'Atraso'; end if;
  if (select fim_em from public.assinaturas_usuario where usuario_id=a)<>antes then
    raise exception 'Atraso removeu periodo pago'; end if;
  ev:=jsonb_build_object('id','evt_'||gen_random_uuid(),'event','PAYMENT_CONFIRMED',
    'payment',jsonb_build_object('id',pay2,'subscription',sub,'customer',c,
      'value',39.90,'dueDate',current_date+interval '1 month','billingType','CREDIT_CARD'));
  if public.billing_processar_webhook_v1(ev)<>'processed' then raise exception 'Renovacao'; end if;
  select fim_em into depois from public.assinaturas_usuario where usuario_id=a;
  if depois<=antes then raise exception 'Renovacao nao estendeu periodo'; end if;
  ev:=jsonb_build_object('id','evt_'||gen_random_uuid(),'event','PAYMENT_REFUNDED',
    'payment',jsonb_build_object('id',payid,'subscription',sub,'customer',c,
      'value',39.90,'dueDate',current_date));
  if public.billing_processar_webhook_v1(ev)<>'processed' then raise exception 'Estorno'; end if;
  if (select plano from public.assinaturas_usuario where usuario_id=a)<>'PRO' then
    raise exception 'Estorno de ciclo anterior retirou Pro novo'; end if;
  ev:=jsonb_build_object('id','evt_'||gen_random_uuid(),'event','PAYMENT_CHARGEBACK_REQUESTED',
    'payment',jsonb_build_object('id',pay2,'subscription',sub,'customer',c,
      'value',39.90,'dueDate',current_date+interval '1 month'));
  if public.billing_processar_webhook_v1(ev)<>'processed' then raise exception 'Chargeback'; end if;
  if (select plano from public.assinaturas_usuario where usuario_id=a)<>'FREE' then
    raise exception 'Chargeback manteve Pro'; end if;
  if (select plano from public.assinaturas_usuario where usuario_id=b)<>'PRO' then
    raise exception 'Pro manual alterado'; end if;
end $fluxo$;

do $business$
declare u uuid:=gen_random_uuid(); c uuid; s uuid;
  cliente text:='cus_'||gen_random_uuid(); chk text:='chk_'||gen_random_uuid();
  assinatura text:='sub_'||gen_random_uuid(); pagamento text:='pay_'||gen_random_uuid();
  ev jsonb; antes timestamptz; antigo uuid; sub_antiga text:='sub_'||gen_random_uuid();
  pay_antigo text:='pay_'||gen_random_uuid();
begin
  -- 3990 é apenas valor sintético do teste: o plano vem de plan_code, não do valor.
  insert into auth.users(id,email) values(u,u||'@example.invalid');
  insert into public.billing_customers(usuario_id,gateway_customer_id,status_local)
    values(u,cliente,'ready') returning id into c;
  if (public.billing_reservar_checkout_v1(u,'BUSINESS',3990,20)->>'state') is distinct from 'claim' then
    raise exception 'Checkout Business nao reservado'; end if;
  select id into strict s from public.billing_subscriptions where usuario_id=u;
  if (select plan_code from public.billing_subscriptions where id=s)<>'BUSINESS' or
    (select franquia_ia from public.billing_subscriptions where id=s)<>20 then
    raise exception 'Plano contratado nao registrado'; end if;
  perform public.billing_salvar_checkout_v1(s,chk,
    'https://sandbox.asaas.com/checkoutSession/show/'||chk,now()+interval '1 hour');
  ev:=jsonb_build_object('id','evt_'||gen_random_uuid(),'event','PAYMENT_CONFIRMED',
    'payment',jsonb_build_object('id',pagamento,'subscription',assinatura,'customer',cliente,
      'value',39.90,'dueDate',current_date,'billingType','CREDIT_CARD'));
  if public.billing_processar_webhook_v1(ev,chk)<>'processed' then
    raise exception 'Pagamento Business nao processado'; end if;
  select fim_em into antes from public.assinaturas_usuario where usuario_id=u
    and plano='BUSINESS' and origem='ASAAS';
  if antes is null or antes<=now() or
    (select franquia_ia from public.assinaturas_usuario where usuario_id=u)<>20 then
    raise exception 'Checkout Business nao ativou Business'; end if;
  if public.billing_processar_webhook_v1(ev,chk)<>'duplicate' then
    raise exception 'Evento Business duplicado'; end if;
  if (select fim_em from public.assinaturas_usuario where usuario_id=u)<>antes then
    raise exception 'Duplicata Business estendeu periodo'; end if;
  if (public.billing_reservar_checkout_v1(u,'PRO',3990,null)->>'state') is distinct from 'paid_active' then
    raise exception 'Business ativo permitiu Pro concorrente'; end if;
  insert into public.billing_subscriptions(usuario_id,billing_customer_id,plan_code,
    gateway_subscription_id,status_local,valor_centavos,paid_until)
    values(u,c,'PRO',sub_antiga,'canceled',3990,now()+interval '10 days') returning id into antigo;
  insert into public.billing_payments(billing_subscription_id,gateway_payment_id,status,
    valor_centavos,vencimento,periodo_fim,confirmado_em)
    values(antigo,pay_antigo,'PAYMENT_CONFIRMED',3990,current_date,
      now()+interval '10 days',now());
  ev:=jsonb_build_object('id','evt_'||gen_random_uuid(),'event','PAYMENT_REFUNDED',
    'payment',jsonb_build_object('id',pay_antigo,'subscription',sub_antiga,'customer',cliente,
      'value',39.90,'dueDate',current_date));
  if public.billing_processar_webhook_v1(ev)<>'processed' then
    raise exception 'Estorno antigo nao foi processado'; end if;
  if (select plano from public.assinaturas_usuario where usuario_id=u)
      is distinct from 'BUSINESS' then
    raise exception 'Estorno antigo alterou Business'; end if;
  ev:=jsonb_build_object('id','evt_'||gen_random_uuid(),'event','SUBSCRIPTION_INACTIVATED',
    'subscription',jsonb_build_object('id',assinatura,'customer',cliente));
  if public.billing_processar_webhook_v1(ev)<>'processed' then
    raise exception 'Cancelamento Business nao foi processado'; end if;
  if (select status_local from public.billing_subscriptions where id=s)
      is distinct from 'canceled' then
    raise exception 'Cancelamento Business nao marcou assinatura canceled'; end if;
  if (select fim_em from public.assinaturas_usuario where usuario_id=u)
      is distinct from antes then
    raise exception 'Cancelamento nao preservou periodo Business pago'; end if;
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
  set local role authenticated;
  if public.plano_atual_v1()<>'BUSINESS' or public.plano_limite_perfis_v1() is not null
    or not public.plano_historico_visivel_v1('BUSINESS','encerrada',now()-interval '60 days',current_date-60) then
    raise exception 'Entitlements Business nao foram projetados'; end if;
  reset role;
end $business$;

do $rls$
declare a uuid; b uuid; estado jsonb;
begin
  select f.a,f.b into a,b from billing_fixture f;
  if has_table_privilege('authenticated','public.billing_subscriptions','SELECT') or
    has_table_privilege('authenticated','public.billing_subscriptions','UPDATE') or
    has_function_privilege('authenticated','public.billing_reservar_checkout_v1(uuid,text,integer,integer)','EXECUTE') or
    has_function_privilege('authenticated','public.billing_processar_webhook_v1(jsonb,text)','EXECUTE') or
    has_function_privilege('authenticated','public.billing_evento_processado_v1(text)','EXECUTE')
    then raise exception 'Billing exposto ao cliente'; end if;
  update public.assinaturas_usuario set fim_em=now()-interval '1 second' where usuario_id=b;
  perform set_config('request.jwt.claim.sub',b::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
  set local role authenticated;
  estado:=public.billing_estado_atual_v1();
  if estado<>'{}'::jsonb then raise exception 'Usuario B viu assinatura A'; end if;
  if public.plano_atual_v1()<>'FREE' then raise exception 'Plano vencido nao voltou a Free'; end if;
  reset role;
  raise notice 'Asaas billing SQL: eventos, renovacao, duplicidade, RLS e fallback Free OK';
end $rls$;
rollback;
