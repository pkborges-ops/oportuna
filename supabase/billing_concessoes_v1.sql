-- FINANCEIRO, somente local nesta etapa. Requer asaas_assinaturas_v1.sql atualizada.
-- Nao instala tabelas/consumo de IA, nao chama Asaas nem faz backfill de creditos.
begin;
set local lock_timeout='5s';

alter table public.billing_subscriptions add column if not exists cobranca_ancora date;
update public.billing_subscriptions
  set cobranca_ancora=(criado_em at time zone 'America/Sao_Paulo')::date
  where cobranca_ancora is null and isfinite(criado_em);
alter table public.billing_subscriptions alter column cobranca_ancora set not null;

alter table public.billing_payments
  add column if not exists termos_contratados jsonb,
  add column if not exists termos_origem text check (termos_origem in ('CONTRACT','LEGACY')),
  add column if not exists periodo_inicio timestamptz;

create table if not exists public.billing_concessoes (
  id uuid primary key default gen_random_uuid(),
  ambiente text not null check (ambiente in ('sandbox','production')),
  usuario_id uuid not null references auth.users(id) on delete restrict,
  assinatura_id uuid references public.billing_subscriptions(id) on delete restrict,
  pagamento_id uuid references public.billing_payments(id) on delete restrict,
  origem text not null check (origem in ('PAYMENT','ADMIN')),
  referencia_admin uuid,
  justificativa text,
  autor text not null,
  plano text not null check (plano in ('PRO','BUSINESS')),
  franquia integer check (franquia>0),
  valor_centavos integer check (valor_centavos>0),
  inicio timestamptz not null check (isfinite(inicio)),
  fim timestamptz not null check (isfinite(fim)),
  estado text not null check (estado in ('AUTHORIZED','REVIEW','REVOKED')),
  revisao bigint not null default 1 check (revisao>0),
  motivo_estado text not null check (length(motivo_estado) between 1 and 1000),
  criado_em timestamptz not null default clock_timestamp(),
  atualizado_em timestamptz not null default clock_timestamp(),
  revogado_em timestamptz,
  unique(ambiente,pagamento_id),
  unique(ambiente,referencia_admin),
  check (fim>inicio),
  check (estado<>'AUTHORIZED' or franquia is not null),
  check ((estado='REVOKED')=(revogado_em is not null)),
  check ((origem='PAYMENT' and pagamento_id is not null and assinatura_id is not null
    and referencia_admin is null and valor_centavos is not null)
    or (origem='ADMIN' and pagamento_id is null and assinatura_id is null
      and referencia_admin is not null and justificativa is not null
      and length(trim(justificativa)) between 1 and 1000))
);
create index if not exists billing_concessoes_usuario_periodo_idx
  on public.billing_concessoes(usuario_id,inicio,fim) where estado='AUTHORIZED';

create table if not exists public.billing_concessoes_revisoes (
  concessao_id uuid not null references public.billing_concessoes(id) on delete restrict,
  revisao bigint not null,
  estado text not null,
  motivo text not null,
  registrado_em timestamptz not null default clock_timestamp(),
  primary key(concessao_id,revisao)
);
create table if not exists public.billing_concessoes_entregas (
  id uuid primary key default gen_random_uuid(),
  concessao_id uuid not null,
  revisao bigint not null,
  ambiente text not null check (ambiente in ('sandbox','production')),
  estado_concessao text not null,
  status text not null default 'pending' check (status in ('pending','processing','delivered','superseded')),
  tentativas integer not null default 0,
  token uuid,
  lease_ate timestamptz,
  disponivel_em timestamptz not null default clock_timestamp(),
  entregue_em timestamptz,
  ultimo_erro text,
  criado_em timestamptz not null default clock_timestamp(),
  unique(concessao_id,revisao),
  foreign key(concessao_id,revisao) references public.billing_concessoes_revisoes(concessao_id,revisao)
);
create index if not exists billing_concessoes_pendentes_idx
  on public.billing_concessoes_entregas(disponivel_em,criado_em)
  where status in ('pending','processing');

alter table public.billing_concessoes enable row level security;
alter table public.billing_concessoes_revisoes enable row level security;
alter table public.billing_concessoes_entregas enable row level security;
revoke all on public.billing_concessoes,public.billing_concessoes_revisoes,
  public.billing_concessoes_entregas from public,anon,authenticated,service_role;
grant select on public.billing_concessoes,public.billing_concessoes_revisoes,
  public.billing_concessoes_entregas to service_role;
-- Pagamentos so sao escritos pelas RPCs financeiras SECURITY DEFINER existentes.
revoke insert,update,delete,truncate on public.billing_payments from service_role;

create or replace function public.billing_periodo_financeiro_v1(p_ancora date,p_vencimento date)
returns table(inicio timestamptz,fim timestamptz,alinhado boolean)
language sql immutable strict set search_path=pg_catalog as $$
  with meses as (
    select date_trunc('month',p_vencimento::timestamp)::date as mes,
      extract(day from p_ancora)::integer as dia
  ), limites as (
    select mes, (mes+interval '1 month')::date as seguinte, dia from meses
  ), datas as (
    select mes+least(dia,extract(day from mes+interval '1 month - 1 day')::integer)-1 as inicio,
      seguinte+least(dia,extract(day from seguinte+interval '1 month - 1 day')::integer)-1 as fim
    from limites
  ) select inicio::timestamp at time zone 'America/Sao_Paulo',
    fim::timestamp at time zone 'America/Sao_Paulo',p_vencimento=inicio from datas;
$$;
revoke all on function public.billing_periodo_financeiro_v1(date,date) from public,anon,authenticated,service_role;

create or replace function public.billing_proteger_contrato_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if tg_op='INSERT' then
    new.cobranca_ancora:=(new.criado_em at time zone 'America/Sao_Paulo')::date;
  elsif row(new.usuario_id,new.billing_customer_id,new.plan_code,new.valor_centavos,
      new.franquia_ia,new.ciclo,new.cobranca_ancora) is distinct from
    row(old.usuario_id,old.billing_customer_id,old.plan_code,old.valor_centavos,
      old.franquia_ia,old.ciclo,old.cobranca_ancora)
    and exists(select 1 from public.billing_payments where billing_subscription_id=old.id) then
    raise exception 'Contrato financeiro registrado e imutavel' using errcode='23514';
  end if;
  return new;
end; $$;
drop trigger if exists billing_proteger_contrato on public.billing_subscriptions;
create trigger billing_proteger_contrato before insert or update on public.billing_subscriptions
  for each row execute function public.billing_proteger_contrato_v1();

create or replace function public.billing_fixar_termos_pagamento_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare s public.billing_subscriptions%rowtype; periodo record;
begin
  if tg_op='UPDATE' then
    if row(new.billing_subscription_id,new.gateway_payment_id,new.valor_centavos) is distinct from
      row(old.billing_subscription_id,old.gateway_payment_id,old.valor_centavos)
      or (old.vencimento is not null and new.vencimento is distinct from old.vencimento)
      or (old.termos_contratados is not null and
        row(new.termos_contratados,new.termos_origem) is distinct from row(old.termos_contratados,old.termos_origem))
      or (old.confirmado_em is not null and
        row(new.confirmado_em,new.periodo_inicio,new.periodo_fim) is distinct from
        row(old.confirmado_em,old.periodo_inicio,old.periodo_fim))
      or (old.estornado_em is not null and new.estornado_em is distinct from old.estornado_em) then
      raise exception 'Pagamento financeiro registrado e imutavel' using errcode='23514';
    end if;
  end if;
  if tg_op='INSERT' or new.termos_contratados is null then
    select * into strict s from public.billing_subscriptions where id=new.billing_subscription_id for update;
    new.termos_contratados:=jsonb_build_object('versao',1,'ambiente',s.ambiente,'usuario_id',s.usuario_id,
      'assinatura_id',s.id,'plano',s.plan_code,'franquia',s.franquia_ia,'ciclo',s.ciclo,
      'valor_centavos',s.valor_centavos,'ancora',s.cobranca_ancora);
    new.termos_origem:=case when tg_op='INSERT' then 'CONTRACT' else 'LEGACY' end;
  end if;
  if new.vencimento is not null and new.confirmado_em is not null
      and (tg_op='INSERT' or old.confirmado_em is null) then
    select * into periodo from public.billing_periodo_financeiro_v1(
      (new.termos_contratados->>'ancora')::date,new.vencimento);
    new.periodo_inicio:=periodo.inicio;
    new.periodo_fim:=periodo.fim;
  end if;
  return new;
end; $$;
drop trigger if exists billing_fixar_termos_pagamento on public.billing_payments;
create trigger billing_fixar_termos_pagamento before insert or update on public.billing_payments
  for each row execute function public.billing_fixar_termos_pagamento_v1();

create or replace function public.billing_proteger_concessao_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if tg_op='DELETE' then raise exception 'Historico financeiro nao pode ser apagado'; end if;
  if tg_op='INSERT' then
    perform public.billing_verificar_ambiente_v1(new.ambiente);
    if new.revisao<>1 then raise exception 'Revisao inicial invalida'; end if;
  else
    if (to_jsonb(new)-array['estado','revisao','motivo_estado','revogado_em','atualizado_em']) is distinct from
      (to_jsonb(old)-array['estado','revisao','motivo_estado','revogado_em','atualizado_em'])
      or old.estado='REVOKED' or new.estado<>'REVOKED' or new.revisao<>old.revisao+1 then
      raise exception 'Concessao financeira imutavel ou transicao invalida' using errcode='23514';
    end if;
    new.atualizado_em:=clock_timestamp();
  end if;
  return new;
end; $$;
drop trigger if exists billing_proteger_concessao on public.billing_concessoes;
create trigger billing_proteger_concessao before insert or update or delete on public.billing_concessoes
  for each row execute function public.billing_proteger_concessao_v1();

create or replace function public.billing_enfileirar_concessao_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
  insert into public.billing_concessoes_revisoes(concessao_id,revisao,estado,motivo)
    values(new.id,new.revisao,new.estado,new.motivo_estado);
  update public.billing_concessoes_entregas set status='superseded',token=null,lease_ate=null
    where concessao_id=new.id and revisao<new.revisao and status in ('pending','processing');
  insert into public.billing_concessoes_entregas(concessao_id,revisao,ambiente,estado_concessao)
    values(new.id,new.revisao,new.ambiente,new.estado);
  return new;
end; $$;
drop trigger if exists billing_enfileirar_concessao on public.billing_concessoes;
create trigger billing_enfileirar_concessao after insert or update on public.billing_concessoes
  for each row execute function public.billing_enfileirar_concessao_v1();

create or replace function public.billing_sincronizar_concessao_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare t jsonb:=new.termos_contratados; periodo record; g public.billing_concessoes%rowtype;
  usuario uuid; situacao text; motivo text;
begin
  if (new.confirmado_em is null and new.estornado_em is null) or new.vencimento is null then return new; end if;
  usuario:=(t->>'usuario_id')::uuid;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(usuario::text,7107));
  select * into g from public.billing_concessoes where pagamento_id=new.id for update;
  if found then
    if new.estornado_em is not null and g.estado<>'REVOKED' then
      update public.billing_concessoes set estado='REVOKED',revisao=revisao+1,
        motivo_estado=new.status,revogado_em=new.estornado_em where id=g.id;
    end if;
    return new;
  end if;
  select * into periodo from public.billing_periodo_financeiro_v1((t->>'ancora')::date,new.vencimento);
  situacao:='AUTHORIZED'; motivo:='PAYMENT_CONFIRMED';
  if new.estornado_em is not null then situacao:='REVOKED'; motivo:=new.status;
  elsif new.termos_origem<>'CONTRACT' then situacao:='REVIEW'; motivo:='LEGACY_TERMS_UNVERIFIED';
  elsif t->>'franquia' is null then situacao:='REVIEW'; motivo:='MISSING_QUOTA';
  elsif not periodo.alinhado then situacao:='REVIEW'; motivo:='DUE_DATE_CHANGED';
  elsif exists(select 1 from public.billing_concessoes c where c.usuario_id=usuario
    and c.estado='AUTHORIZED' and c.inicio<periodo.fim and c.fim>periodo.inicio) then
    situacao:='REVIEW'; motivo:='OVERLAPPING_PERIOD';
  end if;
  insert into public.billing_concessoes(ambiente,usuario_id,assinatura_id,pagamento_id,origem,
    autor,plano,franquia,valor_centavos,inicio,fim,estado,motivo_estado,revogado_em)
  values(t->>'ambiente',usuario,new.billing_subscription_id,new.id,'PAYMENT','billing',
    t->>'plano',(t->>'franquia')::integer,new.valor_centavos,periodo.inicio,periodo.fim,
    situacao,motivo,new.estornado_em);
  return new;
end; $$;
drop trigger if exists billing_sincronizar_concessao on public.billing_payments;
create trigger billing_sincronizar_concessao after insert or update on public.billing_payments
  for each row execute function public.billing_sincronizar_concessao_v1();

create or replace function public.billing_concessao_envelope_v1(p_id uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
  select jsonb_build_object('contrato_versao',1,'concessao_id',id,'ambiente',ambiente,
    'usuario_id',usuario_id,'assinatura_id',assinatura_id,'pagamento_id',pagamento_id,
    'origem',origem,'plano',plano,'franquia',franquia,'inicio',inicio,'fim',fim,
    'estado',estado,'revisao',revisao)
  from public.billing_concessoes where id=p_id;
$$;

create or replace function public.billing_concessao_autorizada_v1(
  p_ambiente text,p_usuario uuid,p_concessao uuid,p_revisao bigint) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare g public.billing_concessoes%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock_shared(7105);
  perform public.billing_verificar_ambiente_v1(p_ambiente);
  select * into g from public.billing_concessoes where id=p_concessao for share;
  return coalesce(g.ambiente=p_ambiente and g.usuario_id=p_usuario and g.revisao=p_revisao
    and g.estado='AUTHORIZED' and g.inicio<=clock_timestamp() and clock_timestamp()<g.fim,false);
end; $$;

create or replace function public.billing_concessoes_reservar_entregas_v1(p_ambiente text,p_limite integer default 20)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare resultado jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock_shared(7105);
  perform public.billing_verificar_ambiente_v1(p_ambiente);
  if p_limite is null or p_limite<1 or p_limite>100 then raise exception 'Limite invalido'; end if;
  with lote as (
    select e.id from public.billing_concessoes_entregas e
      join public.billing_concessoes g on g.id=e.concessao_id and g.revisao=e.revisao
    where e.ambiente=p_ambiente and e.disponivel_em<=clock_timestamp()
      and (e.status='pending' or (e.status='processing' and e.lease_ate<=clock_timestamp()))
    order by (e.estado_concessao='REVOKED') desc,e.criado_em,e.id
    limit p_limite for update of e skip locked
  ), reservadas as (
    update public.billing_concessoes_entregas e set status='processing',token=gen_random_uuid(),
      lease_ate=clock_timestamp()+interval '60 seconds',tentativas=tentativas+1
    from lote where e.id=lote.id returning e.id,e.token
  ) select coalesce(jsonb_agg(jsonb_build_object('entrega_id',id,'token',token)),'[]'::jsonb)
    into resultado from reservadas;
  return resultado;
end; $$;

create or replace function public.billing_concessoes_entregar_v1(p_ambiente text,p_entrega uuid,p_token uuid)
returns text language plpgsql security definer set search_path=pg_catalog as $$
declare entrega public.billing_concessoes_entregas%rowtype; g public.billing_concessoes%rowtype;
  gid uuid; aceito boolean; consumidor regprocedure;
begin
  perform pg_catalog.pg_advisory_xact_lock_shared(7105);
  perform public.billing_verificar_ambiente_v1(p_ambiente);
  select concessao_id into gid from public.billing_concessoes_entregas where id=p_entrega and ambiente=p_ambiente;
  if not found then return 'not_found'; end if;
  -- Mesma ordem da revogacao: concessao, depois entrega. Lock cobre o consumidor.
  select * into strict g from public.billing_concessoes where id=gid for update;
  select * into strict entrega from public.billing_concessoes_entregas where id=p_entrega for update;
  if entrega.revisao<>g.revisao or entrega.status='superseded' then return 'stale'; end if;
  if entrega.status='delivered' then return 'duplicate'; end if;
  if entrega.status<>'processing' or p_token is null or entrega.token is distinct from p_token
    or entrega.lease_ate is null or entrega.lease_ate<=clock_timestamp() then return 'lease_lost'; end if;
  consumidor:=to_regprocedure('public.ia_receber_concessao_financeira_v1(jsonb)');
  if consumidor is null then
    update public.billing_concessoes_entregas set status='pending',token=null,lease_ate=null,
      disponivel_em=clock_timestamp()+interval '1 minute',ultimo_erro='CONSUMER_NOT_INSTALLED' where id=p_entrega;
    return 'pending';
  end if;
  -- Nao executar como owner financeiro um hook criado por role nao confiavel.
  if not exists(select 1 from pg_proc where oid=consumidor and proowner=current_user::regrole
    and prorettype='boolean'::regtype and not proretset) then
    update public.billing_concessoes_entregas set status='pending',token=null,lease_ate=null,
      disponivel_em=clock_timestamp()+interval '1 minute',ultimo_erro='CONSUMER_INCOMPATIBLE' where id=p_entrega;
    return 'pending';
  end if;
  begin
    -- Hook SQL fixo; instalado pela frente IA. Sem rede e na MESMA transacao.
    execute 'select public.ia_receber_concessao_financeira_v1($1)'
      into aceito using public.billing_concessao_envelope_v1(g.id);
    if aceito is distinct from true then raise exception 'Consumidor nao confirmou'; end if;
    update public.billing_concessoes_entregas set status='delivered',entregue_em=clock_timestamp(),
      token=null,lease_ate=null,ultimo_erro=null where id=p_entrega;
    return 'delivered';
  exception when others then
    update public.billing_concessoes_entregas set status='pending',token=null,lease_ate=null,
      disponivel_em=clock_timestamp()+interval '1 minute',ultimo_erro='SQLSTATE '||sqlstate where id=p_entrega;
    return 'retry';
  end;
end; $$;

-- Administracao separada: nenhum pagamento ou assinatura Asaas e inventado.
create or replace function public.billing_conceder_administrativa_v1(p_ambiente text,p_referencia uuid,
  p_usuario uuid,p_plano text,p_franquia integer,p_inicio timestamptz,p_fim timestamptz,p_justificativa text)
returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare g public.billing_concessoes%rowtype; resultado uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock_shared(7105);
  perform public.billing_verificar_ambiente_v1(p_ambiente);
  if p_referencia is null or p_usuario is null or p_plano not in ('PRO','BUSINESS') or p_plano is null
    or p_franquia is null or p_franquia<1 or not coalesce(isfinite(p_inicio) and isfinite(p_fim) and p_fim>p_inicio,false)
    or not coalesce(length(trim(p_justificativa)) between 1 and 1000,false) then
    raise exception 'Concessao administrativa incompleta'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_usuario::text,7107));
  select * into g from public.billing_concessoes where ambiente=p_ambiente and referencia_admin=p_referencia;
  if found then
    if row(g.usuario_id,g.plano,g.franquia,g.inicio,g.fim,g.justificativa) is distinct from
      row(p_usuario,p_plano,p_franquia,p_inicio,p_fim,trim(p_justificativa)) then
      raise exception 'Referencia administrativa ja utilizada com outros termos'; end if;
    return g.id;
  end if;
  if exists(select 1 from public.billing_concessoes where usuario_id=p_usuario and estado='AUTHORIZED'
    and inicio<p_fim and fim>p_inicio) then raise exception 'Periodo administrativo sobreposto'; end if;
  insert into public.billing_concessoes(ambiente,usuario_id,origem,referencia_admin,justificativa,
    autor,plano,franquia,inicio,fim,estado,motivo_estado)
    values(p_ambiente,p_usuario,'ADMIN',p_referencia,trim(p_justificativa),session_user,
      p_plano,p_franquia,p_inicio,p_fim,'AUTHORIZED','ADMIN_GRANTED') returning id into resultado;
  return resultado;
end; $$;

create or replace function public.billing_revogar_administrativa_v1(p_ambiente text,p_concessao uuid,p_justificativa text)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare g public.billing_concessoes%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock_shared(7105);
  perform public.billing_verificar_ambiente_v1(p_ambiente);
  if not coalesce(length(trim(p_justificativa)) between 1 and 990,false) then raise exception 'Justificativa ausente'; end if;
  select * into strict g from public.billing_concessoes where id=p_concessao and ambiente=p_ambiente;
  if g.origem<>'ADMIN' then raise exception 'Revogacao financeira exige evento financeiro'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(g.usuario_id::text,7107));
  update public.billing_concessoes set estado='REVOKED',revisao=revisao+1,
    motivo_estado='ADMIN: '||trim(p_justificativa),revogado_em=clock_timestamp()
    where id=p_concessao and estado<>'REVOKED';
end; $$;

-- Protege tambem bancos que tenham apenas concessoes administrativas.
create or replace function public.billing_proteger_ambiente_concessoes_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(7105);
  if new.ambiente<>old.ambiente and exists(select 1 from public.billing_concessoes) then
    raise exception 'Ambiente financeiro imutavel com concessoes' using errcode='42501'; end if;
  return new;
end; $$;
drop trigger if exists billing_proteger_ambiente_concessoes on public.billing_configuracao;
create trigger billing_proteger_ambiente_concessoes before update on public.billing_configuracao
  for each row execute function public.billing_proteger_ambiente_concessoes_v1();

revoke all on function public.billing_proteger_contrato_v1(),public.billing_fixar_termos_pagamento_v1(),
  public.billing_proteger_concessao_v1(),public.billing_enfileirar_concessao_v1(),
  public.billing_sincronizar_concessao_v1(),public.billing_concessao_envelope_v1(uuid),
  public.billing_proteger_ambiente_concessoes_v1(),
  public.billing_concessao_autorizada_v1(text,uuid,uuid,bigint),
  public.billing_concessoes_reservar_entregas_v1(text,integer),
  public.billing_concessoes_entregar_v1(text,uuid,uuid),
  public.billing_conceder_administrativa_v1(text,uuid,uuid,text,integer,timestamptz,timestamptz,text),
  public.billing_revogar_administrativa_v1(text,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.billing_concessao_autorizada_v1(text,uuid,uuid,bigint),
  public.billing_concessoes_reservar_entregas_v1(text,integer),
  public.billing_concessoes_entregar_v1(text,uuid,uuid) to service_role;
commit;
