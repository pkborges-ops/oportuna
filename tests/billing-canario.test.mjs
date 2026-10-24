import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';
import { pedidoCheckout } from '../lib/billing/pedido.ts';
import { paidOffer } from '../lib/planos/catalogo.ts';
import { linkDoCheckout, validarUrlCheckout } from '../lib/billing/validacao.ts';

// Identidades sinteticas; todos os clientes de rede/banco sao substituidos.
const CANARY = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const production = { ASAAS_ENVIRONMENT: 'production', VERCEL_ENV: 'production',
  BILLING_CANARY_ENABLED: 'true', BILLING_CANARY_USER_ID: CANARY };
const prices = { PRO_MONTHLY_PRICE: '99', BUSINESS_MONTHLY_PRICE: '197',
  PRO_MONTHLY_AI_LIMIT: '200', BUSINESS_MONTHLY_AI_LIMIT: '1000' };
const payer = { nome: 'Pagador Teste', documento: '24971563792', email: 'teste@example.invalid',
  celular: '11999999999', cep: '01310100', numero: '100' };

function load(file, deps = {}, env = {}) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const exports = {};
  new Function('require', 'exports', 'process', outputText)(name => {
    if (name === 'server-only') return {};
    if (name === 'react/jsx-runtime') return jsxRuntime;
    assert.ok(name in deps, `Dependencia nao isolada: ${name}`);
    return deps[name];
  }, exports, { env });
  return exports;
}
const policy = env => load('../lib/billing/canario.ts', {}, env);

for (const [user, plan, allowed] of [
  [CANARY, 'PRO', true], [CANARY, 'BUSINESS', false],
  [OTHER, 'PRO', false], [OTHER, 'BUSINESS', false],
]) {
  test(`canario no servidor: ${user === CANARY ? 'conta controlada' : 'outra conta'} + ${plan} = ${allowed}`, () => {
    assert.equal(policy(production).checkoutPermitido(user, plan), allowed);
  });
}

test('producao sem flag estrita ou UUID unico valido bloqueia checkout para todos', () => {
  for (const enabled of [undefined, '', 'false', 'TRUE', '1']) {
    assert.equal(policy({ ...production, BILLING_CANARY_ENABLED: enabled }).checkoutPermitido(CANARY, 'PRO'), false);
  }
  for (const id of [undefined, '', 'qualquer-usuario', `${CANARY},${OTHER}`, ` ${CANARY}`, `${CANARY}\n`]) {
    assert.equal(policy({ ...production, BILLING_CANARY_USER_ID: id }).checkoutPermitido(CANARY, 'PRO'), false);
  }
  for (const env of [{}, { ASAAS_ENVIRONMENT: 'production' }, { ...production, ASAAS_ENVIRONMENT: 'prod' }]) {
    assert.equal(policy(env).checkoutPermitido(CANARY, 'PRO'), false);
  }
  for (const user of [null, undefined, '', 'identidade-invalida']) {
    assert.equal(policy(production).checkoutPermitido(user, 'PRO'), false);
  }
  assert.equal(policy(production).checkoutPermitido(CANARY, 'FREE'), false);
});

test('sandbox preserva Pro e Business para as duas contas sem exigir configuracao de canario', () => {
  for (const env of [
    { ASAAS_ENVIRONMENT: 'sandbox' },
    { ...production, ASAAS_ENVIRONMENT: 'sandbox', VERCEL_ENV: 'preview', BILLING_CANARY_ENABLED: 'false' },
  ]) for (const user of [CANARY, OTHER]) for (const plan of ['PRO', 'BUSINESS']) {
    assert.equal(policy(env).checkoutPermitido(user, plan), true);
  }
  assert.equal(policy({ ...production, ASAAS_ENVIRONMENT: 'sandbox' }).checkoutPermitido(CANARY, 'PRO'), false);
});

function route(env, user = OTHER) {
  const calls = [];
  const { POST } = load('../app/api/billing/checkout/route.ts', {
    '@/lib/billing/canario': policy(env),
    '@/lib/billing/pedido': { pedidoCheckout },
    '@/lib/billing/checkout': { criarOuReutilizarCheckout: async (...args) => {
      calls.push(args); return 'https://asaas.com/checkoutSession/show?id=ficticio';
    } },
    '@/lib/supabase/server': { criarClienteSupabaseServer: async () => ({ auth: {
      getUser: async () => ({ data: { user: user ? { id: user, user_metadata: {
        BILLING_CANARY_ENABLED: 'true', BILLING_CANARY_USER_ID: CANARY,
      } } : null }, error: null }),
    } }) },
  });
  return { POST, calls };
}

function request(plan, overrides = false) {
  const body = new FormData();
  const values = { nomePagador: payer.nome, documentoPagador: payer.documento, emailPagador: payer.email,
    celularPagador: payer.celular, cepPagador: payer.cep, numeroPagador: payer.numero };
  for (const [key, value] of Object.entries(values)) body.set(key, value);
  body.set('plan', plan);
  if (overrides) for (const [key, value] of Object.entries({ usuario: CANARY, usuarioId: CANARY,
    BILLING_CANARY_ENABLED: 'true', BILLING_CANARY_USER_ID: CANARY, ASAAS_ENVIRONMENT: 'sandbox',
    canary: 'true', checkoutAllowed: 'true', price: '1', quota: '99999' })) body.set(key, value);
  return new Request('https://app.example.invalid/api/billing/checkout' + (overrides ?
    `?BILLING_CANARY_ENABLED=true&BILLING_CANARY_USER_ID=${CANARY}&ASAAS_ENVIRONMENT=sandbox` : ''), {
    method: 'POST', body, headers: { origin: 'https://app.example.invalid' },
  });
}

test('POST real bloqueia outra conta e Business com 403 amigavel antes de chamar o checkout', async () => {
  for (const [user, plan] of [[OTHER, 'PRO'], [OTHER, 'BUSINESS'], [CANARY, 'BUSINESS']]) {
    const { POST, calls } = route(production, user);
    const response = await POST(request(plan));
    assert.equal(response.status, 403);
    assert.equal(await response.text(), 'Assinaturas em liberação gradual.');
    assert.equal(calls.length, 0);
  }
});

test('POST ignora overrides no body, query e metadata e usa somente identidade autenticada', async () => {
  for (const env of [production, { ASAAS_ENVIRONMENT: 'production' }]) {
    const { POST, calls } = route(env, OTHER);
    const response = await POST(request('PRO', true));
    assert.equal(response.status, 403);
    assert.equal(calls.length, 0);
    assert.doesNotMatch(await response.text(), new RegExp(`${CANARY}|${OTHER}|BILLING_CANARY`));
  }
  const { POST, calls } = route(production, null);
  assert.equal((await POST(request('PRO', true))).status, 401);
  assert.equal(calls.length, 0);
});

test('POST permite somente Pro da conta controlada e mantem os dois planos no Sandbox', async () => {
  for (const [env, user, plan] of [[production, CANARY, 'PRO'],
    [{ ASAAS_ENVIRONMENT: 'sandbox' }, OTHER, 'PRO'], [{ ASAAS_ENVIRONMENT: 'sandbox' }, OTHER, 'BUSINESS']]) {
    const { POST, calls } = route(env, user);
    assert.equal((await POST(request(plan, true))).status, 303);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], user);
    assert.equal(calls[0][2], plan);
  }
});

function service(env, reuse = false) {
  const calls = [];
  const host = env.ASAAS_ENVIRONMENT === 'sandbox' ? 'sandbox.asaas.com' : 'asaas.com';
  const url = `https://${host}/checkoutSession/show?id=ficticio`;
  const { criarOuReutilizarCheckout } = load('../lib/billing/checkout.ts', {
    '@/lib/billing/canario': policy(env),
    '@/lib/planos/catalogo': { paidOffer: code => paidOffer(code, prices) },
    '@/lib/billing/validacao': { linkDoCheckout, validarUrlCheckout },
    '@/lib/billing/cliente': { obterCliente: async () => { calls.push('cliente'); return 'cus_ficticio'; } },
    '@/lib/billing/banco': { criarClienteBilling: async () => {
      calls.push('banco'); return { rpc: async (name, args) => {
        calls.push({ rpc: name, args });
        return { error: null, data: name === 'billing_reservar_checkout_v1' ?
          reuse ? { state: 'reuse', url } : { state: 'claim', id: 'reserva_ficticia', customer_id: 'cus_ficticio' } : null };
      } };
    } },
    '@/lib/billing/asaas': {
      obterConfigAsaas: () => { calls.push('config'); return { environment: env.ASAAS_ENVIRONMENT, baseUrl: 'https://app.example.invalid' }; },
      chamarAsaas: async (path, init) => {
        calls.push({ path, payload: JSON.parse(init.body) }); return { id: 'ficticio', link: url };
      },
    },
  });
  return { checkout: criarOuReutilizarCheckout, calls, url };
}

test('servico tambem bloqueia chamada direta antes de banco, cliente, reserva ou Asaas, inclusive reuso', async () => {
  for (const [env, user, plan] of [[production, OTHER, 'PRO'], [production, CANARY, 'BUSINESS'],
    [{ ASAAS_ENVIRONMENT: 'production' }, CANARY, 'PRO']]) {
    for (const reuse of [false, true]) {
      const { checkout, calls } = service(env, reuse);
      await assert.rejects(checkout(user, payer, plan), /Assinaturas em liberação gradual/);
      assert.equal(calls.length, 0);
    }
  }
});

test('checkout autorizado preserva preco, franquia, payload e reuso sem criar outra sessao', async () => {
  for (const [env, user, plan, cents, quota] of [[production, CANARY, 'PRO', 9900, 200],
    [{ ASAAS_ENVIRONMENT: 'sandbox' }, OTHER, 'BUSINESS', 19700, 1000]]) {
    const { checkout, calls, url } = service(env);
    assert.equal(await checkout(user, payer, plan), url);
    const reservation = calls.find(c => c.rpc === 'billing_reservar_checkout_v1');
    assert.equal(reservation.args.p_usuario, user);
    assert.equal(reservation.args.p_plan_code, plan);
    assert.equal(reservation.args.p_valor, cents);
    assert.equal(reservation.args.p_franquia_ia, quota);
    const sent = calls.find(c => c.path === '/checkouts');
    assert.equal(sent.payload.items[0].value, cents / 100);
    assert.equal(sent.payload.customer, 'cus_ficticio');
    assert.equal('customerData' in sent.payload, false);
  }
  const { checkout, calls, url } = service(production, true);
  assert.equal(await checkout(CANARY, payer, 'PRO'), url);
  assert.equal(calls.some(c => c.path), false);
});

test('pagina calcula permissao no servidor e envia apenas booleanos para a apresentacao', async () => {
  for (const [user, expected] of [[CANARY, { PRO: true, BUSINESS: false }], [OTHER, { PRO: false, BUSINESS: false }]]) {
    const page = load('../app/(painel)/planos/page.tsx', {
      '@/lib/billing/canario': policy(production),
      '@/components/planos/upgrade-prompt': { PlanViewEvent: () => null },
      '@/components/planos/planos-view': { PlanosView: () => null },
      '@/lib/planos/catalogo': { paidOffer: code => paidOffer(code, prices) },
      '@/lib/billing/asaas': { obterConfigAsaas: () => ({ environment: 'production' }) },
      '@/lib/billing/banco': { criarClienteBilling: async () => ({}) },
      '@/services/planos-service': { obterPlanoAtual: async () => ({ codigo: 'FREE' }) },
      '@/lib/supabase/server': { criarClienteSupabaseServer: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: user, user_metadata: {} } } }) },
        rpc: async () => ({ data: {}, error: null }),
      }) },
    }).default;
    const tree = await page({ searchParams: Promise.resolve({ BILLING_CANARY_ENABLED: 'true', usuarioId: CANARY }) });
    const view = tree.props.children[1];
    assert.deepEqual(view.props.checkoutAllowed, expected);
    assert.doesNotMatch(JSON.stringify(view.props), new RegExp(`${CANARY}|${OTHER}|BILLING_CANARY_USER_ID`));
  }
});
