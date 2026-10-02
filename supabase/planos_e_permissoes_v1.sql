-- MANUAL: aplicar somente após homologação. Requer oportunidades_ciclo_vida_v1.sql
-- e alertas_email.sql já executados no mesmo projeto.
-- Sem pagamento; ausência de assinatura (ou status não ativo) equivale a FREE.
begin;
set local lock_timeout = '5s';

do $dependencias$
begin
  if to_regclass('public.alertas_perfis') is null
    or to_regclass('public.alertas_envios') is null then
    raise exception 'Dependência ausente: execute supabase/alertas_email.sql antes desta migration';
  end if;
  if to_regclass('public.perfis_empresa') is null
    or to_regclass('public.analises_oportunidades') is null
    or to_regclass('public.oportunidades_editais') is null
    or to_regclass('public.oportunidades_favoritos') is null then
    raise exception 'Dependência ausente: confira as migrations de perfis, oportunidades e análises';
  end if;
  if to_regprocedure('public.listar_oportunidades_paginadas_v2(uuid,text,text,text,text,text,integer,text)') is null then
    raise exception 'Dependência ausente: execute oportunidades_ciclo_vida_v1.sql antes desta migration';
  end if;
end;
$dependencias$;

create table public.assinaturas_usuario (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  plano text not null default 'FREE' check (plano in ('FREE','PRO')),
  status text not null default 'active' check (status in ('active','canceled','expired','trial')),
  franquia_ia integer check (franquia_ia is null or franquia_ia >= 0),
  inicio_em timestamptz not null default now(),
  fim_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.assinaturas_usuario enable row level security;
create policy "Usuario consulta seu plano" on public.assinaturas_usuario
  for select to authenticated using (usuario_id=auth.uid());
create trigger assinaturas_atualizado_em before update on public.assinaturas_usuario
  for each row execute function public.atualizar_atualizado_em();
revoke all on public.assinaturas_usuario from public,anon,authenticated;
grant select on public.assinaturas_usuario to authenticated;

-- O gatilho cobre novas contas; usuários antigos usam o fallback da função.
create function public.plano_criar_free_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
  insert into public.assinaturas_usuario(usuario_id) values(new.id)
  on conflict (usuario_id) do nothing;
  return new;
end; $$;
create trigger plano_criar_free_v1 after insert on auth.users
  for each row execute function public.plano_criar_free_v1();
revoke all on function public.plano_criar_free_v1() from public,anon,authenticated;

create function public.plano_atual_v1() returns text
language plpgsql stable security invoker set search_path=pg_catalog as $$
declare codigo text;
begin
  if auth.uid() is null then raise exception 'Não autorizado' using errcode='42501'; end if;
  select case when plano='PRO' and status in ('active','trial')
    and (fim_em is null or fim_em>now()) then 'PRO' else 'FREE' end
    into codigo from public.assinaturas_usuario where usuario_id=auth.uid();
  return coalesce(codigo,'FREE');
end; $$;
revoke all on function public.plano_atual_v1() from public,anon;
grant execute on function public.plano_atual_v1() to authenticated;

create function public.plano_limite_ia_v1() returns integer
language plpgsql stable security invoker set search_path=pg_catalog as $$
declare limite integer;
begin
  if public.plano_atual_v1()='FREE' then return 1; end if;
  select franquia_ia into limite from public.assinaturas_usuario where usuario_id=auth.uid();
  return limite; -- NULL: franquia Pro ainda não configurada, sem teto provisório.
end; $$;
revoke all on function public.plano_limite_ia_v1() from public,anon;
grant execute on function public.plano_limite_ia_v1() to authenticated;

-- Consumo concluído é permanente por usuário: excluir/editar uma análise não
-- devolve uma demonstração já utilizada. O preenchimento inicial preserva o
-- significado das análises existentes sem alterá-las.
create table public.analises_ia_consumos (
  analise_id uuid primary key,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  consumido_em timestamptz not null default now()
);
create index analises_ia_consumos_usuario_idx on public.analises_ia_consumos(usuario_id);
alter table public.analises_ia_consumos enable row level security;
create policy "Usuario consulta seus consumos de IA" on public.analises_ia_consumos
  for select to authenticated using(usuario_id=auth.uid());
revoke all on public.analises_ia_consumos from public,anon,authenticated;
grant select on public.analises_ia_consumos to authenticated;
insert into public.analises_ia_consumos(analise_id,usuario_id,consumido_em)
  select id,usuario_id,criado_em from public.analises_oportunidades;

create function public.plano_limitar_inclusao_v1() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
declare quantidade integer; limite integer;
begin
  if auth.uid() is null or new.usuario_id<>auth.uid() then
    raise exception 'Não autorizado' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.usuario_id::text,7101));
  if tg_table_name='perfis_empresa' then
    limite := case when public.plano_atual_v1()='PRO' then 3 else 1 end;
    select count(*) into quantidade from public.perfis_empresa where usuario_id=new.usuario_id;
    if quantidade>=limite then raise exception 'Limite de perfis do plano atingido' using errcode='P0001'; end if;
  elsif tg_table_name='oportunidades_favoritos' then
    -- Upsert idempotente de um favorito existente não ocupa uma nova vaga.
    if exists(select 1 from public.oportunidades_favoritos
      where usuario_id=new.usuario_id and oportunidade_id=new.oportunidade_id) then return new; end if;
    if public.plano_atual_v1()='PRO' then return new; end if;
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
create trigger plano_limitar_perfis_v1 before insert on public.perfis_empresa
  for each row execute function public.plano_limitar_inclusao_v1();
create trigger plano_limitar_favoritos_v1 before insert on public.oportunidades_favoritos
  for each row execute function public.plano_limitar_inclusao_v1();
create trigger plano_limitar_analises_v1 before insert on public.analises_oportunidades
  for each row execute function public.plano_limitar_inclusao_v1();
revoke all on function public.plano_limitar_inclusao_v1() from public,anon,authenticated;
grant execute on function public.plano_limitar_inclusao_v1() to authenticated;

-- Verificação final cobre também um INSERT com várias linhas no mesmo comando.
create function public.plano_verificar_total_v1() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
declare quantidade integer; limite integer;
begin
  if tg_table_name='perfis_empresa' then
    limite := case when public.plano_atual_v1()='PRO' then 3 else 1 end;
    select count(*) into quantidade from public.perfis_empresa where usuario_id=new.usuario_id;
  elsif tg_table_name='oportunidades_favoritos' then
    if public.plano_atual_v1()='PRO' then return new; end if;
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
create trigger plano_verificar_perfis_v1 after insert on public.perfis_empresa
  for each row execute function public.plano_verificar_total_v1();
create trigger plano_verificar_favoritos_v1 after insert on public.oportunidades_favoritos
  for each row execute function public.plano_verificar_total_v1();
create trigger plano_verificar_analises_v1 after insert on public.analises_oportunidades
  for each row execute function public.plano_verificar_total_v1();
revoke all on function public.plano_verificar_total_v1() from public,anon,authenticated;
grant execute on function public.plano_verificar_total_v1() to authenticated;

create function public.plano_registrar_consumo_ia_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
  insert into public.analises_ia_consumos(analise_id,usuario_id)
    values(new.id,new.usuario_id);
  return new;
end; $$;
create trigger plano_registrar_consumo_ia_v1 after insert on public.analises_oportunidades
  for each row execute function public.plano_registrar_consumo_ia_v1();
revoke all on function public.plano_registrar_consumo_ia_v1() from public,anon,authenticated;
grant execute on function public.plano_registrar_consumo_ia_v1() to authenticated;

-- Impede que uma configuração Free seja ativada diretamente pela Data API.
create function public.plano_validar_alerta_v1() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if auth.uid() is not null and new.ativo and public.plano_atual_v1()<>'PRO' then
    raise exception 'Alertas disponíveis no plano Pro' using errcode='P0001';
  end if;
  return new;
end; $$;
create trigger plano_validar_alerta_v1 before insert or update of ativo on public.alertas_perfis
  for each row execute function public.plano_validar_alerta_v1();
revoke all on function public.plano_validar_alerta_v1() from public,anon,authenticated;
grant execute on function public.plano_validar_alerta_v1() to authenticated;

create table public.score_desbloqueios (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  perfil_id uuid not null references public.perfis_empresa(id) on delete cascade,
  oportunidade_id uuid not null references public.oportunidades_editais(id) on delete cascade,
  dia date not null,
  criado_em timestamptz not null default now(),
  primary key(usuario_id,perfil_id,oportunidade_id,dia)
);
create index score_desbloqueios_usuario_dia_idx on public.score_desbloqueios(usuario_id,dia);
alter table public.score_desbloqueios enable row level security;
create policy "Usuario consulta seus desbloqueios" on public.score_desbloqueios
  for select to authenticated using(usuario_id=auth.uid());
revoke all on public.score_desbloqueios from public,anon,authenticated;
grant select on public.score_desbloqueios to authenticated;

create function public.plano_dia_v1() returns date
language sql stable security invoker set search_path=pg_catalog
as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;
revoke all on function public.plano_dia_v1() from public,anon;
grant execute on function public.plano_dia_v1() to authenticated;

create function public.plano_tem_score_v1(p_perfil_id uuid,p_oportunidade_id uuid) returns boolean
language sql stable security invoker set search_path=pg_catalog as $$
  select public.plano_atual_v1()='PRO' or exists (
    select 1 from public.score_desbloqueios d where d.usuario_id=auth.uid()
    and d.perfil_id=p_perfil_id and d.oportunidade_id=p_oportunidade_id
    and d.dia=public.plano_dia_v1()
  );
$$;
revoke all on function public.plano_tem_score_v1(uuid,uuid) from public,anon;
grant execute on function public.plano_tem_score_v1(uuid,uuid) to authenticated;

create function public.plano_historico_visivel_v1(
  p_plano text,p_status text,p_prazo timestamptz,p_publicacao date
) returns boolean language sql stable security invoker set search_path=pg_catalog as $$
  select p_plano='PRO' or case
    when p_status='encerrada' or (coalesce(isfinite(p_prazo),false) and p_prazo<=now()) then
      coalesce(case when isfinite(p_prazo) then (p_prazo at time zone 'America/Sao_Paulo')::date end,
        case when isfinite(p_publicacao) then p_publicacao end)
        >= (now() at time zone 'America/Sao_Paulo')::date-30
    else true end;
$$;
revoke all on function public.plano_historico_visivel_v1(text,text,timestamptz,date) from public,anon;
grant execute on function public.plano_historico_visivel_v1(text,text,timestamptz,date) to authenticated;

create function public.desbloquear_score_v1(p_perfil_id uuid,p_oportunidade_id uuid) returns boolean
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
  if public.plano_atual_v1()='PRO' then return true; end if;
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
revoke all on function public.desbloquear_score_v1(uuid,uuid) from public,anon;
grant execute on function public.desbloquear_score_v1(uuid,uuid) to authenticated;

create table public.reservas_analise_ia (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  perfil_id uuid not null references public.perfis_empresa(id) on delete cascade,
  oportunidade_id uuid not null references public.oportunidades_editais(id) on delete cascade,
  expira_em timestamptz not null default now()+interval '5 minutes'
);
create index reservas_analise_ia_usuario_idx on public.reservas_analise_ia(usuario_id,expira_em);
alter table public.reservas_analise_ia enable row level security;
revoke all on public.reservas_analise_ia from public,anon,authenticated;

create function public.reservar_analise_ia_v1(p_perfil_id uuid,p_oportunidade_id uuid) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare usuario uuid := auth.uid(); limite integer; usados integer; reserva uuid;
begin
  if usuario is null then raise exception 'Não autorizado' using errcode='42501'; end if;
  if not exists(select 1 from public.perfis_empresa where id=p_perfil_id and usuario_id=usuario)
    or not exists(select 1 from public.oportunidades_editais o where o.id=p_oportunidade_id
      and public.plano_historico_visivel_v1(public.plano_atual_v1(),o.status,
        o.participacao_prazo_limite,o.data_publicacao)) then
    raise exception 'Perfil ou oportunidade indisponível' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(usuario::text,7101));
  if exists(select 1 from public.analises_oportunidades where usuario_id=usuario
      and perfil_id=p_perfil_id and oportunidade_id=p_oportunidade_id) then return null; end if;
  if exists(select 1 from public.reservas_analise_ia where usuario_id=usuario and perfil_id=p_perfil_id
      and oportunidade_id=p_oportunidade_id and expira_em>now()) then return null; end if;
  limite := public.plano_limite_ia_v1();
  if limite is not null then
    select (select count(*) from public.analises_ia_consumos where usuario_id=usuario)
      +(select count(*) from public.reservas_analise_ia where usuario_id=usuario and expira_em>now()) into usados;
    if usados>=limite then return null; end if;
  end if;
  insert into public.reservas_analise_ia(usuario_id,perfil_id,oportunidade_id)
    values(usuario,p_perfil_id,p_oportunidade_id) returning id into reserva;
  return reserva;
end; $$;
revoke all on function public.reservar_analise_ia_v1(uuid,uuid) from public,anon;
grant execute on function public.reservar_analise_ia_v1(uuid,uuid) to authenticated;

create function public.liberar_reserva_ia_v1(p_reserva_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if auth.uid() is null then raise exception 'Não autorizado' using errcode='42501'; end if;
  delete from public.reservas_analise_ia where id=p_reserva_id and usuario_id=auth.uid();
end; $$;
revoke all on function public.liberar_reserva_ia_v1(uuid) from public,anon;
grant execute on function public.liberar_reserva_ia_v1(uuid) to authenticated;

create table public.eventos_plano (
  id bigint generated always as identity primary key,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  evento text not null check(evento in ('atingiu_limite_perfil','atingiu_limite_favoritos',
    'atingiu_limite_score','atingiu_limite_ia','tentou_ativar_alerta','clicou_upgrade','viu_planos')),
  criado_em timestamptz not null default now()
);
create index eventos_plano_usuario_idx on public.eventos_plano(usuario_id,criado_em desc);
alter table public.eventos_plano enable row level security;
create policy "Usuario registra seus eventos" on public.eventos_plano
  for insert to authenticated with check(usuario_id=auth.uid());
create policy "Usuario consulta seus eventos" on public.eventos_plano
  for select to authenticated using(usuario_id=auth.uid());
revoke all on public.eventos_plano from public,anon,authenticated;
grant select,insert on public.eventos_plano to authenticated;

-- Dados antigos permanecem; inclusões novas são limitadas por triggers.
-- Chamadas legadas que retornavam match sem cota deixam de ser públicas.
revoke execute on function public.listar_oportunidades_paginadas_v1(uuid,text,text,text,text,text,integer) from authenticated;

-- Leitura direta da tabela/view também não revela histórico antigo ao FREE.
drop policy "Usuarios autenticados leem oportunidades" on public.oportunidades_editais;
create policy "Usuarios autenticados leem oportunidades" on public.oportunidades_editais
  for select to authenticated using (
    auth.uid() is not null and public.plano_historico_visivel_v1(
      (select public.plano_atual_v1()),status,participacao_prazo_limite,data_publicacao)
  );

-- A definição da V2, com filtro de histórico e mascaramento do score, segue abaixo.
create or replace function public.listar_oportunidades_paginadas_v2(
  p_perfil_id uuid default null, p_busca text default null, p_status text default null,
  p_uf text default null, p_aderencia text default null, p_ordenacao text default 'recomendadas',
  p_pagina integer default 1, p_visao text default 'ativas'
)
returns table (oportunidade jsonb, match jsonb, favorito boolean)
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  visao text := coalesce(p_visao,'ativas');
  plano_codigo text := public.plano_atual_v1();
  perfil jsonb := public.matching_perfil_autorizado_v1(p_perfil_id);
  modo text := coalesce(p_ordenacao,'recomendadas');
  termo text := nullif(public.matching_trim_v1(p_busca),'');
  padrao text;
  uf_filtro text := nullif(upper(public.matching_trim_v1(p_uf)), '');
  nivel text := case when perfil is null then null else nullif(p_aderencia,'') end;
  palavras_score text[] := '{}';
  segmento_score text[] := '{}';
  uf_score text;
  uf_score_valida boolean := false;
begin
  if visao not in ('ativas','historico','todas') then raise exception 'Visão inválida' using errcode='22023'; end if;
  if modo not in ('recomendadas','mais_novas','maior_aderencia','prazo_proximo') then modo := 'recomendadas'; end if;
  if perfil is null and modo = 'maior_aderencia' then modo := 'recomendadas'; end if;
  if nullif(p_status,'') is not null and p_status not in ('aberta','em_analise','encerrada') then raise exception 'Status inválido'; end if;
  if nivel is not null and nivel not in ('alta','media','baixa') then raise exception 'Aderência inválida'; end if;
  if perfil is not null then
    select palavras,segmento,uf,uf_valida into palavras_score,segmento_score,uf_score,uf_score_valida
    from public.matching_preparar_score_v1(perfil);
  end if;
  -- Escape de barra primeiro; % e _ são literais. Sem SQL dinâmico.
  padrao := '%' || replace(replace(replace(termo, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';
  -- Sem perfil, não materializar a base inteira nem avaliar matcher.
  if perfil is null then
    return query
    with pagina as materialized (
      select o.* from public.oportunidades_editais o
      where (visao='todas' or (visao='historico' and
          (o.status='encerrada' or (isfinite(o.participacao_prazo_limite) and o.participacao_prazo_limite<=statement_timestamp())))
        or (visao='ativas' and o.status is distinct from 'encerrada' and
          (o.participacao_prazo_limite is null or not isfinite(o.participacao_prazo_limite) or o.participacao_prazo_limite>statement_timestamp())))
        and public.plano_historico_visivel_v1(plano_codigo,o.status,o.participacao_prazo_limite,o.data_publicacao)
        and (nullif(p_status,'') is null or o.status = p_status)
        and (uf_filtro is null or o.uf = uf_filtro)
        and (termo is null or (o.busca_documento ilike padrao escape E'\\' and
          (o.titulo ilike padrao escape E'\\' or o.orgao ilike padrao escape E'\\' or
           o.modalidade ilike padrao escape E'\\' or o.cidade ilike padrao escape E'\\' or o.objeto ilike padrao escape E'\\')))
      order by
        case when modo='recomendadas' then
          case when o.status='encerrada' or (isfinite(o.participacao_prazo_limite) and o.participacao_prazo_limite<=statement_timestamp()) then 1 else 0 end end,
        case when modo='recomendadas' then case o.status when 'aberta' then 0 when 'em_analise' then 1 else 2 end
          else case when o.status='encerrada' then 1 else 0 end end,
        case when modo='prazo_proximo' then public.matching_prazo_v1(o.participacao_prazo_limite,o.data_abertura) end asc nulls last,
        case when isfinite(o.data_publicacao) then o.data_publicacao end desc nulls last, o.id
      limit 21 offset ((greatest(coalesce(p_pagina,1),1)::bigint - 1) * 20)
    )
    select jsonb_build_object('id',o.id,'codigo',o.codigo,'origem',o.origem,'tipo',o.tipo,
      'titulo',o.titulo,'orgao',o.orgao,'modalidade',o.modalidade,'uf',o.uf,'cidade',o.cidade,
      'objeto',o.objeto,'valorEstimado',o.valor_estimado,'dataPublicacao',case when isfinite(o.data_publicacao) then o.data_publicacao end,
      'dataAbertura',case when isfinite(o.data_abertura) then o.data_abertura end,'status',o.status,'tags',o.tags,
      'situacaoOperacional',public.oportunidade_situacao_v1(o.status,o.participacao_prazo_limite,statement_timestamp())), null::jsonb,
      exists(select 1 from public.oportunidades_favoritos f where f.usuario_id=auth.uid() and f.oportunidade_id=o.id)
    from pagina o order by
      case when modo='recomendadas' then
        case when o.status='encerrada' or (isfinite(o.participacao_prazo_limite) and o.participacao_prazo_limite<=statement_timestamp()) then 1 else 0 end end,
        case when modo='recomendadas' then case o.status when 'aberta' then 0 when 'em_analise' then 1 else 2 end
        else case when o.status='encerrada' then 1 else 0 end end,
      case when modo='prazo_proximo' then public.matching_prazo_v1(o.participacao_prazo_limite,o.data_abertura) end asc nulls last,
      case when isfinite(o.data_publicacao) then o.data_publicacao end desc nulls last, o.id;
    return;
  end if;
  return query
  with elegiveis as materialized (
    select o.id, o.status,
      case when o.status='encerrada' or (isfinite(o.participacao_prazo_limite) and o.participacao_prazo_limite<=statement_timestamp()) then 1 else 0 end historica,
      case when isfinite(o.data_publicacao) then o.data_publicacao end data_publicacao,
      case when modo='prazo_proximo' then public.matching_prazo_v1(o.participacao_prazo_limite,o.data_abertura) end prazo,
      case o.status when 'aberta' then 0 when 'em_analise' then 1 else 2 end prioridade,
      case when o.status = 'encerrada' then 1 else 0 end encerrada,
      case when nivel is not null or modo in ('recomendadas','maior_aderencia')
        then public.matching_score_v1(palavras_score,segmento_score,uf_score,uf_score_valida,o.matching_tokens,o.uf) end score
    from public.oportunidades_editais o
    where (visao='todas' or (visao='historico' and
          (o.status='encerrada' or (isfinite(o.participacao_prazo_limite) and o.participacao_prazo_limite<=statement_timestamp())))
        or (visao='ativas' and o.status is distinct from 'encerrada' and
          (o.participacao_prazo_limite is null or not isfinite(o.participacao_prazo_limite) or o.participacao_prazo_limite>statement_timestamp())))
        and public.plano_historico_visivel_v1(plano_codigo,o.status,o.participacao_prazo_limite,o.data_publicacao)
        and (nullif(p_status,'') is null or o.status = p_status)
      and (uf_filtro is null or o.uf = uf_filtro)
      and (termo is null or (o.busca_documento ilike padrao escape E'\\' and
        (o.titulo ilike padrao escape E'\\' or o.orgao ilike padrao escape E'\\' or
         o.modalidade ilike padrao escape E'\\' or o.cidade ilike padrao escape E'\\' or o.objeto ilike padrao escape E'\\')))
  ), pagina as materialized (
    select e.*, row_number() over (order by
      case when modo = 'recomendadas' then e.historica end,
      case when modo = 'recomendadas' then e.prioridade end,
      case when modo in ('mais_novas','prazo_proximo') then e.encerrada end,
      case when modo in ('recomendadas','maior_aderencia') then e.score end desc nulls last,
      case when modo = 'maior_aderencia' then e.encerrada end,
      case when modo = 'prazo_proximo' then e.prazo end asc nulls last,
      e.data_publicacao desc nulls last, e.id) posicao
    from elegiveis e
    where nivel is null or (case when e.score >= 70 then 'alta' when e.score >= 40 then 'media' else 'baixa' end) = nivel
    order by posicao
    limit 21 offset ((greatest(coalesce(p_pagina,1),1)::bigint - 1) * 20)
  )
  select jsonb_build_object('id',o.id,'codigo',o.codigo,'origem',o.origem,'tipo',o.tipo,
      'titulo',o.titulo,'orgao',o.orgao,'modalidade',o.modalidade,'uf',o.uf,'cidade',o.cidade,
      'objeto',o.objeto,'valorEstimado',o.valor_estimado,'dataPublicacao',case when isfinite(o.data_publicacao) then o.data_publicacao end,
      'dataAbertura',case when isfinite(o.data_abertura) then o.data_abertura end,'status',o.status,'tags',o.tags,
      'situacaoOperacional',public.oportunidade_situacao_v1(o.status,o.participacao_prazo_limite,statement_timestamp())),
    case when public.plano_tem_score_v1(p_perfil_id,o.id) then public.matching_calcular_v1(perfil,o.matching_tokens,o.uf) else null end,
    exists(select 1 from public.oportunidades_favoritos f where f.usuario_id = auth.uid() and f.oportunidade_id = p.id)
  from pagina p join public.oportunidades_editais o on o.id = p.id
  order by p.posicao;
end;
$$;

-- A RPC de detalhe não consome cota. Só retorna score previamente desbloqueado.
create or replace function public.calcular_match_oportunidade_v1(p_perfil_id uuid,p_oportunidade_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare perfil jsonb := public.matching_perfil_autorizado_v1(p_perfil_id); resultado jsonb;
begin
  if perfil is null or not public.plano_tem_score_v1(p_perfil_id,p_oportunidade_id) then return null; end if;
  select public.matching_calcular_v1(perfil,o.matching_tokens,o.uf) into resultado
  from public.oportunidades_editais o where o.id=p_oportunidade_id
    and public.plano_historico_visivel_v1(public.plano_atual_v1(),o.status,
      o.participacao_prazo_limite,o.data_publicacao);
  return resultado;
end; $$;

-- Helpers que entregam score/perfil preparado não são API pública de usuário.
revoke execute on function public.matching_calcular_v1(jsonb,text[],text) from authenticated;
revoke execute on function public.matching_preparar_v1(text[],text,text) from authenticated;
revoke execute on function public.matching_preparar_score_v1(jsonb) from authenticated;
revoke execute on function public.matching_perfil_autorizado_v1(uuid) from authenticated;
revoke execute on function public.matching_score_v1(text[],text[],text,boolean,text[],text) from authenticated;

commit;
