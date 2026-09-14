-- Execute no Supabase em SQL Editor > New query.
-- Oportunidades ficam disponiveis para usuarios autenticados; favoritos sao privados por usuario.

create extension if not exists pgcrypto;

create table if not exists public.oportunidades_editais (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  titulo text not null,
  orgao text not null,
  modalidade text not null,
  uf char(2) not null,
  cidade text not null,
  objeto text not null,
  valor_estimado numeric(14, 2) not null default 0,
  data_publicacao date not null,
  data_abertura date not null,
  status text not null check (status in ('aberta', 'em_analise', 'encerrada')),
  tags text[] not null default '{}',
  score integer check (score between 0 and 100),
  analise_resumo text,
  analise_pontos_fortes text[] not null default '{}',
  analise_riscos text[] not null default '{}',
  analise_recomendacao text,
  participacao_portal text,
  participacao_url text,
  participacao_forma text,
  participacao_prazo_limite timestamptz,
  participacao_observacoes text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.oportunidades_favoritos (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  oportunidade_id uuid not null references public.oportunidades_editais(id) on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (usuario_id, oportunidade_id)
);

create index if not exists oportunidades_editais_status_idx
  on public.oportunidades_editais (status);

create index if not exists oportunidades_editais_data_abertura_idx
  on public.oportunidades_editais (data_abertura);

create index if not exists oportunidades_favoritos_usuario_idx
  on public.oportunidades_favoritos (usuario_id);

create or replace function public.atualizar_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

drop trigger if exists oportunidades_editais_atualizado_em on public.oportunidades_editais;

create trigger oportunidades_editais_atualizado_em
before update on public.oportunidades_editais
for each row
execute function public.atualizar_atualizado_em();

alter table public.oportunidades_editais enable row level security;
alter table public.oportunidades_favoritos enable row level security;

drop policy if exists "Usuarios autenticados leem oportunidades" on public.oportunidades_editais;
drop policy if exists "Usuarios leem seus favoritos" on public.oportunidades_favoritos;
drop policy if exists "Usuarios criam seus favoritos" on public.oportunidades_favoritos;
drop policy if exists "Usuarios excluem seus favoritos" on public.oportunidades_favoritos;

create policy "Usuarios autenticados leem oportunidades"
on public.oportunidades_editais
for select
to authenticated
using (true);

create policy "Usuarios leem seus favoritos"
on public.oportunidades_favoritos
for select
to authenticated
using (usuario_id = auth.uid());

create policy "Usuarios criam seus favoritos"
on public.oportunidades_favoritos
for insert
to authenticated
with check (usuario_id = auth.uid());

create policy "Usuarios excluem seus favoritos"
on public.oportunidades_favoritos
for delete
to authenticated
using (usuario_id = auth.uid());
