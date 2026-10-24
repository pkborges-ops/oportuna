-- Aplicar somente em homologacao antes de validar EXPLAIN, RLS e HTTP.
-- Mantem a regra de 30 dias do Free e o historico integral de Pro/Business.
begin;
set local lock_timeout = '5s';

alter policy "Usuarios autenticados leem oportunidades"
on public.oportunidades_editais
using (
  (select auth.uid()) is not null
  and (
    (select public.plano_pago_v1(public.plano_atual_v1()))
    or case
      when status = 'encerrada'
        or (coalesce(isfinite(participacao_prazo_limite), false)
          and participacao_prazo_limite <= now())
      then coalesce(
        case when isfinite(participacao_prazo_limite)
          then (participacao_prazo_limite at time zone 'America/Sao_Paulo')::date end,
        case when isfinite(data_publicacao) then data_publicacao end
      ) >= (select (now() at time zone 'America/Sao_Paulo')::date - 30)
      else true
    end
  )
);

commit;
