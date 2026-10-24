-- Etapa 2: aplicar após analises_ia_execucoes_v1.sql, somente após homologação.
-- Mantém reservas, tokens, locks, ciclo, reconciliação e consumo da Etapa 1.
begin;
set local lock_timeout = '5s';

create function public.ia_texto_valido_v2(v jsonb, limite integer) returns boolean
language sql immutable set search_path=pg_catalog as $$
  select coalesce(jsonb_typeof(v)='string' and length(v#>>'{}') between 1 and limite
    and (v#>>'{}') ~ '[^[:space:]]',false);
$$;
create function public.ia_resultado_valido_v2(v jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog as $$
declare p jsonb;
begin
  if v is null or jsonb_typeof(v)<>'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(v))<>5
    or not public.ia_texto_valido_v2(v->'resumo',800)
    or not public.ia_texto_valido_v2(v->'compatibilidade_empresa',800)
    or not public.ia_texto_valido_v2(v->'proximo_passo',400)
    or jsonb_typeof(v->'pontos_atencao') is distinct from 'array'
    or jsonb_typeof(v->'informacoes_nao_verificadas') is distinct from 'array' then return false; end if;
  if jsonb_array_length(v->'pontos_atencao')>5 or jsonb_array_length(v->'informacoes_nao_verificadas')>3 then return false; end if;
  for p in select value from jsonb_array_elements(v->'pontos_atencao') loop
    if jsonb_typeof(p)<>'object' then return false; end if;
    if (select count(*) from jsonb_object_keys(p))<>4
      or not public.ia_texto_valido_v2(p->'titulo',100)
      or not public.ia_texto_valido_v2(p->'explicacao',400)
      or not public.ia_texto_valido_v2(p->'acao_recomendada',300)
      or jsonb_typeof(p->'classificacao') is distinct from 'string'
      or coalesce(p->>'classificacao','') not in ('fato_identificado','informacao_a_confirmar') then return false; end if;
  end loop;
  for p in select value from jsonb_array_elements(v->'informacoes_nao_verificadas') loop
    if not public.ia_texto_valido_v2(p,250) then return false; end if;
  end loop;
  return true;
end; $$;
revoke all on function public.ia_texto_valido_v2(jsonb,integer),public.ia_resultado_valido_v2(jsonb) from public,anon,authenticated,service_role;

alter table public.ia_resultados_v1
  add column versao_schema integer not null default 1,
  add column conteudo jsonb,
  alter column score drop not null,
  alter column justificativa drop not null,
  alter column pontos_atencao drop not null;
alter table public.ia_resultados_v1 add constraint ia_resultado_schema_v2 check (
  (versao_schema=1 and score is not null and justificativa is not null and pontos_atencao is not null and conteudo is null)
  or (versao_schema=2 and score is null and justificativa is null and pontos_atencao is null
    and public.ia_resultado_valido_v2(conteudo) and resumo=conteudo->>'resumo')
);

create or replace function public.ia_finalizar_v1(p_usuario uuid,p_execucao uuid,p_token uuid,p_resultado jsonb,
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

commit;
