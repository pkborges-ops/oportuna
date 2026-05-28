-- Execute no Supabase em SQL Editor > New query.
-- Campos opcionais para orientar o proximo passo de participacao na licitacao.

alter table public.oportunidades_editais
  add column if not exists participacao_portal text,
  add column if not exists participacao_url text,
  add column if not exists participacao_forma text,
  add column if not exists participacao_prazo_limite timestamptz,
  add column if not exists participacao_observacoes text;

-- Popule apenas com dados confirmados no edital ou anexos.
-- update public.oportunidades_editais
-- set
--   participacao_portal = 'Nome do portal confirmado',
--   participacao_url = 'https://...',
--   participacao_forma = 'Envio eletrônico de proposta',
--   participacao_prazo_limite = '2026-06-12 09:00:00-03',
--   participacao_observacoes = 'Credenciamento prévio exigido no portal.'
-- where codigo = 'codigo-confirmado';
