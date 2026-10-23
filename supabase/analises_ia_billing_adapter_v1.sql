-- Integração IA com o contrato publicado no commit financeiro 183e62e56c65390111744e8e8ce2249cb5cb7949.
-- Não instala billing. Executar como o MESMO owner das funções financeiras e da IA.
begin;
set local lock_timeout='5s';

do $dependencias$
declare f regprocedure;
begin
  if to_regclass('public.ia_resultados_v1') is null
    or not exists(select 1 from information_schema.columns where table_schema='public'
      and table_name='ia_resultados_v1' and column_name='versao_schema')
    or to_regclass('public.billing_concessoes') is null
    or to_regclass('public.billing_concessoes_revisoes') is null then
    raise exception 'Instale IA execucoes v1, conteudo v2 e billing concessoes v1 antes do adaptador';
  end if;
  foreach f in array array[
    to_regprocedure('public.billing_concessao_autorizada_v1(text,uuid,uuid,bigint)'),
    to_regprocedure('public.billing_concessoes_entregar_v1(text,uuid,uuid)'),
    to_regprocedure('public.billing_concessao_envelope_v1(uuid)'),
    to_regprocedure('public.billing_verificar_ambiente_v1(text)'),
    to_regprocedure('public.ia_finalizar_v1(uuid,uuid,uuid,jsonb,jsonb,boolean)')
  ] loop
    if f is null or not exists(select 1 from pg_proc where oid=f and proowner=(select oid from pg_roles where rolname=current_user)) then
      raise exception 'Dependencia ausente ou owner incompativel no adaptador IA' using errcode='42501';
    end if;
  end loop;
end $dependencias$;

-- Tombstones existem mesmo quando REVIEW/REVOKED chega antes de qualquer crédito.
-- Sem FK para tabelas financeiras: a interface é o envelope, validado na origem.
create table public.ia_concessoes_financeiras_v1 (
  concessao_id uuid primary key,
  ambiente text not null check (ambiente in ('sandbox','production')),
  usuario_id uuid not null references auth.users(id) on delete restrict,
  assinatura_id uuid,
  pagamento_id uuid,
  origem text not null check (origem in ('PAYMENT','ADMIN')),
  plano text not null check (plano in ('PRO','BUSINESS')),
  franquia integer check (franquia>0),
  inicio timestamptz not null check (isfinite(inicio)),
  fim timestamptz not null check (isfinite(fim) and fim>inicio),
  estado text not null check (estado in ('AUTHORIZED','REVIEW','REVOKED')),
  revisao bigint not null check (revisao>0),
  ciclo_id uuid unique references public.ia_ciclos_v1(id) on delete restrict,
  atualizado_em timestamptz not null default clock_timestamp(),
  unique(ambiente,pagamento_id),
  check (estado<>'AUTHORIZED' or franquia is not null),
  check ((origem='PAYMENT' and assinatura_id is not null and pagamento_id is not null)
    or (origem='ADMIN' and assinatura_id is null and pagamento_id is null))
);
create index ia_concessoes_usuario_v1 on public.ia_concessoes_financeiras_v1(usuario_id,inicio,fim);
alter table public.ia_concessoes_financeiras_v1 enable row level security;
revoke all on public.ia_concessoes_financeiras_v1 from public,anon,authenticated,service_role;

create function public.ia_receber_concessao_financeira_v1(p_envelope jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare g public.billing_concessoes; anterior public.ia_concessoes_financeiras_v1;
  canonico jsonb; revisao_recebida bigint; estado_recebido text; ciclo uuid;
begin
  if p_envelope is null or jsonb_typeof(p_envelope)<>'object'
    or p_envelope->'contrato_versao' is distinct from '1'::jsonb
    or jsonb_typeof(p_envelope->'revisao') is distinct from 'number'
    or (p_envelope->>'revisao') !~ '^[1-9][0-9]*$' then
    raise exception 'Envelope financeiro invalido' using errcode='22023';
  end if;
  revisao_recebida:=(p_envelope->>'revisao')::bigint;
  estado_recebido:=p_envelope->>'estado';
  -- Ordem global: ambiente, origem financeira, depois advisory/ciclo IA.
  -- Nunca travar assinatura/pagamento a partir deste hook.
  perform pg_advisory_xact_lock_shared(7105);
  perform public.billing_verificar_ambiente_v1(p_envelope->>'ambiente');
  select * into g from public.billing_concessoes
    where id=(p_envelope->>'concessao_id')::uuid for share;
  if not found then raise exception 'Concessao financeira inexistente' using errcode='22023'; end if;
  canonico:=public.billing_concessao_envelope_v1(g.id);
  -- Comparação completa também rejeita propriedades extras, usuário/plano/origem
  -- adulterados, PAYMENT sem vínculos e ADMIN com vínculos inventados.
  if (p_envelope-array['estado','revisao','inicio','fim']) is distinct from
       (canonico-array['estado','revisao','inicio','fim'])
    or jsonb_typeof(p_envelope->'inicio') is distinct from 'string'
    or jsonb_typeof(p_envelope->'fim') is distinct from 'string'
    or (p_envelope->>'inicio')::timestamptz is distinct from g.inicio
    or (p_envelope->>'fim')::timestamptz is distinct from g.fim
    or not exists(select 1 from public.billing_concessoes_revisoes
      where concessao_id=g.id and revisao=revisao_recebida and estado=estado_recebido) then
    raise exception 'Termos ou revisao financeira divergentes' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(g.usuario_id::text,7101));
  select * into anterior from public.ia_concessoes_financeiras_v1 where concessao_id=g.id for update;
  if found then
    if row(anterior.ambiente,anterior.usuario_id,anterior.assinatura_id,anterior.pagamento_id,
        anterior.origem,anterior.plano,anterior.franquia,anterior.inicio,anterior.fim)
      is distinct from row(g.ambiente,g.usuario_id,g.assinatura_id,g.pagamento_id,
        g.origem,g.plano,g.franquia,g.inicio,g.fim) then
      raise exception 'Termos imutaveis da IA divergentes' using errcode='23514';
    end if;
    if revisao_recebida<=anterior.revisao then
      if revisao_recebida=anterior.revisao and estado_recebido<>anterior.estado then
        raise exception 'Estado divergente para a mesma revisao';
      end if;
      return true;
    end if;
    if anterior.estado='REVOKED' or estado_recebido<>'REVOKED' then
      raise exception 'Transicao financeira invalida';
    end if;
  end if;
  -- Entrega antiga não cria saldo quando a origem já avançou/revogou.
  -- O outbox oficial já a marca superseded; ACK aqui não forja revisão nova.
  if revisao_recebida<g.revisao then return true; end if;
  ciclo:=anterior.ciclo_id;
  if estado_recebido='AUTHORIZED' and ciclo is null then
    -- Falha fechada: saldos pagos anteriores sem vínculo exigem conciliação,
    -- sem reset, migração de uso ou concessão de segundo saldo sobreposto.
    if exists(select 1 from public.ia_ciclos_v1 where usuario_id=g.usuario_id and plano<>'FREE'
      and revogado_em is null and inicio_em<g.fim and fim_em>g.inicio) then
      raise exception 'Ciclo IA sobreposto exige conciliacao' using errcode='23514';
    end if;
    insert into public.ia_ciclos_v1(usuario_id,plano,assinatura_ref,periodo_ref,limite,inicio_em,fim_em)
      values(g.usuario_id,g.plano,coalesce(g.assinatura_id::text,'ADMIN:'||g.id::text),
        g.id::text,g.franquia,g.inicio,g.fim) returning id into ciclo;
  end if;
  insert into public.ia_concessoes_financeiras_v1(concessao_id,ambiente,usuario_id,assinatura_id,pagamento_id,
    origem,plano,franquia,inicio,fim,estado,revisao,ciclo_id)
  values(g.id,g.ambiente,g.usuario_id,g.assinatura_id,g.pagamento_id,g.origem,g.plano,g.franquia,
    g.inicio,g.fim,estado_recebido,revisao_recebida,ciclo)
  on conflict(concessao_id) do update set estado=excluded.estado,revisao=excluded.revisao,
    atualizado_em=clock_timestamp();
  if estado_recebido='REVOKED' and ciclo is not null then
    update public.ia_ciclos_v1 set revogado_em=coalesce(revogado_em,g.revogado_em,clock_timestamp()) where id=ciclo;
  end if;
  return true;
end; $$;

-- Concessão/revogação paga deixa de ser competência do backend de IA.
-- Dados antigos continuam íntegros, mas não autorizam novo saldo sem conciliação.
create or replace function public.ia_autorizar_ciclo_v1(p_usuario uuid,p_assinatura_ref text,p_periodo_ref text,
  p_inicio timestamptz,p_fim timestamptz) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
begin raise exception 'Use concessao financeira e outbox' using errcode='42501'; end; $$;
create or replace function public.ia_revogar_ciclo_v1(p_usuario uuid,p_ciclo uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin raise exception 'Revogue na origem financeira' using errcode='42501'; end; $$;
revoke all on function public.ia_autorizar_ciclo_v1(uuid,text,text,timestamptz,timestamptz),
  public.ia_revogar_ciclo_v1(uuid,uuid) from public,anon,authenticated,service_role;

create function public.ia_pode_usar_free_v1(p_usuario uuid) returns boolean
language sql security definer set search_path=pg_catalog as $$
  select public.ia_plano_v1(p_usuario)='FREE'
    and not exists(select 1 from public.ia_concessoes_financeiras_v1
      where usuario_id=p_usuario and inicio<=clock_timestamp() and fim>clock_timestamp())
    and not exists(select 1 from public.ia_ciclos_v1
      where usuario_id=p_usuario and plano<>'FREE' and inicio_em<=clock_timestamp() and fim_em>clock_timestamp()
        and revogado_em is null);
$$;

-- Seleção sem locks financeiros, de assinatura ou escrita. Não é autorização.
create or replace function public.ia_ciclo_atual_v1(p_usuario uuid) returns public.ia_ciclos_v1
language plpgsql security definer set search_path=pg_catalog as $$
declare c public.ia_ciclos_v1;
begin
  select c1.* into c from public.ia_ciclos_v1 c1
    join public.ia_concessoes_financeiras_v1 g on g.ciclo_id=c1.id
    where g.usuario_id=p_usuario and g.estado='AUTHORIZED' and c1.revogado_em is null
      and c1.inicio_em<=clock_timestamp() and c1.fim_em>clock_timestamp()
    order by c1.inicio_em desc,c1.id limit 1;
  if c.id is null and public.ia_pode_usar_free_v1(p_usuario) then
    select * into c from public.ia_ciclos_v1 where usuario_id=p_usuario and plano='FREE';
  end if;
  return c;
end; $$;

-- Chamado SEM lock prévio de saldo. O FOR SHARE do guard dura até o commit.
-- p_ciclo fixa o vínculo original para início/finalização, inclusive na virada.
create function public.ia_ciclo_guardado_v1(p_usuario uuid,p_ciclo uuid default null) returns public.ia_ciclos_v1
language plpgsql security definer set search_path=pg_catalog as $$
declare c public.ia_ciclos_v1; atual public.ia_ciclos_v1; g public.ia_concessoes_financeiras_v1;
  autorizado boolean:=true;
begin
  if p_ciclo is null then c:=public.ia_ciclo_atual_v1(p_usuario);
  else select * into c from public.ia_ciclos_v1 where id=p_ciclo and usuario_id=p_usuario; end if;
  if c.id is not null and c.plano<>'FREE' then
    select * into g from public.ia_concessoes_financeiras_v1 where ciclo_id=c.id and usuario_id=p_usuario;
    autorizado:=false;
    if g.concessao_id is not null and g.estado='AUTHORIZED'
      and to_regprocedure('public.billing_concessao_autorizada_v1(text,uuid,uuid,bigint)') is not null then
      autorizado:=public.billing_concessao_autorizada_v1(g.ambiente,p_usuario,g.concessao_id,g.revisao);
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_usuario::text,7101));
  if autorizado is not true then return null; end if;
  atual:=public.ia_ciclo_atual_v1(p_usuario);
  if c.id is null then
    if p_ciclo is not null or (atual.id is not null and atual.plano<>'FREE')
      or not public.ia_pode_usar_free_v1(p_usuario) then return null; end if;
    insert into public.ia_ciclos_v1(usuario_id,plano,assinatura_ref,periodo_ref,limite,inicio_em)
      values(p_usuario,'FREE','FREE','LIFETIME',1,clock_timestamp()) on conflict do nothing;
    select * into c from public.ia_ciclos_v1 where usuario_id=p_usuario and plano='FREE';
  elsif atual.id is distinct from c.id then
    -- Um ciclo diferente apareceu enquanto esperávamos: nunca obter seu lock
    -- financeiro depois do lock IA. Nova requisição poderá reavaliar.
    return null;
  end if;
  return c;
end; $$;

-- Contagem pura: usada somente após ia_ciclo_guardado_v1, evitando guard aninhado.
create function public.ia_saldo_ciclo_v1(p_usuario uuid,c public.ia_ciclos_v1) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare usados integer; reservados integer;
begin
  if c.id is null then return jsonb_build_object('codigo','CICLO_NAO_AUTORIZADO','plano',public.ia_plano_v1(p_usuario),
    'limite',null,'consumidas',0,'reservadas',0,'disponiveis',0,'inicio',null,'fim',null,'renovacao',null); end if;
  select count(*) into usados from public.ia_consumos_v1 where ciclo_id=c.id;
  if c.plano='FREE' and exists(select 1 from public.ia_demonstracoes_legado_v1 where usuario_id=p_usuario) then usados:=usados+1; end if;
  select count(*) into reservados from public.ia_execucoes_v1 where ciclo_id=c.id and estado in ('pending','processing','uncertain');
  return jsonb_build_object('codigo','OK','ciclo_id',c.id,'plano',c.plano,'limite',c.limite,
    'consumidas',usados,'reservadas',reservados,'disponiveis',greatest(0,c.limite-usados-reservados),
    'inicio',c.inicio_em,'fim',c.fim_em,'renovacao',c.fim_em);
end; $$;

create or replace function public.ia_saldo_interno_v1(p_usuario uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare c public.ia_ciclos_v1;
begin
  c:=public.ia_ciclo_guardado_v1(p_usuario);
  perform public.ia_recuperar_v1(p_usuario);
  return public.ia_saldo_ciclo_v1(p_usuario,c);
end; $$;
create or replace function public.ia_reservar_v1(p_usuario uuid,p_perfil uuid,p_oportunidade uuid,
  p_hash text,p_versao text,p_snapshot jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare e public.ia_execucoes_v1; saldo jsonb; c public.ia_ciclos_v1; usuario uuid:=auth.uid();
begin
  if usuario is null or p_usuario is distinct from usuario then
    raise exception 'Identidade autenticada obrigatoria' using errcode='42501';
  end if;
  p_usuario:=usuario;
  c:=public.ia_ciclo_guardado_v1(usuario);
  perform public.ia_validar_contexto_v1(p_usuario,p_perfil,p_oportunidade);
  perform public.ia_recuperar_v1(p_usuario);
  select * into e from public.ia_execucoes_v1 where usuario_id=p_usuario and perfil_id=p_perfil
    and oportunidade_id=p_oportunidade and dados_hash=p_hash and versao=p_versao
    and estado in ('pending','processing','completed','uncertain');
  if found then return jsonb_build_object('codigo',case when e.estado='completed' then 'EXISTENTE'
    when e.estado='uncertain' then 'INCERTA' else 'EM_ANDAMENTO' end,'execucao_id',e.id); end if;
  saldo:=public.ia_saldo_ciclo_v1(usuario,c);
  if saldo->>'codigo'<>'OK' then return saldo; end if;
  if (saldo->>'disponiveis')::integer<=0 then return jsonb_build_object('codigo','LIMITE_ATINGIDO'); end if;
  if p_snapshot is null or pg_column_size(p_snapshot)>100000 then raise exception 'Snapshot inválido'; end if;
  insert into public.ia_execucoes_v1(usuario_id,perfil_id,oportunidade_id,ciclo_id,dados_hash,versao,snapshot,expira_em)
    values(p_usuario,p_perfil,p_oportunidade,(saldo->>'ciclo_id')::uuid,p_hash,p_versao,p_snapshot,clock_timestamp()+interval '2 minutes') returning * into e;
  return jsonb_build_object('codigo','RESERVADA','execucao_id',e.id);
end; $$;

create or replace function public.ia_iniciar_v1(p_usuario uuid,p_execucao uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare e public.ia_execucoes_v1; c public.ia_ciclos_v1;
begin
  select * into e from public.ia_execucoes_v1 where id=p_execucao and usuario_id=p_usuario;
  if not found then raise exception 'Execução indisponível' using errcode='42501'; end if;
  c:=public.ia_ciclo_guardado_v1(p_usuario,e.ciclo_id);
  perform public.ia_recuperar_v1(p_usuario);
  select * into e from public.ia_execucoes_v1 where id=p_execucao and usuario_id=p_usuario for update;
  if not found then raise exception 'Execução indisponível' using errcode='42501'; end if;
  if e.estado<>'pending' then return jsonb_build_object('codigo','NAO_INICIADA','estado',e.estado); end if;
  perform public.ia_validar_contexto_v1(p_usuario,e.perfil_id,e.oportunidade_id);
  if c.id is distinct from e.ciclo_id or e.expira_em<=clock_timestamp() then
    update public.ia_execucoes_v1 set estado='failed',terminado_em=clock_timestamp(),erro_codigo='CICLO_ENCERRADO' where id=e.id;
    return jsonb_build_object('codigo','CICLO_ENCERRADO');
  end if;
  update public.ia_execucoes_v1 set estado='processing',token=gen_random_uuid(),iniciado_em=clock_timestamp(),
    expira_em=least(clock_timestamp()+interval '3 minutes',coalesce(c.fim_em,'infinity'::timestamptz)) where id=e.id returning * into e;
  return jsonb_build_object('codigo','INICIADA','token',e.token);
end; $$;

create or replace function public.ia_finalizar_v1(p_usuario uuid,p_execucao uuid,p_token uuid,p_resultado jsonb,
  p_metadados jsonb default '{}',p_reconciliar boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare e public.ia_execucoes_v1; c public.ia_ciclos_v1; pontos text[];
begin
  select * into e from public.ia_execucoes_v1 where id=p_execucao and usuario_id=p_usuario;
  if not found or p_token is null or e.token is distinct from p_token then raise exception 'Execução indisponível' using errcode='42501'; end if;
  if e.estado='completed' then return jsonb_build_object('codigo','CONCLUIDA','execucao_id',e.id); end if;
  c:=public.ia_ciclo_guardado_v1(p_usuario,e.ciclo_id);
  select * into e from public.ia_execucoes_v1 where id=p_execucao and usuario_id=p_usuario for update;
  if not found or p_token is null or e.token is distinct from p_token then raise exception 'Execução indisponível' using errcode='42501'; end if;
  if e.estado='completed' then return jsonb_build_object('codigo','CONCLUIDA','execucao_id',e.id); end if;
  perform public.ia_recuperar_v1(p_usuario);
  select * into e from public.ia_execucoes_v1 where id=e.id;
  if e.estado<>'processing' and not (e.estado='uncertain' and p_reconciliar is true) then
    return jsonb_build_object('codigo','NAO_FINALIZADA','estado',e.estado);
  end if;
  perform public.ia_validar_contexto_v1(p_usuario,e.perfil_id,e.oportunidade_id);
  if c.id is distinct from e.ciclo_id then
    update public.ia_execucoes_v1 set estado='uncertain',erro_codigo='CICLO_ENCERRADO' where id=e.id;
    return jsonb_build_object('codigo','CICLO_ENCERRADO');
  end if;
  if e.expira_em<=clock_timestamp() and p_reconciliar is not true then
    update public.ia_execucoes_v1 set estado='uncertain',erro_codigo='EXECUCAO_EXPIRADA' where id=e.id;
    return jsonb_build_object('codigo','NAO_FINALIZADA','estado','uncertain');
  end if;
  if p_metadados is null or jsonb_typeof(p_metadados)<>'object' or pg_column_size(p_metadados)>10000 then raise exception 'Metadados inválidos'; end if;
  if e.versao='analise-v2-comercial-p1' then
    if not public.ia_resultado_valido_v2(p_resultado) then raise exception 'Resultado v2 inválido'; end if;
    insert into public.ia_resultados_v1(execucao_id,usuario_id,perfil_id,oportunidade_id,versao_schema,resumo,conteudo)
      values(e.id,e.usuario_id,e.perfil_id,e.oportunidade_id,2,p_resultado->>'resumo',p_resultado);
  else
  if p_resultado is null or jsonb_typeof(p_resultado)<>'object'
    or jsonb_typeof(p_resultado->'score') is distinct from 'number'
    or (p_resultado->>'score') !~ '^(0|[1-9][0-9]?|100)$'
    or jsonb_typeof(p_resultado->'resumo') is distinct from 'string'
    or jsonb_typeof(p_resultado->'justificativa') is distinct from 'string'
    or jsonb_typeof(p_resultado->'pontos_atencao') is distinct from 'array' then raise exception 'Resultado inválido'; end if;
  if exists(select 1 from jsonb_array_elements(p_resultado->'pontos_atencao') v
    where jsonb_typeof(v)<>'string' or length(trim(v#>>'{}')) not between 1 and 500) then raise exception 'Pontos inválidos'; end if;
  select array_agg(v#>>'{}') into pontos from jsonb_array_elements(p_resultado->'pontos_atencao') v;
  insert into public.ia_resultados_v1(execucao_id,usuario_id,perfil_id,oportunidade_id,score,justificativa,resumo,pontos_atencao)
    values(e.id,e.usuario_id,e.perfil_id,e.oportunidade_id,(p_resultado->>'score')::integer,
      p_resultado->>'justificativa',p_resultado->>'resumo',pontos);
  end if;
  insert into public.ia_consumos_v1(execucao_id,usuario_id,ciclo_id) values(e.id,e.usuario_id,e.ciclo_id);
  update public.ia_execucoes_v1 set estado='completed',terminado_em=clock_timestamp(),erro_codigo=null,metadados=p_metadados where id=e.id;
  return jsonb_build_object('codigo','CONCLUIDA','execucao_id',e.id);
end; $$;


-- Hook é owner-only. O entregador financeiro SECURITY DEFINER tem o mesmo owner.
revoke all on function public.ia_receber_concessao_financeira_v1(jsonb),
  public.ia_pode_usar_free_v1(uuid),public.ia_ciclo_guardado_v1(uuid,uuid),
  public.ia_saldo_ciclo_v1(uuid,public.ia_ciclos_v1)
  from public,anon,authenticated,service_role;
-- Reserva exige JWT do usuário; execução/token/finalização continuam no backend.
revoke all on function public.ia_reservar_v1(uuid,uuid,uuid,text,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.ia_reservar_v1(uuid,uuid,uuid,text,text,jsonb) to authenticated;
commit;
