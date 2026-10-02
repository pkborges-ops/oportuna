-- MANUAL: aplicar somente em homologacao, apos planos_e_permissoes_v1.sql.
-- Sandbox Asaas; nao executar em producao nesta etapa.
begin;
set local lock_timeout = '5s';

-- A migration antiga permanece intacta; ampliar a projecao e seus guardas.
alter table public.assinaturas_usuario drop constraint assinaturas_usuario_plano_check;
alter table public.assinaturas_usuario add constraint assinaturas_usuario_plano_check
  check (plano in ('FREE','PRO','BUSINESS'));

alter table public.assinaturas_usuario
  add column origem text not null default 'SYSTEM'
  check (origem in ('SYSTEM','MANUAL','ASAAS'));
-- Concessoes Pro anteriores a esta integracao foram manuais e nao podem ser
-- substituidas por um webhook de outra origem.
update public.assinaturas_usuario set origem='MANUAL' where plano in ('PRO','BUSINESS');

create or replace function public.plano_atual_v1() returns text
language plpgsql stable security invoker set search_path=pg_catalog as $$
declare codigo text;
begin
  if auth.uid() is null then raise exception 'Não autorizado' using errcode='42501'; end if;
  select case when plano in ('PRO','BUSINESS') and status in ('active','trial')
    and (fim_em is null or fim_em>now()) then plano else 'FREE' end
    into codigo from public.assinaturas_usuario where usuario_id=auth.uid();
  return coalesce(codigo,'FREE');
end; $$;

-- Limite comercial Business pendente: NULL = sem teto provisório de perfis.
-- Vagas de equipe não são liberadas nesta versão.
create table public.planos_limites_perfis (
  plano text primary key check (plano in ('FREE','PRO','BUSINESS')),
  max_profiles integer check (max_profiles is null or max_profiles>0),
  check (plano<>'BUSINESS' or max_profiles is null or max_profiles>3)
);
insert into public.planos_limites_perfis(plano,max_profiles)
  values('FREE',1),('PRO',3),('BUSINESS',null);
alter table public.planos_limites_perfis enable row level security;
revoke all on public.planos_limites_perfis from public,anon,authenticated;
grant all on public.planos_limites_perfis to service_role;

create function public.plano_limite_perfis_v1() returns integer
language sql stable security definer set search_path=pg_catalog as $$
  select max_profiles from public.planos_limites_perfis
  where plano=public.plano_atual_v1();
$$;
revoke all on function public.plano_limite_perfis_v1() from public,anon;
grant execute on function public.plano_limite_perfis_v1() to authenticated;

create function public.plano_pago_v1(p_plano text) returns boolean
language sql immutable security invoker set search_path=pg_catalog as $$
  select p_plano in ('PRO','BUSINESS');
$$;
revoke all on function public.plano_pago_v1(text) from public,anon;
grant execute on function public.plano_pago_v1(text) to authenticated;

create or replace function public.plano_limitar_inclusao_v1() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
declare quantidade integer; limite integer;
begin
  if auth.uid() is null or new.usuario_id<>auth.uid() then
    raise exception 'Não autorizado' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.usuario_id::text,7101));
  if tg_table_name='perfis_empresa' then
    limite := public.plano_limite_perfis_v1();
    if limite is null then return new; end if;
    select count(*) into quantidade from public.perfis_empresa where usuario_id=new.usuario_id;
    if quantidade>=limite then raise exception 'Limite de perfis do plano atingido' using errcode='P0001'; end if;
  elsif tg_table_name='oportunidades_favoritos' then
    if exists(select 1 from public.oportunidades_favoritos
      where usuario_id=new.usuario_id and oportunidade_id=new.oportunidade_id) then return new; end if;
    if public.plano_pago_v1(public.plano_atual_v1()) then return new; end if;
    select count(*) into quantidade from public.oportunidades_favoritos where usuario_id=new.usuario_id;
    if quantidade>=5 then raise exception 'Limite de favoritos do plano atingido' using errcode='P0001'; end if;
  elsif tg_table_name='analises_oportunidades' then
    if not exists(select 1 from public.perfis_empresa where id=new.perfil_id and usuario_id=new.usuario_id) then
      raise exception 'Perfil indisponível' using errcode='42501';
    end if;
    limite := public.plano_limite_ia_v1();
    if limite is null then return new; end if;
    select count(*) into quantidade from public.analises_ia_consumos where usuario_id=new.usuario_id;
    if quantidade>=limite then raise exception 'Limite de análises do plano atingido' using errcode='P0001'; end if;
  end if;
  return new;
end; $$;

create or replace function public.plano_verificar_total_v1() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
declare quantidade integer; limite integer;
begin
  if tg_table_name='perfis_empresa' then
    limite := public.plano_limite_perfis_v1();
    if limite is null then return new; end if;
    select count(*) into quantidade from public.perfis_empresa where usuario_id=new.usuario_id;
  elsif tg_table_name='oportunidades_favoritos' then
    if public.plano_pago_v1(public.plano_atual_v1()) then return new; end if;
    limite := 5;
    select count(*) into quantidade from public.oportunidades_favoritos where usuario_id=new.usuario_id;
  else
    limite := public.plano_limite_ia_v1();
    if limite is null then return new; end if;
    select count(*) into quantidade from public.analises_ia_consumos where usuario_id=new.usuario_id;
  end if;
  if quantidade>limite then raise exception 'Limite do plano atingido' using errcode='P0001'; end if;
  return new;
end; $$;

create or replace function public.plano_validar_alerta_v1() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if auth.uid() is not null and new.ativo and not public.plano_pago_v1(public.plano_atual_v1()) then
    raise exception 'Alertas disponíveis nos planos pagos' using errcode='P0001';
  end if;
  return new;
end; $$;

create or replace function public.plano_tem_score_v1(p_perfil_id uuid,p_oportunidade_id uuid) returns boolean
language sql stable security invoker set search_path=pg_catalog as $$
  select public.plano_pago_v1(public.plano_atual_v1()) or exists (
    select 1 from public.score_desbloqueios d where d.usuario_id=auth.uid()
    and d.perfil_id=p_perfil_id and d.oportunidade_id=p_oportunidade_id
    and d.dia=public.plano_dia_v1()
  );
$$;

create or replace function public.plano_historico_visivel_v1(
  p_plano text,p_status text,p_prazo timestamptz,p_publicacao date
) returns boolean language sql stable security invoker set search_path=pg_catalog as $$
  select public.plano_pago_v1(p_plano) or case
    when p_status='encerrada' or (coalesce(isfinite(p_prazo),false) and p_prazo<=now()) then
      coalesce(case when isfinite(p_prazo) then (p_prazo at time zone 'America/Sao_Paulo')::date end,
        case when isfinite(p_publicacao) then p_publicacao end)
        >= (now() at time zone 'America/Sao_Paulo')::date-30
    else true end;
$$;

create or replace function public.desbloquear_score_v1(p_perfil_id uuid,p_oportunidade_id uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare usuario uuid := auth.uid(); usados integer;
begin
  if usuario is null then raise exception 'Não autorizado' using errcode='42501'; end if;
  if not exists(select 1 from public.perfis_empresa where id=p_perfil_id and usuario_id=usuario)
    or not exists(select 1 from public.oportunidades_editais o where o.id=p_oportunidade_id
      and public.plano_historico_visivel_v1(public.plano_atual_v1(),o.status,
        o.participacao_prazo_limite,o.data_publicacao)) then
    raise exception 'Perfil ou oportunidade indisponível' using errcode='42501';
  end if;
  if public.plano_pago_v1(public.plano_atual_v1()) then return true; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(usuario::text,7102));
  if exists(select 1 from public.score_desbloqueios where usuario_id=usuario and perfil_id=p_perfil_id
    and oportunidade_id=p_oportunidade_id and dia=public.plano_dia_v1()) then return true; end if;
  select count(*) into usados from public.score_desbloqueios
    where usuario_id=usuario and dia=public.plano_dia_v1();
  if usados>=3 then return false; end if;
  insert into public.score_desbloqueios(usuario_id,perfil_id,oportunidade_id,dia)
    values(usuario,p_perfil_id,p_oportunidade_id,public.plano_dia_v1());
  return true;
end; $$;

create table public.billing_customers (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null unique references auth.users(id) on delete cascade,
  gateway text not null default 'ASAAS' check (gateway='ASAAS'),
  ambiente text not null default 'sandbox' check (ambiente='sandbox'),
  gateway_customer_id text unique,
  status_local text not null default 'creating' check (status_local in ('creating','uncertain','ready')),
  lease_ate timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create table public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  billing_customer_id uuid not null references public.billing_customers(id) on delete cascade,
  gateway text not null default 'ASAAS' check (gateway='ASAAS'),
  ambiente text not null default 'sandbox' check (ambiente='sandbox'),
  plan_code text not null check (plan_code in ('PRO','BUSINESS')),
  gateway_checkout_id text unique,
  gateway_checkout_url text,
  gateway_subscription_id text unique,
  status_local text not null check (status_local in
    ('creating','uncertain','checkout_pending','checkout_paid','payment_pending',
     'active','past_due','canceled','expired','review')),
  ciclo text not null default 'MONTHLY' check (ciclo='MONTHLY'),
  valor_centavos integer not null check (valor_centavos>0),
  franquia_ia integer check (franquia_ia is null or franquia_ia>0),
  checkout_expira_em timestamptz,
  proximo_vencimento date,
  paid_until timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index billing_subscription_aberta_usuario_idx
  on public.billing_subscriptions(usuario_id)
  where status_local not in ('canceled','expired');
create index billing_subscription_customer_idx on public.billing_subscriptions(billing_customer_id);

alter table public.assinaturas_usuario
  add column billing_subscription_id uuid references public.billing_subscriptions(id) on delete set null;

create table public.billing_payments (
  id uuid primary key default gen_random_uuid(),
  billing_subscription_id uuid not null references public.billing_subscriptions(id) on delete cascade,
  gateway_payment_id text not null unique,
  status text not null,
  valor_centavos integer not null check (valor_centavos>0),
  vencimento date,
  periodo_fim timestamptz,
  confirmado_em timestamptz,
  recebido_em timestamptz,
  estornado_em timestamptz,
  atualizado_em timestamptz not null default now()
);
create table public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  ambiente text not null default 'sandbox' check (ambiente='sandbox'),
  gateway_event_id text not null,
  tipo text not null,
  status_processamento text not null default 'pending'
    check (status_processamento in ('pending','processed','error')),
  recebido_em timestamptz not null default now(),
  processado_em timestamptz,
  erro text,
  unique (ambiente,gateway_event_id)
);

create function public.billing_evento_processado_v1(p_event_id text) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
  select exists(select 1 from public.billing_webhook_events
    where ambiente='sandbox' and gateway_event_id=p_event_id
      and status_processamento='processed');
$$;

alter table public.billing_customers enable row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.billing_payments enable row level security;
alter table public.billing_webhook_events enable row level security;
revoke all on public.billing_customers,public.billing_subscriptions,
  public.billing_payments,public.billing_webhook_events from public,anon,authenticated;
grant all on public.billing_customers,public.billing_subscriptions,
  public.billing_payments,public.billing_webhook_events to service_role;

-- Expor apenas o estado necessario a pagina /planos, sem IDs do gateway.
create function public.billing_estado_atual_v1() returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
  select case when auth.uid() is null then null else coalesce((
    select jsonb_build_object('status',s.status_local,'plan_code',s.plan_code,'paid_until',s.paid_until,
      'checkout_expira_em',s.checkout_expira_em,
      'tem_checkout',s.gateway_checkout_id is not null,
      'tem_assinatura',s.gateway_subscription_id is not null)
    from public.billing_subscriptions s where s.usuario_id=auth.uid()
    order by s.criado_em desc limit 1
  ),'{}'::jsonb) end;
$$;
revoke all on function public.billing_estado_atual_v1() from public,anon;
grant execute on function public.billing_estado_atual_v1() to authenticated;

-- A reserva no banco antecede toda chamada externa; cliques simultaneos
-- recebem busy e nao executam uma segunda criacao no Asaas.
create function public.billing_reservar_cliente_v1(p_usuario uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare c public.billing_customers%rowtype;
begin
  insert into public.billing_customers(usuario_id,lease_ate)
    values(p_usuario,now()+interval '2 minutes') on conflict (usuario_id) do nothing
    returning * into c;
  if found then return jsonb_build_object('state','claim','id',c.id); end if;
  select * into c from public.billing_customers where usuario_id=p_usuario for update;
  if c.status_local='ready' then
    return jsonb_build_object('state','ready','id',c.id,'customer_id',c.gateway_customer_id);
  end if;
  if c.status_local='creating' and c.lease_ate>now() then
    return jsonb_build_object('state','busy','id',c.id);
  end if;
  update public.billing_customers set status_local='uncertain',atualizado_em=now()
    where id=c.id;
  return jsonb_build_object('state','reconcile','id',c.id);
end; $$;
create function public.billing_salvar_cliente_v1(p_id uuid,p_gateway_id text) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if nullif(p_gateway_id,'') is null then raise exception 'ID de cliente ausente'; end if;
  update public.billing_customers set gateway_customer_id=p_gateway_id,
    status_local='ready',lease_ate=null,atualizado_em=now()
    where id=p_id and (gateway_customer_id is null or gateway_customer_id=p_gateway_id);
  if not found then raise exception 'Reserva de cliente inconsistente'; end if;
end; $$;
create function public.billing_cliente_incerteza_v1(p_id uuid) returns void
language sql security definer set search_path=pg_catalog as $$
  update public.billing_customers set status_local='uncertain',lease_ate=null,
    atualizado_em=now() where id=p_id and status_local='creating';
$$;

create function public.billing_reservar_checkout_v1(
  p_usuario uuid,p_plan_code text,p_valor integer,p_franquia_ia integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare s public.billing_subscriptions%rowtype; c public.billing_customers%rowtype;
begin
  if p_plan_code not in ('PRO','BUSINESS') or p_plan_code is null then
    raise exception 'Plano pago invalido'; end if;
  if p_valor is null or p_valor<=0 then raise exception 'Valor invalido'; end if;
  if (p_franquia_ia is not null and p_franquia_ia<=0) or
    (p_plan_code='BUSINESS' and p_franquia_ia is null) then
    raise exception 'Franquia de IA invalida'; end if;
  select * into c from public.billing_customers where usuario_id=p_usuario and status_local='ready';
  if not found then raise exception 'Cliente nao preparado'; end if;
  if exists(select 1 from public.assinaturas_usuario
    where usuario_id=p_usuario and plano in ('PRO','BUSINESS')
      and status in ('active','trial') and (fim_em is null or fim_em>now())) then
    return jsonb_build_object('state','paid_active');
  end if;
  select * into s from public.billing_subscriptions where usuario_id=p_usuario
    and status_local not in ('canceled','expired') for update;
  if found then
    if s.plan_code<>p_plan_code then
      return jsonb_build_object('state','plan_conflict','id',s.id);
    end if;
    if s.valor_centavos<>p_valor or s.franquia_ia is distinct from p_franquia_ia then
      return jsonb_build_object('state','terms_changed','id',s.id);
    end if;
    if s.status_local='checkout_pending' and s.checkout_expira_em<=now() then
      -- Relogio local nao prova expiracao: o pagamento pode ter ocorrido e
      -- o webhook estar atrasado. Esperar CHECKOUT_EXPIRED ou reconciliacao.
      return jsonb_build_object('state','reconcile','id',s.id);
    elsif s.status_local='checkout_pending' then
      return jsonb_build_object('state','reuse','id',s.id,'url',s.gateway_checkout_url);
    elsif s.status_local='creating' then
      return jsonb_build_object('state','busy','id',s.id);
    elsif s.status_local='uncertain' then
      return jsonb_build_object('state','reconcile','id',s.id);
    else
      return jsonb_build_object('state','already','id',s.id);
    end if;
  end if;
  insert into public.billing_subscriptions(usuario_id,billing_customer_id,plan_code,status_local,
    valor_centavos,franquia_ia)
    values(p_usuario,c.id,p_plan_code,'creating',p_valor,p_franquia_ia) returning * into s;
  return jsonb_build_object('state','claim','id',s.id,'customer_id',c.gateway_customer_id);
end; $$;
create function public.billing_salvar_checkout_v1(
  p_id uuid,p_gateway_id text,p_url text,p_expira_em timestamptz) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if nullif(p_gateway_id,'') is null or nullif(p_url,'') is null then
    raise exception 'Checkout incompleto'; end if;
  update public.billing_subscriptions set gateway_checkout_id=p_gateway_id,
    gateway_checkout_url=p_url,checkout_expira_em=p_expira_em,
    status_local='checkout_pending',atualizado_em=now()
    where id=p_id and status_local='creating';
  if not found then raise exception 'Reserva de checkout inconsistente'; end if;
end; $$;
create function public.billing_checkout_incerteza_v1(p_id uuid) returns void
language sql security definer set search_path=pg_catalog as $$
  update public.billing_subscriptions set status_local='uncertain',atualizado_em=now()
  where id=p_id and status_local='creating';
$$;

-- O servidor usa o ID do checkout armazenado para confirmar no Asaas qual
-- cobranca foi gerada por aquela sessao, antes de vincular a assinatura.
create function public.billing_checkout_pendente_v1(p_gateway_customer_id text) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
  select jsonb_build_object('checkout_id',s.gateway_checkout_id)
  from public.billing_subscriptions s
  join public.billing_customers c on c.id=s.billing_customer_id
  where c.gateway_customer_id=p_gateway_customer_id
    and s.gateway_subscription_id is null
    and s.gateway_checkout_id is not null
    and s.status_local in ('checkout_pending','checkout_paid')
  order by s.criado_em desc limit 1;
$$;

-- Uma unica transacao aplica evento, pagamento e projecao de entitlement.
-- Eventos desconhecidos nao sao ligados por email nem por referencia arbitraria.
create function public.billing_processar_webhook_v1(
  p jsonb,p_checkout_verificado text default null) returns text
language plpgsql security definer set search_path=pg_catalog as $$
declare eid text:=p->>'id'; ev text:=p->>'event';
  s public.billing_subscriptions%rowtype; pay public.billing_payments%rowtype;
  cid text; sid text; pid text; referencia text; valor integer; venc date; periodo timestamptz;
  processado boolean;
begin
  if eid is null or length(eid)>200 or ev is null or length(ev)>100 then
    raise exception 'Evento invalido'; end if;
  insert into public.billing_webhook_events(gateway_event_id,tipo)
    values(eid,ev) on conflict (ambiente,gateway_event_id) do nothing;
  perform 1 from public.billing_webhook_events where ambiente='sandbox'
    and gateway_event_id=eid for update;
  if (select status_processamento='processed' from public.billing_webhook_events
      where ambiente='sandbox' and gateway_event_id=eid) then return 'duplicate'; end if;
  begin
    if ev in ('CHECKOUT_CREATED','CHECKOUT_CANCELED','CHECKOUT_EXPIRED','CHECKOUT_PAID') then
      cid:=p->'checkout'->>'id';
      if cid is null then raise exception 'Checkout sem ID'; end if;
      if ev='CHECKOUT_CREATED' then
        referencia:=p->'checkout'->>'externalReference';
        -- Se o POST criou o checkout mas a resposta se perdeu, o webhook pode
        -- recuperar o ID pela referencia local e pelo cliente esperado.
        if referencia ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          and cid ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
          update public.billing_subscriptions s0 set gateway_checkout_id=cid,
            gateway_checkout_url='https://sandbox.asaas.com/checkoutSession/show/'||cid,
            checkout_expira_em=now()+interval '60 minutes',status_local='checkout_pending',
            atualizado_em=now()
          from public.billing_customers c
          where s0.id=referencia::uuid and s0.billing_customer_id=c.id
            and c.gateway_customer_id=(p->'checkout'->>'customer')
            and s0.gateway_checkout_id is null
            and s0.status_local in ('creating','uncertain');
        end if;
      else
        select * into strict s from public.billing_subscriptions
          where gateway_checkout_id=cid for update;
        if ev='CHECKOUT_PAID' then
          update public.billing_subscriptions set status_local='checkout_paid',atualizado_em=now()
            where id=s.id and status_local='checkout_pending';
        elsif ev in ('CHECKOUT_CANCELED','CHECKOUT_EXPIRED') and
          s.status_local='checkout_pending' then
          update public.billing_subscriptions set status_local=
            case when ev='CHECKOUT_CANCELED' then 'canceled' else 'expired' end,
            atualizado_em=now() where id=s.id;
        end if;
      end if;
    elsif ev in ('SUBSCRIPTION_CREATED','SUBSCRIPTION_UPDATED',
                  'SUBSCRIPTION_INACTIVATED','SUBSCRIPTION_DELETED') then
      sid:=p->'subscription'->>'id'; cid:=p->'subscription'->>'customer';
      select s0.* into s from public.billing_subscriptions s0
        join public.billing_customers c on c.id=s0.billing_customer_id
        where c.gateway_customer_id=cid and s0.gateway_subscription_id=sid
        for update of s0;
      -- Criacao de assinatura nao prova que ela veio do checkout esperado.
      -- O primeiro PAYMENT_CONFIRMED faz o vinculo apos verificacao no Asaas.
      if found then
      update public.billing_subscriptions set
        status_local=case when ev in ('SUBSCRIPTION_INACTIVATED','SUBSCRIPTION_DELETED')
          then 'canceled' when status_local in ('checkout_pending','checkout_paid')
          then 'payment_pending' else status_local end,
        atualizado_em=now() where id=s.id;
      end if;
    elsif ev in ('PAYMENT_CREATED','PAYMENT_UPDATED','PAYMENT_CONFIRMED',
                  'PAYMENT_RECEIVED','PAYMENT_OVERDUE','PAYMENT_CREDIT_CARD_CAPTURE_REFUSED',
                  'PAYMENT_REFUNDED','PAYMENT_CHARGEBACK_REQUESTED') then
      sid:=p->'payment'->>'subscription'; cid:=p->'payment'->>'customer';
      pid:=p->'payment'->>'id';
      if pid is null or sid is null or cid is null or
        p->'payment'->>'value' is null then raise exception 'Pagamento incompleto'; end if;
      valor:=round((p->'payment'->>'value')::numeric*100)::integer;
      select s0.* into s from public.billing_subscriptions s0
        join public.billing_customers c on c.id=s0.billing_customer_id
        where c.gateway_customer_id=cid and
          (s0.gateway_subscription_id=sid or
           (ev='PAYMENT_CONFIRMED' and s0.gateway_subscription_id is null
            and s0.gateway_checkout_id=p_checkout_verificado
            and s0.status_local in ('checkout_pending','checkout_paid')))
        for update of s0;
      if not found then
        if ev='PAYMENT_CONFIRMED' then raise exception 'Checkout nao verificado'; end if;
        -- Outros eventos anteriores ao primeiro pagamento nao concedem acesso.
        update public.billing_webhook_events set status_processamento='processed',
          processado_em=now(),erro=null where ambiente='sandbox' and gateway_event_id=eid;
        return 'processed';
      end if;
      if valor<>s.valor_centavos then raise exception 'Valor nao corresponde'; end if;
      if s.gateway_subscription_id is null then
        update public.billing_subscriptions set gateway_subscription_id=sid,
          status_local='payment_pending',atualizado_em=now() where id=s.id;
      end if;
      insert into public.billing_payments(billing_subscription_id,gateway_payment_id,status,
        valor_centavos,vencimento) values(s.id,pid,ev,valor,
        nullif(p->'payment'->>'dueDate','')::date)
        on conflict (gateway_payment_id) do nothing;
      select * into strict pay from public.billing_payments where gateway_payment_id=pid for update;
      if pay.billing_subscription_id<>s.id then raise exception 'Cobranca nao corresponde'; end if;
      if ev='PAYMENT_CONFIRMED' then
        if p->'payment'->>'billingType'<>'CREDIT_CARD' then
          raise exception 'Meio de pagamento nao esperado'; end if;
        venc:=coalesce(pay.vencimento,nullif(p->'payment'->>'dueDate','')::date);
        if venc is null then raise exception 'Vencimento ausente'; end if;
        -- Periodo comercial em horario de Brasilia, independente do timezone
        -- configurado na sessao do SQL Editor ou no servidor.
        periodo:=(venc + interval '1 month') at time zone 'America/Sao_Paulo';
        if pay.confirmado_em is null and pay.estornado_em is null then
          update public.billing_payments set status=ev,confirmado_em=now(),
            periodo_fim=periodo,atualizado_em=now() where id=pay.id;
          update public.billing_subscriptions set status_local='active',
            paid_until=greatest(coalesce(paid_until,periodo),periodo),
            proximo_vencimento=greatest(
              coalesce(proximo_vencimento,(venc+interval '1 month')::date),
              (venc+interval '1 month')::date),
            atualizado_em=now() where id=s.id and status_local<>'review'
            returning true into processado;
          if processado then
            insert into public.assinaturas_usuario(usuario_id,plano,status,origem,inicio_em,fim_em,
              billing_subscription_id,franquia_ia)
              values(s.usuario_id,s.plan_code,'active','ASAAS',now(),periodo,s.id,s.franquia_ia)
              on conflict (usuario_id) do update set plano=excluded.plano,status='active',origem='ASAAS',
                billing_subscription_id=excluded.billing_subscription_id,
                franquia_ia=case when public.assinaturas_usuario.billing_subscription_id=
                  excluded.billing_subscription_id then public.assinaturas_usuario.franquia_ia
                  else excluded.franquia_ia end,
                fim_em=greatest(coalesce(public.assinaturas_usuario.fim_em,excluded.fim_em),excluded.fim_em)
              where public.assinaturas_usuario.origem<>'MANUAL' and
                (public.assinaturas_usuario.plano='FREE' or
                 public.assinaturas_usuario.status not in ('active','trial') or
                 public.assinaturas_usuario.fim_em<=now() or
                 public.assinaturas_usuario.billing_subscription_id=excluded.billing_subscription_id);
            if not found then raise exception 'Concessao manual protegida'; end if;
          end if;
        end if;
      elsif ev='PAYMENT_RECEIVED' then
        update public.billing_payments set status=ev,recebido_em=now(),atualizado_em=now()
          where id=pay.id and estornado_em is null;
      elsif ev in ('PAYMENT_REFUNDED','PAYMENT_CHARGEBACK_REQUESTED') then
        update public.billing_payments set status=ev,estornado_em=now(),atualizado_em=now()
          where id=pay.id;
        if pay.periodo_fim>now() and s.paid_until<=pay.periodo_fim then
          update public.billing_subscriptions set status_local='review',atualizado_em=now()
            where id=s.id and not exists (
              select 1 from public.billing_subscriptions outro
              where outro.usuario_id=s.usuario_id and outro.id<>s.id
                and outro.status_local not in ('canceled','expired'));
          update public.assinaturas_usuario set plano='FREE',status='canceled',fim_em=now()
            where usuario_id=s.usuario_id and origem='ASAAS' and billing_subscription_id=s.id;
        end if;
      else
        update public.billing_payments set status=ev,atualizado_em=now()
          where id=pay.id and confirmado_em is null and estornado_em is null;
        if ev in ('PAYMENT_OVERDUE','PAYMENT_CREDIT_CARD_CAPTURE_REFUSED')
          and s.status_local='active' and pay.confirmado_em is null then
          update public.billing_subscriptions set status_local='past_due',atualizado_em=now()
            where id=s.id;
        end if;
      end if;
    else
      raise exception 'Tipo de evento nao suportado';
    end if;
    update public.billing_webhook_events set status_processamento='processed',
      processado_em=now(),erro=null where ambiente='sandbox' and gateway_event_id=eid;
    return 'processed';
  exception when others then
    update public.billing_webhook_events set status_processamento='error',
      erro='SQLSTATE '||sqlstate where ambiente='sandbox' and gateway_event_id=eid;
    return 'retry';
  end;
end; $$;

revoke all on function public.billing_reservar_cliente_v1(uuid),
  public.billing_evento_processado_v1(text),
  public.billing_salvar_cliente_v1(uuid,text),
  public.billing_cliente_incerteza_v1(uuid),
  public.billing_reservar_checkout_v1(uuid,text,integer,integer),
  public.billing_salvar_checkout_v1(uuid,text,text,timestamptz),
  public.billing_checkout_incerteza_v1(uuid),
  public.billing_checkout_pendente_v1(text),
  public.billing_processar_webhook_v1(jsonb,text) from public,anon,authenticated;
grant execute on function public.billing_reservar_cliente_v1(uuid),
  public.billing_evento_processado_v1(text),
  public.billing_salvar_cliente_v1(uuid,text),
  public.billing_cliente_incerteza_v1(uuid),
  public.billing_reservar_checkout_v1(uuid,text,integer,integer),
  public.billing_salvar_checkout_v1(uuid,text,text,timestamptz),
  public.billing_checkout_incerteza_v1(uuid),
  public.billing_checkout_pendente_v1(text),
  public.billing_processar_webhook_v1(jsonb,text) to service_role;
commit;
