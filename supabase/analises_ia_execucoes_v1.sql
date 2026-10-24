-- Proposta local. Aplicar somente após homologação e coordenação com billing.
-- Depende de analises_oportunidades.sql e planos_e_permissoes_v1.sql.
-- Não concede planos, não confirma pagamentos, não infere períodos comerciais.
begin;
set local lock_timeout = '5s';

create table public.ia_ciclos_v1 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  plano text not null check (plano in ('FREE','PRO','BUSINESS')),
  assinatura_ref text not null,
  periodo_ref text not null,
  limite integer not null check (limite >= 0),
  inicio_em timestamptz not null,
  fim_em timestamptz,
  revogado_em timestamptz,
  criado_em timestamptz not null default clock_timestamp(),
  unique(usuario_id, assinatura_ref, periodo_ref),
  check ((plano='FREE' and assinatura_ref='FREE' and periodo_ref='LIFETIME' and limite=1 and fim_em is null)
    or (plano in ('PRO','BUSINESS') and assinatura_ref<>'FREE' and fim_em is not null
      and isfinite(inicio_em) and isfinite(fim_em) and fim_em>inicio_em))
);
create unique index ia_free_unico_v1 on public.ia_ciclos_v1(usuario_id) where plano='FREE';

-- Legado sem ciclo: evidência conservadora de demonstração já utilizada.
-- Não atribui consumos antigos ao ciclo pago atual nem fabrica hashes.
create table public.ia_demonstracoes_legado_v1 (
  usuario_id uuid primary key references auth.users(id) on delete cascade
);
insert into public.ia_demonstracoes_legado_v1(usuario_id)
select usuario_id from public.analises_ia_consumos
union select usuario_id from public.analises_oportunidades;

create table public.ia_execucoes_v1 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  perfil_id uuid not null references public.perfis_empresa(id),
  oportunidade_id uuid not null references public.oportunidades_editais(id),
  ciclo_id uuid not null references public.ia_ciclos_v1(id),
  dados_hash text not null check (dados_hash ~ '^[a-f0-9]{64}$'),
  versao text not null check (length(versao) between 1 and 80),
  snapshot jsonb not null check (jsonb_typeof(snapshot)='object'),
  estado text not null default 'pending' check (estado in ('pending','processing','completed','failed','uncertain')),
  token uuid,
  criado_em timestamptz not null default clock_timestamp(),
  iniciado_em timestamptz,
  terminado_em timestamptz,
  expira_em timestamptz not null,
  erro_codigo text,
  metadados jsonb not null default '{}' check (jsonb_typeof(metadados)='object')
);
create unique index ia_execucao_ativa_v1 on public.ia_execucoes_v1(usuario_id,perfil_id,oportunidade_id,dados_hash,versao)
where estado in ('pending','processing','uncertain','completed');
create index ia_execucoes_ciclo_v1 on public.ia_execucoes_v1(ciclo_id,estado);

-- Versões novas ficam separadas: a unicidade e os dados da tabela legada permanecem intactos.
create table public.ia_resultados_v1 (
  execucao_id uuid primary key references public.ia_execucoes_v1(id),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  perfil_id uuid not null references public.perfis_empresa(id),
  oportunidade_id uuid not null references public.oportunidades_editais(id),
  score integer not null check (score between 0 and 100),
  justificativa text not null check (length(trim(justificativa)) between 1 and 500),
  resumo text not null check (length(trim(resumo)) between 1 and 800),
  pontos_atencao text[] not null check (cardinality(pontos_atencao) between 1 and 5),
  criado_em timestamptz not null default clock_timestamp()
);
create index ia_resultados_consulta_v1 on public.ia_resultados_v1(usuario_id,perfil_id,oportunidade_id,criado_em desc);
create table public.ia_consumos_v1 (
  execucao_id uuid primary key references public.ia_execucoes_v1(id),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  ciclo_id uuid not null references public.ia_ciclos_v1(id),
  consumido_em timestamptz not null default clock_timestamp()
);
create index ia_consumos_ciclo_v1 on public.ia_consumos_v1(ciclo_id);

alter table public.ia_ciclos_v1 enable row level security;
alter table public.ia_demonstracoes_legado_v1 enable row level security;
alter table public.ia_execucoes_v1 enable row level security;
alter table public.ia_resultados_v1 enable row level security;
alter table public.ia_consumos_v1 enable row level security;
-- Execuções (token/snapshot) e ciclos são expostos somente por DTOs/RPCs.
create policy ia_resultados_leitura_v1 on public.ia_resultados_v1 for select to authenticated
using (usuario_id=auth.uid() and exists(select 1 from public.perfis_empresa p where p.id=perfil_id and p.usuario_id=auth.uid())
  and exists(select 1 from public.oportunidades_editais o where o.id=oportunidade_id));
revoke all on public.ia_ciclos_v1,public.ia_demonstracoes_legado_v1,public.ia_execucoes_v1,
  public.ia_resultados_v1,public.ia_consumos_v1 from public,anon,authenticated;
grant select on public.ia_resultados_v1 to authenticated;
-- A aplicação usa RPCs de backend, não escrita direta, mesmo com service_role.
revoke all on public.ia_ciclos_v1,public.ia_demonstracoes_legado_v1,public.ia_execucoes_v1,
  public.ia_resultados_v1,public.ia_consumos_v1 from service_role;
revoke insert,update,delete on public.analises_oportunidades from public,anon,authenticated,service_role;
drop policy if exists "Usuarios criam suas analises" on public.analises_oportunidades;
drop policy if exists "Usuarios atualizam suas analises" on public.analises_oportunidades;
drop policy if exists "Usuarios excluem suas analises" on public.analises_oportunidades;
-- Desativa o caminho anterior, mantendo tabelas e histórico para auditoria.
revoke execute on function public.reservar_analise_ia_v1(uuid,uuid) from public,anon,authenticated,service_role;
revoke execute on function public.liberar_reserva_ia_v1(uuid) from public,anon,authenticated,service_role;

create function public.ia_plano_v1(p_usuario uuid) returns text
language sql security definer set search_path=pg_catalog as $$
  select coalesce((select plano from public.assinaturas_usuario where usuario_id=p_usuario
    and plano in ('PRO','BUSINESS') and status in ('active','trial')
    and (fim_em is null or fim_em>clock_timestamp())), 'FREE');
$$;

-- Fronteira billing -> IA. Só aceita franquia lida da assinatura; datas e identidade
-- comercial devem ser fornecidas pelo adaptador de billing após confirmação financeira.
create function public.ia_autorizar_ciclo_v1(p_usuario uuid,p_assinatura_ref text,p_periodo_ref text,
  p_inicio timestamptz,p_fim timestamptz) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare s public.assinaturas_usuario; c public.ia_ciclos_v1; ref_atual text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_usuario::text,7101));
  if p_assinatura_ref is null or length(p_assinatura_ref) not between 1 and 200 or p_assinatura_ref='FREE'
    or p_periodo_ref is null or length(p_periodo_ref) not between 1 and 200
    or p_inicio is null or p_fim is null or not isfinite(p_inicio) or not isfinite(p_fim) or p_fim<=p_inicio then
    raise exception 'Ciclo inválido';
  end if;
  select * into c from public.ia_ciclos_v1 where usuario_id=p_usuario
    and assinatura_ref=p_assinatura_ref and periodo_ref=p_periodo_ref;
  if found then
    if c.inicio_em<>p_inicio or c.fim_em<>p_fim then raise exception 'Evento conflitante'; end if;
    return c.id; -- Repetição não reativa ciclo revogado e não altera sua franquia.
  end if;
  select * into s from public.assinaturas_usuario where usuario_id=p_usuario for share;
  ref_atual:=to_jsonb(s)->>'billing_subscription_id';
  if s.usuario_id is null or public.ia_plano_v1(p_usuario)='FREE' or s.franquia_ia is null
    or s.fim_em is null or s.fim_em<p_fim or (ref_atual is not null and ref_atual<>p_assinatura_ref) then
    raise exception 'Assinatura sem concessão compatível';
  end if;
  if exists(select 1 from public.ia_ciclos_v1 where usuario_id=p_usuario and plano<>'FREE'
    and revogado_em is null and inicio_em<p_fim and fim_em>p_inicio) then
    raise exception 'Períodos sobrepostos';
  end if;
  insert into public.ia_ciclos_v1(usuario_id,plano,assinatura_ref,periodo_ref,limite,inicio_em,fim_em)
    values(p_usuario,s.plano,p_assinatura_ref,p_periodo_ref,s.franquia_ia,p_inicio,p_fim) returning id into c.id;
  return c.id;
end; $$;

create function public.ia_revogar_ciclo_v1(p_usuario uuid,p_ciclo uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_usuario::text,7101));
  update public.ia_ciclos_v1 set revogado_em=coalesce(revogado_em,clock_timestamp())
    where id=p_ciclo and usuario_id=p_usuario and plano<>'FREE';
end; $$;

create function public.ia_ciclo_atual_v1(p_usuario uuid) returns public.ia_ciclos_v1
language plpgsql security definer set search_path=pg_catalog as $$
declare c public.ia_ciclos_v1; plano_atual text; ref_atual text;
begin
  -- Serializa a decisão de acesso com uma alteração concorrente de assinatura.
  perform 1 from public.assinaturas_usuario where usuario_id=p_usuario for share;
  plano_atual:=public.ia_plano_v1(p_usuario);
  if plano_atual='FREE' then
    insert into public.ia_ciclos_v1(usuario_id,plano,assinatura_ref,periodo_ref,limite,inicio_em)
      values(p_usuario,'FREE','FREE','LIFETIME',1,clock_timestamp()) on conflict do nothing;
    select * into c from public.ia_ciclos_v1 where usuario_id=p_usuario and plano='FREE';
  else
    select to_jsonb(s)->>'billing_subscription_id' into ref_atual from public.assinaturas_usuario s where usuario_id=p_usuario;
    select * into c from public.ia_ciclos_v1 where usuario_id=p_usuario and plano=plano_atual
      and revogado_em is null and inicio_em<=clock_timestamp() and fim_em>clock_timestamp()
      and (ref_atual is null or assinatura_ref=ref_atual);
  end if;
  return c;
end; $$;

create function public.ia_recuperar_v1(p_usuario uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_usuario::text,7101));
  update public.ia_execucoes_v1 set estado='failed',terminado_em=clock_timestamp(),erro_codigo='RESERVA_EXPIRADA'
    where usuario_id=p_usuario and estado='pending' and expira_em<=clock_timestamp();
  -- A chamada pode ter ocorrido: não libera vaga e não permite repetição automática.
  update public.ia_execucoes_v1 set estado='uncertain',erro_codigo='EXECUCAO_EXPIRADA'
    where usuario_id=p_usuario and estado='processing' and expira_em<=clock_timestamp();
end; $$;

create function public.ia_saldo_interno_v1(p_usuario uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare c public.ia_ciclos_v1; usados integer; reservados integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_usuario::text,7101));
  perform public.ia_recuperar_v1(p_usuario);
  c:=public.ia_ciclo_atual_v1(p_usuario);
  if c.id is null then return jsonb_build_object('codigo','CICLO_NAO_AUTORIZADO','plano',public.ia_plano_v1(p_usuario),
    'limite',null,'consumidas',0,'reservadas',0,'disponiveis',0,'inicio',null,'fim',null,'renovacao',null); end if;
  select count(*) into usados from public.ia_consumos_v1 where ciclo_id=c.id;
  if c.plano='FREE' and exists(select 1 from public.ia_demonstracoes_legado_v1 where usuario_id=p_usuario) then usados:=usados+1; end if;
  select count(*) into reservados from public.ia_execucoes_v1 where ciclo_id=c.id and estado in ('pending','processing','uncertain');
  return jsonb_build_object('codigo','OK','ciclo_id',c.id,'plano',c.plano,'limite',c.limite,
    'consumidas',usados,'reservadas',reservados,'disponiveis',greatest(0,c.limite-usados-reservados),
    'inicio',c.inicio_em,'fim',c.fim_em,'renovacao',c.fim_em);
end; $$;

create function public.ia_consultar_franquia_v1() returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if auth.uid() is null then raise exception 'Não autorizado' using errcode='42501'; end if;
  return public.ia_saldo_interno_v1(auth.uid());
end; $$;

create function public.ia_validar_contexto_v1(p_usuario uuid,p_perfil uuid,p_oportunidade uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if p_usuario is null or not exists(select 1 from auth.users where id=p_usuario)
    or not exists(select 1 from public.perfis_empresa where id=p_perfil and usuario_id=p_usuario)
    or not exists(select 1 from public.oportunidades_editais o where id=p_oportunidade
      and public.plano_historico_visivel_v1(case when public.ia_plano_v1(p_usuario)='BUSINESS' then 'PRO' else public.ia_plano_v1(p_usuario) end,
        o.status,o.participacao_prazo_limite,o.data_publicacao)) then
    raise exception 'Contexto indisponível' using errcode='42501';
  end if;
end; $$;

-- Hash e snapshot vêm exclusivamente do backend autenticado, nunca de FormData.
create function public.ia_reservar_v1(p_usuario uuid,p_perfil uuid,p_oportunidade uuid,
  p_hash text,p_versao text,p_snapshot jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare e public.ia_execucoes_v1; saldo jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_usuario::text,7101));
  perform public.ia_validar_contexto_v1(p_usuario,p_perfil,p_oportunidade);
  perform public.ia_recuperar_v1(p_usuario);
  select * into e from public.ia_execucoes_v1 where usuario_id=p_usuario and perfil_id=p_perfil
    and oportunidade_id=p_oportunidade and dados_hash=p_hash and versao=p_versao
    and estado in ('pending','processing','completed','uncertain');
  if found then return jsonb_build_object('codigo',case when e.estado='completed' then 'EXISTENTE'
    when e.estado='uncertain' then 'INCERTA' else 'EM_ANDAMENTO' end,'execucao_id',e.id); end if;
  saldo:=public.ia_saldo_interno_v1(p_usuario);
  if saldo->>'codigo'<>'OK' then return saldo; end if;
  if (saldo->>'disponiveis')::integer<=0 then return jsonb_build_object('codigo','LIMITE_ATINGIDO'); end if;
  if p_snapshot is null or pg_column_size(p_snapshot)>100000 then raise exception 'Snapshot inválido'; end if;
  insert into public.ia_execucoes_v1(usuario_id,perfil_id,oportunidade_id,ciclo_id,dados_hash,versao,snapshot,expira_em)
    values(p_usuario,p_perfil,p_oportunidade,(saldo->>'ciclo_id')::uuid,p_hash,p_versao,p_snapshot,clock_timestamp()+interval '2 minutes') returning * into e;
  return jsonb_build_object('codigo','RESERVADA','execucao_id',e.id);
end; $$;

create function public.ia_iniciar_v1(p_usuario uuid,p_execucao uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare e public.ia_execucoes_v1; c public.ia_ciclos_v1;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_usuario::text,7101));
  perform public.ia_recuperar_v1(p_usuario);
  select * into e from public.ia_execucoes_v1 where id=p_execucao and usuario_id=p_usuario for update;
  if not found then raise exception 'Execução indisponível' using errcode='42501'; end if;
  if e.estado<>'pending' then return jsonb_build_object('codigo','NAO_INICIADA','estado',e.estado); end if;
  perform public.ia_validar_contexto_v1(p_usuario,e.perfil_id,e.oportunidade_id);
  c:=public.ia_ciclo_atual_v1(p_usuario);
  if c.id is distinct from e.ciclo_id or e.expira_em<=clock_timestamp() then
    update public.ia_execucoes_v1 set estado='failed',terminado_em=clock_timestamp(),erro_codigo='CICLO_ENCERRADO' where id=e.id;
    return jsonb_build_object('codigo','CICLO_ENCERRADO');
  end if;
  update public.ia_execucoes_v1 set estado='processing',token=gen_random_uuid(),iniciado_em=clock_timestamp(),
    expira_em=least(clock_timestamp()+interval '3 minutes',coalesce(c.fim_em,'infinity'::timestamptz)) where id=e.id returning * into e;
  return jsonb_build_object('codigo','INICIADA','token',e.token);
end; $$;

create function public.ia_finalizar_v1(p_usuario uuid,p_execucao uuid,p_token uuid,p_resultado jsonb,
  p_metadados jsonb default '{}',p_reconciliar boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare e public.ia_execucoes_v1; c public.ia_ciclos_v1; pontos text[];
begin
  perform pg_advisory_xact_lock(hashtextextended(p_usuario::text,7101));
  select * into e from public.ia_execucoes_v1 where id=p_execucao and usuario_id=p_usuario for update;
  if not found or p_token is null or e.token is distinct from p_token then raise exception 'Execução indisponível' using errcode='42501'; end if;
  if e.estado='completed' then return jsonb_build_object('codigo','CONCLUIDA','execucao_id',e.id); end if;
  perform public.ia_recuperar_v1(p_usuario);
  select * into e from public.ia_execucoes_v1 where id=e.id;
  if e.estado<>'processing' and not (e.estado='uncertain' and p_reconciliar is true) then
    return jsonb_build_object('codigo','NAO_FINALIZADA','estado',e.estado);
  end if;
  perform public.ia_validar_contexto_v1(p_usuario,e.perfil_id,e.oportunidade_id);
  c:=public.ia_ciclo_atual_v1(p_usuario);
  if c.id is distinct from e.ciclo_id then
    update public.ia_execucoes_v1 set estado='uncertain',erro_codigo='CICLO_ENCERRADO' where id=e.id;
    return jsonb_build_object('codigo','CICLO_ENCERRADO');
  end if;
  if e.expira_em<=clock_timestamp() and p_reconciliar is not true then
    update public.ia_execucoes_v1 set estado='uncertain',erro_codigo='EXECUCAO_EXPIRADA' where id=e.id;
    return jsonb_build_object('codigo','NAO_FINALIZADA','estado','uncertain');
  end if;
  if p_resultado is null or jsonb_typeof(p_resultado)<>'object'
    or jsonb_typeof(p_resultado->'score') is distinct from 'number'
    or (p_resultado->>'score') !~ '^(0|[1-9][0-9]?|100)$'
    or jsonb_typeof(p_resultado->'resumo') is distinct from 'string'
    or jsonb_typeof(p_resultado->'justificativa') is distinct from 'string'
    or jsonb_typeof(p_resultado->'pontos_atencao') is distinct from 'array' then raise exception 'Resultado inválido'; end if;
  if exists(select 1 from jsonb_array_elements(p_resultado->'pontos_atencao') v
    where jsonb_typeof(v)<>'string' or length(trim(v#>>'{}')) not between 1 and 500) then raise exception 'Pontos inválidos'; end if;
  select array_agg(v#>>'{}') into pontos from jsonb_array_elements(p_resultado->'pontos_atencao') v;
  if p_metadados is null or jsonb_typeof(p_metadados)<>'object' or pg_column_size(p_metadados)>10000 then raise exception 'Metadados inválidos'; end if;
  insert into public.ia_resultados_v1(execucao_id,usuario_id,perfil_id,oportunidade_id,score,justificativa,resumo,pontos_atencao)
    values(e.id,e.usuario_id,e.perfil_id,e.oportunidade_id,(p_resultado->>'score')::integer,
      p_resultado->>'justificativa',p_resultado->>'resumo',pontos);
  insert into public.ia_consumos_v1(execucao_id,usuario_id,ciclo_id) values(e.id,e.usuario_id,e.ciclo_id);
  update public.ia_execucoes_v1 set estado='completed',terminado_em=clock_timestamp(),erro_codigo=null,metadados=p_metadados where id=e.id;
  return jsonb_build_object('codigo','CONCLUIDA','execucao_id',e.id);
end; $$;

create function public.ia_falhar_v1(p_usuario uuid,p_execucao uuid,p_token uuid,p_incerta boolean,
  p_codigo text,p_reconciliar boolean default false,p_metadados jsonb default '{}') returns text
language plpgsql security definer set search_path=pg_catalog as $$
declare e public.ia_execucoes_v1;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_usuario::text,7101));
  select * into e from public.ia_execucoes_v1 where id=p_execucao and usuario_id=p_usuario for update;
  if not found or p_token is null or e.token is distinct from p_token then raise exception 'Execução indisponível' using errcode='42501'; end if;
  if e.estado in ('completed','failed') then return e.estado; end if;
  if e.estado='uncertain' and p_reconciliar is not true then return e.estado; end if;
  if p_incerta is null then raise exception 'Estado obrigatório'; end if;
  if p_metadados is null or jsonb_typeof(p_metadados)<>'object' or pg_column_size(p_metadados)>10000 then raise exception 'Metadados inválidos'; end if;
  update public.ia_execucoes_v1 set estado=case when p_incerta then 'uncertain' else 'failed' end,
    terminado_em=case when p_incerta then null else clock_timestamp() end,erro_codigo=left(p_codigo,80),
    metadados=metadados||p_metadados where id=e.id returning * into e;
  return e.estado;
end; $$;

-- Operação somente de backend para reconciliação manual; token nunca vai à UI.
create function public.ia_inspecionar_v1(p_usuario uuid,p_execucao uuid) returns jsonb
language sql security definer set search_path=pg_catalog as $$
  select to_jsonb(e) from public.ia_execucoes_v1 e where id=p_execucao and usuario_id=p_usuario;
$$;

-- Lista explícita: nenhum helper SECURITY DEFINER fica executável por PUBLIC.
do $$ declare assinatura text; begin
  foreach assinatura in array array[
    'ia_plano_v1(uuid)','ia_autorizar_ciclo_v1(uuid,text,text,timestamptz,timestamptz)',
    'ia_revogar_ciclo_v1(uuid,uuid)','ia_ciclo_atual_v1(uuid)','ia_recuperar_v1(uuid)',
    'ia_saldo_interno_v1(uuid)','ia_consultar_franquia_v1()', 'ia_validar_contexto_v1(uuid,uuid,uuid)',
    'ia_reservar_v1(uuid,uuid,uuid,text,text,jsonb)','ia_iniciar_v1(uuid,uuid)',
    'ia_finalizar_v1(uuid,uuid,uuid,jsonb,jsonb,boolean)','ia_falhar_v1(uuid,uuid,uuid,boolean,text,boolean,jsonb)',
    'ia_inspecionar_v1(uuid,uuid)'
  ] loop execute 'revoke all on function public.'||assinatura||' from public,anon,authenticated,service_role'; end loop;
end $$;
grant execute on function public.ia_consultar_franquia_v1() to authenticated;
grant execute on function public.ia_autorizar_ciclo_v1(uuid,text,text,timestamptz,timestamptz),
  public.ia_revogar_ciclo_v1(uuid,uuid),public.ia_recuperar_v1(uuid),
  public.ia_reservar_v1(uuid,uuid,uuid,text,text,jsonb),public.ia_iniciar_v1(uuid,uuid),
  public.ia_finalizar_v1(uuid,uuid,uuid,jsonb,jsonb,boolean),public.ia_falhar_v1(uuid,uuid,uuid,boolean,text,boolean,jsonb),
  public.ia_inspecionar_v1(uuid,uuid)
  to service_role;
commit;
