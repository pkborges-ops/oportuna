import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { verificarCheckoutDaCobranca } from '../lib/billing/webhook.ts';
import { tokenWebhookValido } from '../lib/billing/validacao.ts';

const pagamento = { id: 'pay_teste', customer: 'cus_teste', subscription: 'sub_teste' };

test('confirmacao usa checkoutSession do GET autenticado mesmo quando a listagem retorna zero', async () => {
  let consultas = 0;
  const listarVazio = async () => { consultas++; return { data: [], hasMore: false }; };
  assert.equal(await verificarCheckoutDaCobranca(
    { ...pagamento, checkoutSession: 'checkout_teste' }, 'checkout_teste', listarVazio,
  ), true);
  assert.equal(consultas, 0);
});

test('checkoutSession divergente ou malformado nao e substituido pela listagem', async () => {
  for (const checkoutSession of ['checkout_alheio', '', 123, {}, ['checkout_teste']]) {
    assert.equal(await verificarCheckoutDaCobranca(
      { ...pagamento, checkoutSession }, 'checkout_teste', async () => {
        assert.fail('nao deve ignorar vinculo divergente da API');
      },
    ), false);
  }
});

test('API sem checkoutSession preserva fallback de pagamento, cliente e assinatura', async () => {
  for (const checkoutSession of [undefined, null]) {
    const caminhos = [];
    assert.equal(await verificarCheckoutDaCobranca(
      { ...pagamento, checkoutSession }, 'checkout_teste', async path => {
        caminhos.push(path); return { data: [pagamento], hasMore: false };
      },
    ), true);
    assert.deepEqual(caminhos, ['/payments?checkoutSession=checkout_teste&limit=100']);
  }
});

test('fallback vazio, truncado ou de outro cliente/assinatura/pagamento impede ativacao', async () => {
  for (const lista of [
    { data: [], hasMore: false }, { data: [pagamento], hasMore: true },
    ...['id', 'customer', 'subscription'].map(campo => ({
      data: [{ ...pagamento, [campo]: 'alheio' }], hasMore: false,
    })),
  ]) assert.equal(await verificarCheckoutDaCobranca(pagamento, 'checkout_teste', async () => lista), false);
});

test('erro de consulta nao vira confirmacao e checkout vazio nao e aceito', async () => {
  await assert.rejects(verificarCheckoutDaCobranca(pagamento, 'checkout_teste', async () => {
    throw new Error('HTTP 503');
  }), /HTTP 503/);
  assert.equal(await verificarCheckoutDaCobranca(pagamento, '', async () => {
    assert.fail('checkout ausente');
  }), false);
});

function handler(cobranca, resultado = 'processed', bancoCompativel = true) {
  const chamadas = [];
  const dependencies = {
    '@/lib/billing/asaas': {
      obterConfigAsaas: () => ({ environment: 'sandbox', webhookToken: 'token-ficticio-de-teste' }),
      chamarAsaas: async path => {
        chamadas.push({ path });
        return path.startsWith('/payments?') ? { data: [], hasMore: false } : cobranca;
      },
    },
    '@/lib/billing/validacao': { tokenWebhookValido },
    '@/lib/billing/webhook': { verificarCheckoutDaCobranca },
    '@/lib/billing/banco': { criarClienteBilling: async () => {
      if (!bancoCompativel) throw new Error('Ambiente incompativel');
      return { rpc: async (nome, args) => {
      chamadas.push({ rpc: nome, args });
      return { error: null, data: nome === 'billing_evento_processado_v1' ? false
        : nome === 'billing_checkout_pendente_v1' ? { checkout_id: 'checkout_teste' } : resultado };
    } };
    } },
  };
  const source = readFileSync(new URL('../app/api/webhooks/asaas/route.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  new Function('require', 'exports', 'console', outputText)(specifier => {
    assert.ok(specifier in dependencies); return dependencies[specifier];
  }, exports, { error() {} });
  return { post: exports.POST, chamadas };
}

const confirmado = { ...pagamento, status: 'CONFIRMED', value: 99,
  dueDate: '2026-10-08', billingType: 'CREDIT_CARD', checkoutSession: 'checkout_teste' };
const evento = () => new Request('https://homologacao.invalid/api/webhooks/asaas', {
  method: 'POST', headers: { 'asaas-access-token': 'token-ficticio-de-teste' },
  body: JSON.stringify({ id: 'evt_teste', event: 'PAYMENT_CONFIRMED',
    payment: { ...confirmado, checkoutSession: 'valor-nao-confiavel-do-webhook' } }),
});

test('handler reproduz 503 da listagem vazia e processa usando vinculo consultado no Asaas', async () => {
  const { post, chamadas } = handler(confirmado);
  assert.equal((await post(evento())).status, 200);
  assert.equal(chamadas.some(c => c.path?.startsWith('/payments?')), false);
  const processar = chamadas.find(c => c.rpc === 'billing_processar_webhook_v1');
  assert.equal(processar.args.p_checkout_verificado, 'checkout_teste');
  assert.deepEqual(processar.args.p.payment, confirmado);
});

test('handler nao processa se GET retornar checkout alheio ou valor divergente', async () => {
  for (const atual of [{ ...confirmado, checkoutSession: 'alheio' }, { ...confirmado, value: 197 }]) {
    const { post, chamadas } = handler(atual);
    assert.equal((await post(evento())).status, 503);
    assert.equal(chamadas.some(c => c.rpc === 'billing_processar_webhook_v1'), false);
  }
});

test('handler mantem 503 se a RPC falhar na ativacao; nao confirma entrega como sucesso', async () => {
  const { post, chamadas } = handler(confirmado, 'retry');
  assert.equal((await post(evento())).status, 503);
  assert.equal(chamadas.filter(c => c.rpc === 'billing_processar_webhook_v1').length, 1);
});

test('handler bloqueia banco de outro ambiente antes de qualquer consulta financeira ou evento', async () => {
  const { post, chamadas } = handler(confirmado, 'processed', false);
  assert.equal((await post(evento())).status, 503);
  assert.equal(chamadas.length, 0);
});
