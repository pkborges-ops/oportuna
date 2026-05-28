-- Execute no Supabase em SQL Editor > New query.
-- Cada analise pertence ao usuario, ao perfil usado e a oportunidade analisada.

create extension if not exists pgcrypto;

create table if not exists public.analises_oportunidades (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  oportunidade_id uuid not null references public.oportunidades_editais(id) on delete cascade,
  perfil_id uuid not null references public.perfis_empresa(id) on delete cascade,
  score integer not null check (score between 0 and 100),
  justificativa text not null,
  resumo text not null,
  pontos_atencao text[] not null default '{}',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint analises_oportunidades_unica unique (
    usuario_id,
    oportunidade_id,
    perfil_id
  )
);

create index if not exists analises_oportunidades_usuario_idx
  on public.analises_oportunidades (usuario_id);

create index if not exists analises_oportunidades_oportunidade_idx
  on public.analises_oportunidades (oportunidade_id);

create or replace function public.atualizar_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

drop trigger if exists analises_oportunidades_atualizado_em
on public.analises_oportunidades;

create trigger analises_oportunidades_atualizado_em
before update on public.analises_oportunidades
for each row
execute function public.atualizar_atualizado_em();

alter table public.analises_oportunidades enable row level security;

drop policy if exists "Usuarios leem suas analises" on public.analises_oportunidades;
drop policy if exists "Usuarios criam suas analises" on public.analises_oportunidades;
drop policy if exists "Usuarios atualizam suas analises" on public.analises_oportunidades;
drop policy if exists "Usuarios excluem suas analises" on public.analises_oportunidades;

create policy "Usuarios leem suas analises"
on public.analises_oportunidades
for select
to authenticated
using (usuario_id = auth.uid());

create policy "Usuarios criam suas analises"
on public.analises_oportunidades
for insert
to authenticated
with check (usuario_id = auth.uid());

create policy "Usuarios atualizam suas analises"
on public.analises_oportunidades
for update
to authenticated
using (usuario_id = auth.uid())
with check (usuario_id = auth.uid());

create policy "Usuarios excluem suas analises"
on public.analises_oportunidades
for delete
to authenticated
using (usuario_id = auth.uid());
