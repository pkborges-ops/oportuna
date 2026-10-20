-- MANUAL: aplicar em homologacao e validar antes de qualquer uso em producao.
-- Requer oportunidades_ciclo_vida_v1.sql; preserva RLS e o contrato JSON da RPC.
begin;
set local lock_timeout = '5s';

create or replace function public.resumo_oportunidades_ativas_v1()
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog
as $$
declare resultado jsonb;
begin
  if auth.uid() is null then raise exception 'Não autorizado' using errcode='42501'; end if;

  with visiveis as materialized (
    select o.id, o.status, o.participacao_prazo_limite, o.data_publicacao
    from public.oportunidades_editais o
  ), contagem as (
    select count(*) filter (where status is distinct from 'encerrada' and
      (participacao_prazo_limite is null or not isfinite(participacao_prazo_limite) or
       participacao_prazo_limite > statement_timestamp())) as total,
      count(*) as total_base
    from visiveis
  ), proxima_id as (
    select v.id from visiveis v
    where v.status is distinct from 'encerrada' and
      (v.participacao_prazo_limite is null or not isfinite(v.participacao_prazo_limite) or
       v.participacao_prazo_limite > statement_timestamp())
    order by (v.participacao_prazo_limite is null or not isfinite(v.participacao_prazo_limite)),
      v.participacao_prazo_limite asc nulls last,
      v.data_publicacao desc nulls last, v.id
    limit 1
  )
  select jsonb_build_object('total', c.total, 'totalBase', c.total_base, 'proxima', (
    select jsonb_build_object('id',o.id,'titulo',o.titulo,'orgao',o.orgao,'cidade',o.cidade,
      'uf',o.uf,'objeto',o.objeto,'valorEstimado',o.valor_estimado,
      'dataAbertura',case when isfinite(o.data_abertura) then o.data_abertura end,
      'situacaoOperacional',public.oportunidade_situacao_v1(o.status,o.participacao_prazo_limite,
        statement_timestamp()))
    from proxima_id p join public.oportunidades_editais o on o.id=p.id
  )) into resultado from contagem c;

  return resultado;
end;
$$;

commit;
