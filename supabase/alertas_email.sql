-- Execute no Supabase em SQL Editor > New query.
-- Regras de alerta por perfil e historico de oportunidades enviadas.

create extension if not exists pgcrypto;

create table if not exists public.alertas_perfis (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  perfil_id uuid not null references public.perfis_empresa(id) on delete cascade,
  email_destino text not null,
  frequencia text not null default 'diaria' check (frequencia in ('diaria', 'semanal')),
  score_minimo integer not null default 75 check (score_minimo between 0 and 100),
  ativo boolean not null default false,
  ultima_execucao_em timestamptz,
  ultima_quantidade_considerada integer not null default 0,
  ultima_quantidade_enviada integer not null default 0,
  ultimo_status text not null default 'nunca_executado'
    check (ultimo_status in ('nunca_executado', 'simulado', 'enviado', 'sem_oportunidades', 'erro')),
  ultimo_erro text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint alertas_perfis_usuario_perfil_unique unique (usuario_id, perfil_id)
);

create table if not exists public.alertas_envios (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  alerta_id uuid references public.alertas_perfis(id) on delete set null,
  perfil_id uuid not null references public.perfis_empresa(id) on delete cascade,
  oportunidade_id uuid not null references public.oportunidades_editais(id) on delete cascade,
  analise_id uuid references public.analises_oportunidades(id) on delete set null,
  titulo_oportunidade text not null,
  score integer not null check (score between 0 and 100),
  status text not null check (status in ('simulado', 'enviado', 'erro')),
  assunto text not null,
  detalhes text,
  enviado_em timestamptz not null default now(),
  criado_em timestamptz not null default now(),
  constraint alertas_envios_usuario_perfil_oportunidade_unique unique (
    usuario_id,
    perfil_id,
    oportunidade_id
  )
);

create index if not exists alertas_perfis_usuario_idx
  on public.alertas_perfis (usuario_id);

create index if not exists alertas_perfis_perfil_idx
  on public.alertas_perfis (perfil_id);

create index if not exists alertas_envios_usuario_idx
  on public.alertas_envios (usuario_id);

create index if not exists alertas_envios_perfil_idx
  on public.alertas_envios (perfil_id);

create index if not exists alertas_envios_enviado_em_idx
  on public.alertas_envios (enviado_em desc);

create or replace function public.atualizar_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

drop trigger if exists alertas_perfis_atualizado_em on public.alertas_perfis;

create trigger alertas_perfis_atualizado_em
before update on public.alertas_perfis
for each row
execute function public.atualizar_atualizado_em();

alter table public.alertas_perfis enable row level security;
alter table public.alertas_envios enable row level security;

drop policy if exists "Usuarios leem seus alertas" on public.alertas_perfis;
drop policy if exists "Usuarios criam seus alertas" on public.alertas_perfis;
drop policy if exists "Usuarios atualizam seus alertas" on public.alertas_perfis;
drop policy if exists "Usuarios excluem seus alertas" on public.alertas_perfis;
drop policy if exists "Usuarios leem historico de alertas" on public.alertas_envios;
drop policy if exists "Usuarios criam historico de alertas" on public.alertas_envios;

create policy "Usuarios leem seus alertas"
on public.alertas_perfis
for select
to authenticated
using (usuario_id = auth.uid());

create policy "Usuarios criam seus alertas"
on public.alertas_perfis
for insert
to authenticated
with check (usuario_id = auth.uid());

create policy "Usuarios atualizam seus alertas"
on public.alertas_perfis
for update
to authenticated
using (usuario_id = auth.uid())
with check (usuario_id = auth.uid());

create policy "Usuarios excluem seus alertas"
on public.alertas_perfis
for delete
to authenticated
using (usuario_id = auth.uid());

create policy "Usuarios leem historico de alertas"
on public.alertas_envios
for select
to authenticated
using (usuario_id = auth.uid());

create policy "Usuarios criam historico de alertas"
on public.alertas_envios
for insert
to authenticated
with check (usuario_id = auth.uid());
