-- MANUAL: somente projeto Supabase de homologação. Não reexecutar a migration.
-- Score scalar global e detalhes completos somente nos 21 itens selecionados.
-- Índices e dados não mudam. Execute tudo na mesma consulta/transação.
begin;
set local lock_timeout='5s';
create or replace function public.matching_score_v1(perfil jsonb, tokens text[], uf text)
returns integer language plpgsql immutable parallel safe set search_path = pg_catalog
as $$
declare
  palavra jsonb; termo text; encontrou boolean;
  total_palavras integer := jsonb_array_length(perfil->'palavras');
  total_segmento integer := jsonb_array_length(perfil->'segmento');
  qtd_palavras integer := 0; qtd_segmento integer := 0;
  mesma_uf boolean := (perfil->>'uf') ~ '^[A-Z]{2}$' and
    perfil->>'uf' = public.matching_upper_v1(public.matching_trim_v1(coalesce(uf,'')));
  pontos double precision := 0;
begin
  for palavra in select value from jsonb_array_elements(perfil->'palavras') loop
    encontrou := true;
    for termo in select jsonb_array_elements_text(palavra->'termos') loop
      if not (termo = any(coalesce(tokens,'{}'))) then encontrou := false; exit; end if;
    end loop;
    if encontrou then qtd_palavras := qtd_palavras + 1; end if;
  end loop;
  for termo in select jsonb_array_elements_text(perfil->'segmento') loop
    if termo = any(coalesce(tokens,'{}')) then qtd_segmento := qtd_segmento + 1; end if;
  end loop;
  if total_palavras > 0 then pontos := (65::double precision * qtd_palavras) / total_palavras; end if;
  if total_segmento > 0 then
    pontos := pontos + ((case when total_palavras > 0 then 25 else 90 end)::double precision * qtd_segmento) / total_segmento;
  end if;
  pontos := pontos + (case when mesma_uf then 10 else 0 end);
  return greatest(0, least(100, floor(pontos)::integer +
    case when pontos - floor(pontos) >= 0.5 then 1 else 0 end));
end;
$$;
create or replace function public.listar_oportunidades_paginadas_v1(
  p_perfil_id uuid default null, p_busca text default null, p_status text default null,
  p_uf text default null, p_aderencia text default null, p_ordenacao text default 'recomendadas',
  p_pagina integer default 1
)
returns table (oportunidade jsonb, match jsonb, favorito boolean)
language plpgsql stable security invoker set search_path = pg_catalog
as $$
declare
  perfil jsonb := public.matching_perfil_autorizado_v1(p_perfil_id);
  modo text := coalesce(p_ordenacao,'recomendadas');
  termo text := nullif(public.matching_trim_v1(p_busca),'');
  padrao text;
  uf_filtro text := nullif(upper(public.matching_trim_v1(p_uf)), '');
  nivel text := case when perfil is null then null else nullif(p_aderencia,'') end;
begin
  if modo not in ('recomendadas','mais_novas','maior_aderencia','prazo_proximo') then modo := 'recomendadas'; end if;
  if perfil is null and modo = 'maior_aderencia' then modo := 'recomendadas'; end if;
  if nullif(p_status,'') is not null and p_status not in ('aberta','em_analise','encerrada') then raise exception 'Status inválido'; end if;
  if nivel is not null and nivel not in ('alta','media','baixa') then raise exception 'Aderência inválida'; end if;
  -- Escape de barra primeiro; % e _ são literais. Sem SQL dinâmico.
  padrao := '%' || replace(replace(replace(termo, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';
  -- Sem perfil, não materializar a base inteira nem avaliar matcher.
  if perfil is null then
    return query
    with pagina as materialized (
      select o.* from public.oportunidades_editais o
      where (nullif(p_status,'') is null or o.status = p_status)
        and (uf_filtro is null or o.uf = uf_filtro)
        and (termo is null or (o.busca_documento ilike padrao escape E'\\' and
          (o.titulo ilike padrao escape E'\\' or o.orgao ilike padrao escape E'\\' or
           o.modalidade ilike padrao escape E'\\' or o.cidade ilike padrao escape E'\\' or o.objeto ilike padrao escape E'\\')))
      order by
        case when modo='recomendadas' then case o.status when 'aberta' then 0 when 'em_analise' then 1 else 2 end
          else case when o.status='encerrada' then 1 else 0 end end,
        case when modo='prazo_proximo' then public.matching_prazo_v1(o.participacao_prazo_limite,o.data_abertura) end asc nulls last,
        case when isfinite(o.data_publicacao) then o.data_publicacao end desc nulls last, o.id
      limit 21 offset ((greatest(coalesce(p_pagina,1),1)::bigint - 1) * 20)
    )
    select jsonb_build_object('id',o.id,'codigo',o.codigo,'origem',o.origem,'tipo',o.tipo,
      'titulo',o.titulo,'orgao',o.orgao,'modalidade',o.modalidade,'uf',o.uf,'cidade',o.cidade,
      'objeto',o.objeto,'valorEstimado',o.valor_estimado,'dataPublicacao',case when isfinite(o.data_publicacao) then o.data_publicacao end,
      'dataAbertura',case when isfinite(o.data_abertura) then o.data_abertura end,'status',o.status,'tags',o.tags), null::jsonb,
      exists(select 1 from public.oportunidades_favoritos f where f.usuario_id=auth.uid() and f.oportunidade_id=o.id)
    from pagina o order by
      case when modo='recomendadas' then case o.status when 'aberta' then 0 when 'em_analise' then 1 else 2 end
        else case when o.status='encerrada' then 1 else 0 end end,
      case when modo='prazo_proximo' then public.matching_prazo_v1(o.participacao_prazo_limite,o.data_abertura) end asc nulls last,
      case when isfinite(o.data_publicacao) then o.data_publicacao end desc nulls last, o.id;
    return;
  end if;
  return query
  with elegiveis as materialized (
    select o.id, o.status, case when isfinite(o.data_publicacao) then o.data_publicacao end data_publicacao,
      case when modo='prazo_proximo' then public.matching_prazo_v1(o.participacao_prazo_limite,o.data_abertura) end prazo,
      case o.status when 'aberta' then 0 when 'em_analise' then 1 else 2 end prioridade,
      case when o.status = 'encerrada' then 1 else 0 end encerrada,
      case when nivel is not null or modo in ('recomendadas','maior_aderencia')
        then public.matching_score_v1(perfil, o.matching_tokens, o.uf) end score
    from public.oportunidades_editais o
    where (nullif(p_status,'') is null or o.status = p_status)
      and (uf_filtro is null or o.uf = uf_filtro)
      and (termo is null or (o.busca_documento ilike padrao escape E'\\' and
        (o.titulo ilike padrao escape E'\\' or o.orgao ilike padrao escape E'\\' or
         o.modalidade ilike padrao escape E'\\' or o.cidade ilike padrao escape E'\\' or o.objeto ilike padrao escape E'\\')))
  ), pagina as materialized (
    select e.*, row_number() over (order by
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
      'dataAbertura',case when isfinite(o.data_abertura) then o.data_abertura end,'status',o.status,'tags',o.tags),
    case when perfil is null then null else public.matching_calcular_v1(perfil,o.matching_tokens,o.uf) end,
    exists(select 1 from public.oportunidades_favoritos f where f.usuario_id = auth.uid() and f.oportunidade_id = p.id)
  from pagina p join public.oportunidades_editais o on o.id = p.id
  order by p.posicao;
end;
$$;
revoke all on function public.matching_score_v1(jsonb,text[],text) from public,anon;
grant execute on function public.matching_score_v1(jsonb,text[],text) to authenticated;
commit;
