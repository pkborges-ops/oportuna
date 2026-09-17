-- Migration 1: compatibilidade durante o deploy, após oportunidades_editais.sql.
-- Manter o default temporário até validar o novo sincronizador em produção.
-- Revisar antes de executar. Não é aplicada automaticamente pela aplicação.
begin;

set local lock_timeout = '5s';

alter table public.oportunidades_editais
  add column origem text default 'PNCP'
    constraint oportunidades_editais_origem_check
    check (origem in ('PNCP', 'SICX', 'OUTRA')),
  add column tipo text not null default 'OUTRO'
    constraint oportunidades_editais_tipo_check
    check (tipo in (
      'LICITACAO', 'CREDENCIAMENTO', 'CONTRATACAO_DIRETA',
      'COMPRA_EXPRESSA', 'OUTRO'
    ));

-- Apenas caixa, espaços e separadores; nunca inferir por título ou objeto.
-- Mesmos nomes/aliases de lib/oportunidades/classificar-pncp.ts.
with normalizadas as (
  select id, regexp_replace(
    btrim(regexp_replace(lower(modalidade), '[[:space:]]+', ' ', 'g')),
    '[[:space:]]*[-–—][[:space:]]*', '-', 'g'
  ) as nome
  from public.oportunidades_editais
)
update public.oportunidades_editais as oportunidade
set origem = 'PNCP',
    tipo = case
      when normalizadas.nome in (
        'leilão-eletrônico', 'leilão-presencial',
        'diálogo competitivo', 'concurso',
        'concorrência-eletrônica', 'concorrência-presencial',
        'pregão-eletrônico', 'pregão-presencial',
        'concorrência-eletrônica internacional',
        'concorrência-presencial internacional',
        'pregão-eletrônico internacional',
        'pregão-presencial internacional'
      ) then 'LICITACAO'
      when normalizadas.nome in (
        'dispensa', 'dispensa de licitação', 'inexigibilidade'
      ) then 'CONTRATACAO_DIRETA'
      when normalizadas.nome = 'credenciamento' then 'CREDENCIAMENTO'
      else 'OUTRO'
    end
from normalizadas
where oportunidade.id = normalizadas.id;

alter table public.oportunidades_editais
  alter column origem set not null;

commit;
