// PostgreSQL embarcado em memoria. Nunca usa URL/credencial de Supabase.
// Instale PGlite em pasta temporaria e aponte BILLING_SQL_PGLITE_PATH ao dist/index.js.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

if (!process.env.BILLING_SQL_PGLITE_PATH) throw new Error('Configure somente o caminho local BILLING_SQL_PGLITE_PATH.');
const { PGlite } = await import(pathToFileURL(process.env.BILLING_SQL_PGLITE_PATH).href);
const schema = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create table auth.users(id uuid primary key,email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
grant usage on schema auth to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated,service_role;
create table public.assinaturas_usuario(
 usuario_id uuid primary key references auth.users(id), plano text not null default 'FREE',
 status text not null default 'active', inicio_em timestamptz default now(), fim_em timestamptz,
 franquia_ia integer, constraint assinaturas_usuario_plano_check check(plano in ('FREE','PRO')));
alter table public.assinaturas_usuario enable row level security;
create policy propria on public.assinaturas_usuario for select to authenticated using(usuario_id=auth.uid());
grant select on public.assinaturas_usuario to authenticated;
create function public.fixture_free() returns trigger language plpgsql as $$
begin insert into public.assinaturas_usuario(usuario_id) values(new.id); return new; end; $$;
create trigger fixture_free after insert on auth.users for each row execute function public.fixture_free();
create table public.perfis_empresa(id uuid primary key,usuario_id uuid);
create table public.oportunidades_editais(id uuid primary key,status text,participacao_prazo_limite timestamptz,data_publicacao date);
create table public.score_desbloqueios(usuario_id uuid,perfil_id uuid,oportunidade_id uuid,dia date);
create table public.analises_ia_consumos(usuario_id uuid);
create function public.plano_dia_v1() returns date language sql stable as $$ select current_date; $$;
create function public.plano_limite_ia_v1() returns integer language sql stable as $$ select 1; $$;
`;
const migration = readFileSync('supabase/asaas_assinaturas_v1.sql', 'utf8');
const suite = readFileSync('tests/sql/asaas-billing.sql', 'utf8');
const environments = readFileSync('tests/sql/asaas-ambientes.sql', 'utf8');
const legacy = execFileSync('git', ['show', 'f0d798678635cb05419c334708de580e73eb314b:supabase/asaas_assinaturas_v1.sql'], { encoding: 'utf8' });
const snapshot = async db => {
  const data = {};
  for (const table of ['assinaturas_usuario','billing_customers','billing_subscriptions','billing_payments','billing_webhook_events']) {
    data[table] = (await db.query(`select * from public.${table} order by 1`)).rows;
  }
  return data;
};
const seed = `
insert into auth.users values('00000000-0000-4000-8000-000000000001','fixture@example.invalid');
insert into public.billing_customers(id,usuario_id,gateway_customer_id,status_local)
 values('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','cus_preservado','ready');
insert into public.billing_subscriptions(id,usuario_id,billing_customer_id,plan_code,status_local,valor_centavos,franquia_ia,paid_until)
 values('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000002','PRO','active',9900,200,now()+interval '1 month');
insert into public.billing_payments(billing_subscription_id,gateway_payment_id,status,valor_centavos,vencimento,
 confirmado_em,periodo_fim) values('00000000-0000-4000-8000-000000000003','pay_preservado',
 'PAYMENT_CONFIRMED',9900,current_date,now(),now()+interval '1 month');
update public.assinaturas_usuario set plano='PRO',origem='ASAAS',franquia_ia=200,
 billing_subscription_id='00000000-0000-4000-8000-000000000003',fim_em=now()+interval '1 month';
`;

for (const environment of ['sandbox', 'production']) {
  const db = new PGlite();
  try {
    await db.exec(schema);
    if (environment === 'sandbox') {
      await db.exec(legacy);
      await db.exec(seed);
      const before = await snapshot(db);
      await db.exec(migration);
      assert.deepEqual(await snapshot(db), before, 'Upgrade alterou dados existentes');
    } else {
      await db.exec(migration);
      await db.exec("update public.billing_configuracao set ambiente='production'");
      await db.exec(seed);
    }
    const before = await snapshot(db);
    await db.exec(migration);
    assert.deepEqual(await snapshot(db), before, 'Reaplicacao alterou dados existentes');
    assert.equal((await db.query('select public.billing_ambiente_v1() as ambiente')).rows[0].ambiente, environment);
    await db.exec(suite);
    await db.exec(environments);
    assert.deepEqual(await snapshot(db), before, 'Suíte deixou dados fora do rollback');
    const financial = readFileSync('supabase/billing_concessoes_v1.sql', 'utf8');
    await db.exec(financial);
    const upgraded = await snapshot(db);
    for (const [table, rows] of Object.entries(before)) {
      assert.deepEqual(upgraded[table].map(row => Object.fromEntries(
        Object.keys(rows[0] ?? {}).map(key => [key, row[key]]))), rows,
      `Contrato financeiro alterou colunas existentes: ${table}`);
    }
    assert.equal((await db.query('select count(*)::int as n from public.billing_concessoes')).rows[0].n, 0);
    await db.exec(financial);
    assert.deepEqual(await snapshot(db), upgraded, 'Reaplicacao financeira alterou dados');
    await db.exec(suite);
    await db.exec(environments);
    const financialResult = await db.exec(readFileSync('tests/sql/billing-concessoes.sql', 'utf8'));
    const checks = financialResult.find(result => result.rows?.[0]?.verificacoes_financeiras)?.rows[0].verificacoes_financeiras;
    assert.deepEqual(await snapshot(db), upgraded, 'Suite financeira deixou dados fora do rollback');
    // Preservacao/reaplicacao tambem com concessao e entrega realmente existentes.
    await db.exec(`update public.billing_payments set status='PAYMENT_RECEIVED' where gateway_payment_id='pay_preservado'`);
    assert.equal((await db.query(`select estado from public.billing_concessoes`)).rows[0].estado, 'REVIEW');
    const financeSnapshot = async () => {
      const data = await snapshot(db);
      for (const table of ['billing_concessoes','billing_concessoes_revisoes','billing_concessoes_entregas']) {
        data[table] = (await db.query(`select * from public.${table} order by 1`)).rows;
      }
      return data;
    };
    const withGrants = await financeSnapshot();
    await db.exec(migration);
    await db.exec(financial);
    assert.deepEqual(await financeSnapshot(), withGrants, 'Reaplicacao alterou concessao/entrega existente');
    console.log(`PASS | contrato financeiro ${environment} local | ${checks} verificacoes | legado sem credito automatico, concessoes/outbox preservadas`);
    console.log(`PASS | SQL ${environment} local | fluxo Pro/Business, RLS, idempotencia, ambiente, upgrade/reaplicacao e preservacao`);
  } catch (error) {
    console.error(`FAIL | SQL ${environment} local | ${error.code ?? 'ASSERT'} | ${error.message}`);
    process.exitCode = 1;
  } finally { await db.close(); }
}
