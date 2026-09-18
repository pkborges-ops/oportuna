-- Aplicação MANUAL antes de ativar o cron nacional. Não altera oportunidades_editais.
begin;
set local lock_timeout = '5s';
create table if not exists public.sincronizacao_pncp_checkpoints (
  modalidade_id integer primary key check (modalidade_id in (4, 6, 8, 12)),
  modalidade_nome text not null,
  pagina_proxima integer not null default 1 check (pagina_proxima >= 1),
  data_final_ciclo text not null check (data_final_ciclo ~ '^[0-9]{8}$'),
  ciclo_concluido boolean not null default false,
  atualizado_em timestamptz not null default now(),
  ultima_tentativa_em timestamptz,
  reserva_token uuid,
  reservado_ate timestamptz,
  check ((reserva_token is null) = (reservado_ate is null))
);
alter table public.sincronizacao_pncp_checkpoints enable row level security;
revoke all on public.sincronizacao_pncp_checkpoints from anon, authenticated;
grant select, update, insert on public.sincronizacao_pncp_checkpoints to service_role;
insert into public.sincronizacao_pncp_checkpoints (modalidade_id, modalidade_nome, data_final_ciclo)
values (6, 'Pregão - Eletrônico', to_char(current_date, 'YYYYMMDD')),
       (4, 'Concorrência - Eletrônica', to_char(current_date, 'YYYYMMDD')),
       (8, 'Dispensa', to_char(current_date, 'YYYYMMDD')),
       (12, 'Credenciamento', to_char(current_date, 'YYYYMMDD'))
on conflict (modalidade_id) do nothing;

-- A tentativa muda ANTES da consulta para uma modalidade com falha não monopolizar o cron.
-- Reserva por 90s > maxDuration 60s; token impede atualização de uma reserva substituída.
create or replace function public.reservar_lote_pncp(nova_data_final text)
returns setof public.sincronizacao_pncp_checkpoints
language plpgsql security invoker set search_path = public as $$
declare escolhido integer;
begin
  if nova_data_final is null or nova_data_final !~ '^[0-9]{8}$' then
    raise exception 'Data inválida';
  end if;
  select modalidade_id into escolhido
  from public.sincronizacao_pncp_checkpoints
  where reservado_ate is null or reservado_ate < clock_timestamp()
  order by ultima_tentativa_em asc nulls first, modalidade_id
  limit 1 for update skip locked;
  if escolhido is null then return; end if;
  return query update public.sincronizacao_pncp_checkpoints
  set pagina_proxima = case when ciclo_concluido then 1 else pagina_proxima end,
      data_final_ciclo = case when ciclo_concluido or ultima_tentativa_em is null
        then nova_data_final else data_final_ciclo end,
      ciclo_concluido = false,
      ultima_tentativa_em = clock_timestamp(),
      reserva_token = gen_random_uuid(),
      reservado_ate = clock_timestamp() + interval '90 seconds'
  where modalidade_id = escolhido returning *;
end;
$$;
revoke all on function public.reservar_lote_pncp(text) from public, anon, authenticated;
grant execute on function public.reservar_lote_pncp(text) to service_role;
commit;
