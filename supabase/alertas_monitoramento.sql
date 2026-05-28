-- Execute no Supabase em SQL Editor > New query.
-- Rastreia quantos alertas foram efetivamente enviados no ultimo processamento.

alter table public.alertas_perfis
  add column if not exists ultima_quantidade_enviada integer not null default 0;
