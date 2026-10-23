-- SOMENTE cluster descartável. Emula Auth e contrato mínimo das migrations prévias.
\set ON_ERROR_STOP on
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema public,auth to anon,authenticated,service_role;
grant execute on function auth.uid() to public;
\ir ../../supabase/perfis_empresa.sql
\ir ../../supabase/oportunidades_editais.sql
alter table public.oportunidades_editais add column if not exists participacao_prazo_limite timestamptz;
\ir ../../supabase/analises_oportunidades.sql
create table public.assinaturas_usuario (
 usuario_id uuid primary key references auth.users(id), plano text not null,
 status text not null default 'active', franquia_ia integer, inicio_em timestamptz default now(), fim_em timestamptz,
 billing_subscription_id uuid
);
alter table public.assinaturas_usuario enable row level security;
create policy propria on public.assinaturas_usuario for select to authenticated using(usuario_id=auth.uid());
create table public.analises_ia_consumos(analise_id uuid primary key,usuario_id uuid not null,consumido_em timestamptz default now());
create function public.reservar_analise_ia_v1(uuid,uuid) returns uuid language sql as $$select gen_random_uuid()$$;
create function public.liberar_reserva_ia_v1(uuid) returns void language sql as $$select$$;
-- Mesma regra Free de janela histórica, sem dependências do ranking.
create function public.plano_historico_visivel_v1(p_plano text,p_status text,p_prazo timestamptz,p_publicacao date)
returns boolean language sql as $$
select p_plano in ('PRO','BUSINESS') or case when p_status='encerrada' or p_prazo<=now() then
 coalesce((p_prazo at time zone 'America/Sao_Paulo')::date,p_publicacao)>=(now() at time zone 'America/Sao_Paulo')::date-30 else true end
$$;
grant select,insert,update,delete on public.perfis_empresa,public.oportunidades_editais,public.analises_oportunidades to authenticated;
grant select on public.assinaturas_usuario to authenticated;
-- Fixture legada antes da migration: o backfill deve preservar o uso vitalício.
insert into auth.users values ('00000000-0000-0000-0000-000000000001');
insert into public.perfis_empresa(id,usuario_id,nome_empresa,cnpj,segmento,porte,uf)
values('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Legado','1','TI','ME','SP');
insert into public.oportunidades_editais(id,codigo,titulo,orgao,modalidade,uf,cidade,objeto,data_publicacao,data_abertura,status)
values('20000000-0000-0000-0000-000000000001','1','Objeto','Orgao','Pregao','SP','SP','Objeto',current_date,current_date,'aberta');
insert into public.analises_oportunidades(usuario_id,perfil_id,oportunidade_id,score,justificativa,resumo)
values('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',70,'Legado','Preservado');
