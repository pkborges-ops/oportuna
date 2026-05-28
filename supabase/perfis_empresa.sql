-- Execute no Supabase em SQL Editor > New query.
-- Este script cria a tabela de perfis e limita cada usuario aos proprios dados.

create extension if not exists pgcrypto;

create table if not exists public.perfis_empresa (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  nome_empresa text not null,
  cnpj text not null,
  segmento text not null,
  porte text not null check (porte in ('MEI', 'ME', 'EPP', 'Media', 'Grande')),
  uf char(2) not null,
  palavras_chave text[] not null default '{}',
  status text not null default 'ativo' check (status in ('ativo', 'inativo')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint perfis_empresa_usuario_cnpj_unique unique (usuario_id, cnpj)
);

create index if not exists perfis_empresa_usuario_id_idx
  on public.perfis_empresa (usuario_id);

create or replace function public.atualizar_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

drop trigger if exists perfis_empresa_atualizado_em on public.perfis_empresa;

create trigger perfis_empresa_atualizado_em
before update on public.perfis_empresa
for each row
execute function public.atualizar_atualizado_em();

alter table public.perfis_empresa enable row level security;

drop policy if exists "Usuarios leem seus perfis" on public.perfis_empresa;
drop policy if exists "Usuarios criam seus perfis" on public.perfis_empresa;
drop policy if exists "Usuarios atualizam seus perfis" on public.perfis_empresa;
drop policy if exists "Usuarios excluem seus perfis" on public.perfis_empresa;

create policy "Usuarios leem seus perfis"
on public.perfis_empresa
for select
to authenticated
using (usuario_id = auth.uid());

create policy "Usuarios criam seus perfis"
on public.perfis_empresa
for insert
to authenticated
with check (usuario_id = auth.uid());

create policy "Usuarios atualizam seus perfis"
on public.perfis_empresa
for update
to authenticated
using (usuario_id = auth.uid())
with check (usuario_id = auth.uid());

create policy "Usuarios excluem seus perfis"
on public.perfis_empresa
for delete
to authenticated
using (usuario_id = auth.uid());
