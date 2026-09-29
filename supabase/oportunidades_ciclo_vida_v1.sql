-- MANUAL: revisar e testar em homologação antes de produção.
-- Requer oportunidades_paginadas_v1.sql. Não modifica a RPC V1 nem seus helpers.
-- Nenhuma exclusão/update de dados, job ou coluna dependente de relógio.
begin;
set local lock_timeout = '5s';

create or replace function public.oportunidade_situacao_v1(
  p_status text, p_prazo timestamptz, p_agora timestamptz
) returns text language sql immutable parallel safe security invoker
set search_path=pg_catalog
as $$ select case
  when p_status='encerrada' then 'encerrada'
  when p_prazo is null or not isfinite(p_prazo) then 'indeterminada'
  when p_prazo <= p_agora then 'encerrada'
  else 'ativa' end; $$;

-- RLS das tabelas permanece aplicada ao usuário que consulta a view.
-- O tempo pertence ao snapshot da consulta, não a um status gravado no banco.
create or replace view public.oportunidades_ciclo_vida_v1
with (security_invoker=true) as
select o.*, public.oportunidade_situacao_v1(o.status,o.participacao_prazo_limite,
  statement_timestamp()) as situacao_operacional
from public.oportunidades_editais o;
revoke all on public.oportunidades_ciclo_vida_v1 from public,anon;
grant select on public.oportunidades_ciclo_vida_v1 to authenticated;

create or replace function public.listar_oportunidades_paginadas_v2(
  p_perfil_id uuid default null, p_busca text default null, p_status text default null,
  p_uf text default null, p_aderencia text default null, p_ordenacao text default 'recomendadas',
  p_pagina integer default 1, p_visao text default 'ativas'
)
returns table (oportunidade jsonb, match jsonb, favorito boolean)
language plpgsql stable security invoker set search_path = pg_catalog
as $$
declare
  visao text := coalesce(p_visao,'ativas');
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
    case when perfil is null then null else public.matching_calcular_v1(perfil,o.matching_tokens,o.uf) end,
    exists(select 1 from public.oportunidades_favoritos f where f.usuario_id = auth.uid() and f.oportunidade_id = p.id)
  from pagina p join public.oportunidades_editais o on o.id = p.id
  order by p.posicao;
end;
$$;

create or replace function public.resumo_oportunidades_ativas_v1()
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog
as $$
declare resultado jsonb;
begin
  if auth.uid() is null then raise exception 'Não autorizado' using errcode='42501'; end if;
  select jsonb_build_object('total',count(*) filter(where status is distinct from 'encerrada' and
      (participacao_prazo_limite is null or not isfinite(participacao_prazo_limite) or participacao_prazo_limite>statement_timestamp())),
    'totalBase',count(*),'proxima',(
      select jsonb_build_object('id',o.id,'titulo',o.titulo,'orgao',o.orgao,'cidade',o.cidade,
        'uf',o.uf,'objeto',o.objeto,'valorEstimado',o.valor_estimado,
        'dataAbertura',case when isfinite(o.data_abertura) then o.data_abertura end,
        'situacaoOperacional',public.oportunidade_situacao_v1(o.status,o.participacao_prazo_limite,statement_timestamp()))
      from public.oportunidades_editais o where o.status is distinct from 'encerrada' and
        (o.participacao_prazo_limite is null or not isfinite(o.participacao_prazo_limite) or o.participacao_prazo_limite>statement_timestamp())
      order by (o.participacao_prazo_limite is null or not isfinite(o.participacao_prazo_limite)),
        o.participacao_prazo_limite asc nulls last,
        o.data_publicacao desc nulls last,o.id limit 1
    )) into resultado from public.oportunidades_editais;
  return resultado;
end;
$$;

revoke all on function public.oportunidade_situacao_v1(text,timestamptz,timestamptz) from public,anon;
grant execute on function public.oportunidade_situacao_v1(text,timestamptz,timestamptz) to authenticated;
revoke all on function public.listar_oportunidades_paginadas_v2(uuid,text,text,text,text,text,integer,text) from public,anon;
grant execute on function public.listar_oportunidades_paginadas_v2(uuid,text,text,text,text,text,integer,text) to authenticated;
revoke all on function public.resumo_oportunidades_ativas_v1() from public,anon;
grant execute on function public.resumo_oportunidades_ativas_v1() to authenticated;
commit;
