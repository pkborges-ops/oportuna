// Testes do handler LOCAL com rede/banco substituidos. NAO sao E2Es do Asaas.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { tokenWebhookValido } from '../lib/billing/validacao.ts';
import { verificarCheckoutDaCobranca } from '../lib/billing/webhook.ts';

const TOKEN = 'token-sintetico-apenas-local';
const payment = { id: 'pay_qa_local', customer: 'cus_qa_local', subscription: 'sub_qa_local',
  status: 'CONFIRMED', value: 99, dueDate: '2026-10-01', billingType: 'CREDIT_CARD', checkoutSession: 'chk_qa_local' };
function fixture(options = {}) {
  const calls = []; let processed = false; let attempts = 0;
  const dependencies = {
    '@/lib/billing/asaas': {
      obterConfigAsaas: () => ({ environment: 'sandbox', webhookToken: TOKEN }),
      chamarAsaas: async path => {
        calls.push({ api: path });
        if (options.apiFailure) throw new Error('Asaas retornou HTTP 503.');
        return { ...payment, ...options.currentPayment };
      },
    },
    '@/lib/billing/validacao': { tokenWebhookValido },
    '@/lib/billing/webhook': { verificarCheckoutDaCobranca },
    '@/lib/billing/banco': { criarClienteBilling: async () => ({ rpc: async (name, args) => {
      calls.push({ rpc: name, args });
      if (name === 'billing_evento_processado_v1') return { data: options.duplicate || processed, error: null };
      if (name === 'billing_checkout_pendente_v1') return { data: { checkout_id: 'chk_qa_local' }, error: null };
      assert.equal(name, 'billing_processar_webhook_v1'); attempts++;
      if (options.failOnce && attempts === 1) return { data: 'retry', error: null };
      if (options.rpcFailure) return { data: null, error: { message: 'falha local ficticia' } };
      processed = true; return { data: 'processed', error: null };
    } }) },
  };
  const { outputText } = ts.transpileModule(readFileSync(new URL('../app/api/webhooks/asaas/route.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  new Function('require', 'exports', 'console', outputText)(name => {
    assert.ok(name in dependencies); return dependencies[name];
  }, exports, { error() {} });
  const request = (event = 'PAYMENT_CONFIRMED', token = TOKEN, body = null) => new Request('https://qa.example.invalid/api/webhooks/asaas', {
    method: 'POST', headers: token === null ? {} : { 'asaas-access-token': token },
    body: body ?? JSON.stringify({ id: 'evt_qa_local', event, payment,
      checkout: { id: 'chk_qa_local' }, subscription: { id: 'sub_qa_local', customer: 'cus_qa_local' } }),
  });
  return { post: exports.POST, request, calls };
}

for (const event of ['PAYMENT_CREDIT_CARD_CAPTURE_REFUSED', 'CHECKOUT_EXPIRED', 'PAYMENT_OVERDUE',
  'PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED', 'SUBSCRIPTION_DELETED']) {
  test(`[mock local] ${event} e encaminhado a RPC financeira, sem novo checkout/pagamento`, async () => {
    const f = fixture();
    assert.equal((await f.post(f.request(event))).status, 200);
    assert.deepEqual(f.calls.map(c => c.rpc), ['billing_evento_processado_v1', 'billing_processar_webhook_v1']);
    assert.equal(f.calls[1].args.p.event, event);
    assert.equal(f.calls[1].args.p_checkout_verificado, null);
  });
}

test('[mock local] token ausente/invalido rejeitado antes de persistir evento', async () => {
  for (const token of [null, 'invalido']) {
    const f = fixture(); const response = await f.post(f.request('PAYMENT_REFUNDED', token));
    assert.equal(response.status, 401); assert.equal(await response.text(), ''); assert.equal(f.calls.length, 0);
  }
});

test('[mock local] JSON invalido, evento desconhecido e corpo excessivo nao chegam a RPC', async () => {
  for (const [body, status] of [['{', 400], [JSON.stringify({ id: 'evt_local', event: 'SEM_SUPORTE' }), 400],
    ['x'.repeat(65537), 413]]) {
    const f = fixture(); assert.equal((await f.post(f.request('PAYMENT_CONFIRMED', TOKEN, body))).status, status);
    assert.equal(f.calls.length, 0);
  }
});

test('[mock local] evento ja processado responde 200 sem consultar gateway nem executar de novo', async () => {
  const f = fixture({ duplicate: true, apiFailure: true });
  assert.equal((await f.post(f.request())).status, 200);
  assert.deepEqual(f.calls.map(c => c.rpc), ['billing_evento_processado_v1']);
});

test('[mock local] falha temporaria retorna 503; reentrega controlada usa o mesmo ID, depois deduplica', async () => {
  const f = fixture({ failOnce: true });
  // Repeticoes explicitas apenas neste mock; nenhum retry financeiro remoto.
  assert.equal((await f.post(f.request())).status, 503);
  assert.equal((await f.post(f.request())).status, 200);
  assert.equal((await f.post(f.request())).status, 200);
  const writes = f.calls.filter(c => c.rpc === 'billing_processar_webhook_v1');
  assert.equal(writes.length, 2);
  assert.equal(writes[0].args.p.id, writes[1].args.p.id);
});

test('[mock local] erro RPC nao recebe ACK de sucesso e nao cria outra cobranca', async () => {
  const f = fixture({ rpcFailure: true });
  assert.equal((await f.post(f.request())).status, 503);
  assert.equal(f.calls.filter(c => c.rpc === 'billing_processar_webhook_v1').length, 1);
  assert.equal(f.calls.some(c => c.api && !c.api.startsWith('/payments/')), false);
});

test('[mock local] falha na verificacao Asaas nao persiste evento no SQL; depende de reentrega do provedor', async () => {
  const f = fixture({ apiFailure: true });
  assert.equal((await f.post(f.request())).status, 503);
  assert.equal(f.calls.some(c => c.rpc === 'billing_processar_webhook_v1'), false);
});

test('[mock local] confirmacao antiga com estado atual REFUNDED nao ativa acesso', async () => {
  const f = fixture({ currentPayment: { status: 'REFUNDED' } });
  assert.equal((await f.post(f.request())).status, 503);
  assert.equal(f.calls.some(c => c.rpc === 'billing_processar_webhook_v1'), false);
});
