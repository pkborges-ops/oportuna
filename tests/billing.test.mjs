import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  cobrancaPertenceAoCheckout, dadosPagadorValidos, precoEmCentavos,
  tokenWebhookValido, validarUrlCheckout,
} from '../lib/billing/validacao.ts';
import { paidOffer, paidPlanCode, PLAN_CATALOG } from '../lib/planos/catalogo.ts';

test('catálogo aceita apenas planos pagos e resolve preço no servidor', () => {
  assert.equal(paidPlanCode('FREE'), null);
  assert.equal(paidPlanCode('BUSINESS'), 'BUSINESS');
  assert.equal(paidPlanCode('PRO'), 'PRO');
  assert.equal(paidPlanCode('BUSINESS_EVIL'), null);
  assert.equal(paidPlanCode({ code: 'PRO' }), null);
  assert.equal(PLAN_CATALOG.FREE.gateway, null);
  assert.equal(paidOffer('PRO', { PRO_MONTHLY_PRICE: '39.90' })?.priceCents, 3990);
  assert.equal(paidOffer('BUSINESS', { BUSINESS_MONTHLY_PRICE: '1.23',
    PRO_MONTHLY_AI_LIMIT: '10', BUSINESS_MONTHLY_AI_LIMIT: '20' })?.priceCents, 123);
  assert.equal(paidOffer('BUSINESS', { BUSINESS_MONTHLY_PRICE: '1.23',
    PRO_MONTHLY_AI_LIMIT: '10', BUSINESS_MONTHLY_AI_LIMIT: '10' }), null);
  assert.equal(paidOffer('BUSINESS', { BUSINESS_MONTHLY_PRICE: '' }), null);
  assert.equal(paidOffer('PRO', { PRO_MONTHLY_PRICE: '0' }), null);
  // Valor ou nome adulterado no formulário não entra na resolução da oferta.
  assert.equal(paidOffer('PRO', { PRO_MONTHLY_PRICE: '39.90', price: '1', name: 'Business' })?.priceCents, 3990);
});

test('preco centralizado aceita centavos exatos e rejeita valores ambiguos', () => {
  assert.equal(precoEmCentavos('39.90'), 3990);
  assert.equal(precoEmCentavos('1'), 100);
  for (const valor of ['0', '-1', '1,99', '1.999', 'abc', undefined]) {
    assert.equal(precoEmCentavos(valor), null);
  }
});

for (const caminho of ['/checkoutSession/show/abc', '/000/checkoutSession/show/abc']) {
  test(`checkout Sandbox aceita caminho ${caminho}`, () => {
    const url = `https://sandbox.asaas.com${caminho}`;
    assert.equal(validarUrlCheckout(url, 'sandbox'), url);
  });
}

for (const [caso, url] of [
  ['produção', 'https://asaas.com/checkoutSession/show/abc'],
  ['host falso', 'https://sandbox.asaas.com.evil.test/000/checkoutSession/show/abc'],
  ['subdomínio', 'https://evil.sandbox.asaas.com/checkoutSession/show/abc'],
  ['HTTP', 'http://sandbox.asaas.com/000/checkoutSession/show/abc'],
  ['porta alternativa', 'https://sandbox.asaas.com:8443/000/checkoutSession/show/abc'],
  ['credenciais', 'https://usuario:senha@sandbox.asaas.com/checkoutSession/show/abc'],
  ['outro caminho', 'https://sandbox.asaas.com/outro/abc'],
  ['outro prefixo numérico', 'https://sandbox.asaas.com/001/checkoutSession/show/abc'],
  ['prefixo duplicado', 'https://sandbox.asaas.com/000/000/checkoutSession/show/abc'],
  ['nome de caminho semelhante', 'https://sandbox.asaas.com/000/checkoutSessionMalicioso/show/abc'],
]) {
  test(`checkout Sandbox rejeita ${caso}`, () => {
    assert.throws(() => validarUrlCheckout(url, 'sandbox'), /URL de Checkout invalida/);
  });
}

test('token de webhook ausente ou divergente nao autentica', () => {
  const token = 'a'.repeat(40);
  assert.equal(tokenWebhookValido(token, token), true);
  assert.equal(tokenWebhookValido('b'.repeat(40), token), false);
  assert.equal(tokenWebhookValido(null, token), false);
  assert.equal(tokenWebhookValido('a', token), false);
});

test('documento do pagador e validado e nao usa email como identidade', () => {
  const dados = { nome: 'Ana Maria', documento: '249.715.637-92', email: 'ana@example.invalid',
    celular: '(11) 99999-9999', cep: '01310-100', numero: '100' };
  assert.equal(dadosPagadorValidos(dados)?.documento, '24971563792');
  assert.equal(dadosPagadorValidos({ ...dados, nome: 'A' }), null);
  assert.equal(dadosPagadorValidos({ ...dados, documento: 'ana@example.invalid' }), null);
});

test('primeira cobranca exige checkout, assinatura e cliente coincidentes', () => {
  const pagamento = { id: 'pay_1', subscription: 'sub_1', customer: 'cus_1' };
  assert.equal(cobrancaPertenceAoCheckout({ data: [pagamento], hasMore: false }, pagamento), true);
  for (const lista of [
    { data: [], hasMore: false },
    { data: [{ ...pagamento, id: 'pay_2' }], hasMore: false },
    { data: [{ ...pagamento, subscription: 'sub_2' }], hasMore: false },
    { data: [{ ...pagamento, customer: 'cus_2' }], hasMore: false },
    { data: [pagamento], hasMore: true },
  ]) assert.equal(cobrancaPertenceAoCheckout(lista, pagamento), false);
});
