-- SOMENTE cluster descartável: emula o schema Auth do Supabase, não o billing.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users(id uuid primary key,email text);
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema public,auth to anon,authenticated,service_role;
grant execute on function auth.uid() to public;
alter default privileges in schema public grant select,insert,update,delete on tables to authenticated,service_role;
\ir ../../supabase/perfis_empresa.sql
\ir ../../supabase/oportunidades_editais.sql
\ir ../../supabase/participacao_oportunidades.sql
\ir ../../supabase/oportunidades_origem_tipo.sql
\ir ../../supabase/analises_oportunidades.sql
\ir ../../supabase/alertas_email.sql
\ir ../../supabase/oportunidades_paginadas_v1.sql
\ir ../../supabase/oportunidades_ciclo_vida_v1.sql
