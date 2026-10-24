import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { configAsaas, urlAsaas, HOMOLOG_SUPABASE_URL } from '../lib/billing/ambiente.ts';
import { linkDoCheckout, validarUrlCheckout } from '../lib/billing/validacao.ts';

// Somente configuracoes ficticias; nenhum teste acessa Asaas ou Supabase.
const sandbox = { ASAAS_ENVIRONMENT: 'sandbox', NEXT_PUBLIC_SUPABASE_URL: HOMOLOG_SUPABASE_URL,
  ASAAS_API_KEY: '$aact_hmlg_ficticio_para_testes', ASAAS_WEBHOOK_TOKEN: 'ficticio-'.repeat(5),
  APP_BASE_URL: 'https://homologacao.example.invalid', VERCEL_ENV: 'preview' };
const production = { ...sandbox, ASAAS_ENVIRONMENT: 'production', VERCEL_ENV: 'production',
  ASAAS_PRODUCTION_ENABLED: 'true', ASAAS_API_KEY: '$aact_prod_ficticio_para_testes',
  ASAAS_PRODUCTION_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', APP_BASE_URL: 'https://app.example.invalid',
  PRO_MONTHLY_PRICE: '99', BUSINESS_MONTHLY_PRICE: '197', PRO_MONTHLY_AI_LIMIT: '200', BUSINESS_MONTHLY_AI_LIMIT: '1000' };

test('cada ambiente escolhe apenas a API e o checkout oficiais correspondentes', () => {
  for (const [env, api, host, wrong] of [
    [sandbox, 'https://api-sandbox.asaas.com/v3', 'sandbox.asaas.com', 'asaas.com'],
    [production, 'https://api.asaas.com/v3', 'asaas.com', 'sandbox.asaas.com'],
  ]) {
    const config = configAsaas(env);
    assert.equal(config.apiUrl, api);
    assert.equal(urlAsaas('/payments/pay_ficticio', config.environment), api + '/payments/pay_ficticio');
    assert.equal(validarUrlCheckout(`https://${host}/checkoutSession/show?id=ficticio`, config.environment),
      `https://${host}/checkoutSession/show?id=ficticio`);
    assert.throws(() => validarUrlCheckout(`https://${wrong}/checkoutSession/show?id=ficticio`, config.environment));
  }
});

test('producao exige habilitacao, projeto fixado e todas as configuracoes; sem fallback', () => {
  for (const key of ['ASAAS_PRODUCTION_ENABLED', 'ASAAS_PRODUCTION_SUPABASE_URL',
    'ASAAS_API_KEY', 'ASAAS_WEBHOOK_TOKEN', 'APP_BASE_URL', 'NEXT_PUBLIC_SUPABASE_URL',
    'PRO_MONTHLY_PRICE', 'BUSINESS_MONTHLY_PRICE', 'PRO_MONTHLY_AI_LIMIT', 'BUSINESS_MONTHLY_AI_LIMIT']) {
    assert.throws(() => configAsaas({ ...production, [key]: undefined }), key);
  }
  for (const flag of ['false', '', '1', 'TRUE']) assert.throws(() => configAsaas({ ...production, ASAAS_PRODUCTION_ENABLED: flag }));
  for (const env of [undefined, '', 'prod', 'PRODUCTION', 'outro']) {
    assert.throws(() => configAsaas({ ...production, ASAAS_ENVIRONMENT: env }));
  }
});

test('resposta documentada com somente ID monta link no host oficial, sem aceitar link cruzado', () => {
  for (const [env, host] of [['sandbox', 'sandbox.asaas.com'], ['production', 'asaas.com']]) {
    assert.equal(linkDoCheckout({ id: 'checkout_ficticio' }, env), `https://${host}/checkoutSession/show?id=checkout_ficticio`);
    assert.throws(() => linkDoCheckout({ id: '//evil.test' }, env));
    assert.throws(() => linkDoCheckout({ id: 'checkout_ficticio', link: 'https://evil.test/checkoutSession/show/a' }, env));
  }
});

test('configuracoes cruzadas de chave, Supabase e deployment falham fechadas', () => {
  for (const overrides of [
    { ASAAS_API_KEY: sandbox.ASAAS_API_KEY }, { NEXT_PUBLIC_SUPABASE_URL: HOMOLOG_SUPABASE_URL },
    { ASAAS_PRODUCTION_SUPABASE_URL: HOMOLOG_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_URL: HOMOLOG_SUPABASE_URL },
    { VERCEL_ENV: 'preview' }, { VERCEL_ENV: 'development' },
    { ASAAS_PRODUCTION_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co.evil.test' },
    { APP_BASE_URL: 'http://app.example.invalid' }, { APP_BASE_URL: 'https://localhost' },
  ]) assert.throws(() => configAsaas({ ...production, ...overrides }));
  for (const overrides of [
    { ASAAS_API_KEY: production.ASAAS_API_KEY }, { NEXT_PUBLIC_SUPABASE_URL: production.NEXT_PUBLIC_SUPABASE_URL },
    { VERCEL_ENV: 'production' },
  ]) assert.throws(() => configAsaas({ ...sandbox, ...overrides }));
});

test('URLs maliciosas, portas, credenciais e caminhos alheios sao rejeitados nos dois ambientes', () => {
  for (const env of ['sandbox', 'production']) {
    const host = env === 'sandbox' ? 'sandbox.asaas.com' : 'asaas.com';
    for (const url of [`https://${host}.evil.test/checkoutSession/show/a`, `https://evil.${host}/checkoutSession/show/a`,
      `http://${host}/checkoutSession/show/a`, `https://${host}:8443/checkoutSession/show/a`,
      `https://ficticio:ficticio@${host}/checkoutSession/show/a`, `https://${host}/outro/a`,
      `https://${host}/checkoutSessionMalicioso/show/a`]) assert.throws(() => validarUrlCheckout(url, env));
    for (const path of ['https://evil.test/payments', '//evil.test/payments', '/../../payments', '/payments\\evil', '/payments#x']) {
      assert.throws(() => urlAsaas(path, env));
    }
  }
  assert.throws(() => validarUrlCheckout('https://asaas.com/000/checkoutSession/show/a', 'production'));
  assert.throws(() => validarUrlCheckout('https://asaas.com/checkoutSession/show/a', undefined));
});

test('APP_BASE_URL nao permite usuario, query, fragmento ou caminho; localhost so em sandbox', () => {
  for (const app of ['https://user:pass@homologacao.example.invalid', 'https://homologacao.example.invalid/pasta',
    'https://homologacao.example.invalid?segredo=x', 'https://homologacao.example.invalid#x']) {
    assert.throws(() => configAsaas({ ...sandbox, APP_BASE_URL: app }));
  }
  assert.equal(configAsaas({ ...sandbox, APP_BASE_URL: 'http://127.0.0.1:3000' }).baseUrl, 'http://127.0.0.1:3000');
});

function carregar(file, deps, extra = {}) {
  const output = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', 'process', 'fetch', output)(name => {
    if (name === 'server-only') return {};
    assert.ok(name in deps, name); return deps[name];
  }, exports, extra.process, extra.fetch);
  return exports;
}

test('cliente HTTP real seleciona endpoint sem rede, impede override do token e nao segue redirects', async () => {
  for (const env of [sandbox, production]) {
    const calls = [];
    const { chamarAsaas } = carregar('../lib/billing/asaas.ts', {
      '@/lib/billing/ambiente': { configAsaas, urlAsaas },
    }, { process: { env }, fetch: async (url, init) => {
      calls.push({ url, init }); return new Response('{}');
    } });
    await chamarAsaas('/payments/pay_ficticio', { headers: { access_token: 'override', Access_Token: 'override_case' } });
    assert.equal(calls[0].url, configAsaas(env).apiUrl + '/payments/pay_ficticio');
    assert.equal(calls[0].init.headers.get('access_token'), env.ASAAS_API_KEY);
    assert.equal(calls[0].init.redirect, 'error');
    await assert.rejects(chamarAsaas('//evil.test/payments'));
    assert.equal(calls.length, 1);
  }
});

test('incompatibilidade do banco bloqueia operacoes antes de reservar checkout ou consultar cobranca', async () => {
  for (const response of [{ data: false, error: null }, { data: true, error: { code: '42501' } }, { data: null, error: null }]) {
    const calls = [];
    const { criarClienteBilling } = carregar('../lib/billing/banco.ts', {
      '@/lib/supabase/admin': { criarClienteSupabaseAdmin: () => ({ rpc: async (name, args) => {
        calls.push({ name, args }); return response;
      } }) },
    });
    await assert.rejects(criarClienteBilling('production'), /incompativel/);
    assert.deepEqual(calls, [{ name: 'billing_verificar_ambiente_v1', args: { p_ambiente: 'production' } }]);
  }
});

test('todas as operacoes usam gateway SQL atomico com ambiente explicito', async () => {
  const calls = [];
  const { criarClienteBilling } = carregar('../lib/billing/banco.ts', {
    '@/lib/supabase/admin': { criarClienteSupabaseAdmin: () => ({ rpc: async (name, args) => {
      calls.push({ name, args }); return { data: true, error: null };
    } }) },
  });
  const banco = await criarClienteBilling('sandbox');
  await banco.rpc('billing_evento_processado_v1', { p_event_id: 'ficticio' });
  assert.deepEqual(calls[1], { name: 'billing_executar_v1', args: { p_ambiente: 'sandbox',
    p_operacao: 'billing_evento_processado_v1', p_argumentos: { p_event_id: 'ficticio' } } });
});
