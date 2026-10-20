import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlanosView } from '../components/planos/planos-view.tsx';
import { paidOffer } from '../lib/planos/catalogo.ts';
import { estadoDoPlano, mensagemDoRetorno, dataDoPlano } from '../lib/planos/apresentacao.ts';

const config = { PRO_MONTHLY_PRICE: '99', BUSINESS_MONTHLY_PRICE: '197', PRO_MONTHLY_AI_LIMIT: '200', BUSINESS_MONTHLY_AI_LIMIT: '1000' };
const props = { current: 'FREE', billing: null, ready: true, nomeInicial: '', emailInicial: '', now: Date.parse('2026-10-13T12:00:00Z'),
  checkoutAllowed: { PRO: true, BUSINESS: true },
  offers: { PRO: paidOffer('PRO', config), BUSINESS: paidOffer('BUSINESS', config) } };
const render = extras => renderToStaticMarkup(createElement(PlanosView, { ...props, ...extras }));

test('cards comparam precos e IA, distinguem recomendado do plano atual e mantem formulários em dialog', () => {
  const html = render({});
  for (const price of ['R$ 0,00', 'R$ 99,00', 'R$ 197,00']) assert.ok(html.includes(price));
  for (const text of ['Recomendado', 'Seu plano: Free', '200 análises IA/mês', '1.000 análises IA/mês', 'Assinar Pro', 'Assinar Business']) {
    assert.ok(html.includes(text), text);
  }
  assert.doesNotMatch(html, /Equipes|Assistente de Participação/);
  assert.doesNotMatch(html.split('aria-label="Plano Business"')[1], /Até \d+ perfis/);
  const forms = [...html.matchAll(/<form\b/g)];
  assert.equal(forms.length, 2);
  for (const form of forms) {
    assert.ok(html.lastIndexOf('<dialog', form.index) > html.lastIndexOf('</dialog>', form.index));
  }
});

test('Pro ativo tem selo proprio e recomendacao, sem contratar novamente e sem expor estados internos', () => {
  const html = render({ current: 'PRO', billing: { status: 'active', plan_code: 'PRO', franquia_ia: 200, paid_until: '2026-11-08T03:00:00Z' } });
  for (const text of ['Seu plano: Pro', 'Recomendado', 'Plano atual', 'Acesso ativo até 08/11/2026', '200 análises de IA por mês', 'Alteração pelo suporte']) {
    assert.ok(html.includes(text), text);
  }
  assert.doesNotMatch(html, /<form|>active<|checkout_pending|uncertain|Assinar Pro/);
});

test('estados de billing mostram mensagens amigaveis e apenas checkout valido pode continuar', () => {
  for (const [status, label, action] of [
    ['checkout_pending', 'Pagamento pendente', 'continue'], ['checkout_paid', 'Aguardando confirmação', undefined],
    ['payment_pending', 'Aguardando confirmação', undefined], ['creating', 'Em processamento', undefined],
    ['uncertain', 'Em processamento', undefined], ['review', 'Em processamento', undefined],
    ['past_due', 'Pagamento pendente', undefined], ['desconhecido', 'Em processamento', undefined],
  ]) {
    const billing = { plan_code: 'BUSINESS', status, checkout_expira_em: '2026-10-13T13:00:00Z' };
    const state = estadoDoPlano('BUSINESS', 'FREE', billing, true, true, props.now);
    assert.equal(state.label, label); assert.equal(state.action, action);
    const html = render({ billing });
    assert.ok(html.includes(label)); assert.doesNotMatch(html, new RegExp(status));
    if (!action) assert.doesNotMatch(html, /<form/);
  }
  for (const expires of [undefined, 'invalida', '2026-10-13T11:59:59Z']) {
    assert.equal(estadoDoPlano('BUSINESS', 'FREE', { status: 'checkout_pending', plan_code: 'BUSINESS', checkout_expira_em: expires }, true, true, props.now).action, undefined);
  }
});

test('ausencia de configuracao bloqueia novas contratacoes sem esconder o plano efetivo', () => {
  const html = render({ ready: false });
  assert.ok(html.includes('Indisponível no momento')); assert.doesNotMatch(html, /<form/);
  assert.equal(estadoDoPlano('BUSINESS', 'BUSINESS', { status: 'active' }, false, false).label, 'Plano atual');
  assert.equal(estadoDoPlano('PRO', 'FREE', null, true, false).label, 'Indisponível no momento');
});

test('successUrl adulterada nao afirma pagamento confirmado e datas usam Brasilia', () => {
  for (const status of ['active', 'checkout_paid', 'payment_pending', 'uncertain', undefined]) {
    assert.equal(mensagemDoRetorno('FREE', { status, plan_code: 'PRO' }, 'sucesso'), 'Aguardando confirmação do pagamento.');
  }
  assert.match(mensagemDoRetorno('BUSINESS', { status: 'active', plan_code: 'BUSINESS' }, 'sucesso'), /Business/);
  assert.equal(dataDoPlano('2026-11-08T02:59:59Z'), '07/11/2026');
  assert.equal(dataDoPlano('invalida'), null);
});

test('fora do canario exibe liberacao gradual sem formulario, sem ocultar plano existente', () => {
  const checkoutAllowed = { PRO: false, BUSINESS: false };
  const html = render({ checkoutAllowed, ready: false });
  assert.match(html, /Assinaturas em liberação gradual/);
  assert.match(html, /Disponível em breve/);
  assert.doesNotMatch(html, /<form|Assinar Pro|Assinar Business|BILLING_CANARY_USER_ID/);
  const active = render({ checkoutAllowed, current: 'PRO', billing: { status: 'active', plan_code: 'PRO', franquia_ia: 200 } });
  assert.match(active, /Seu plano: Pro/);
  assert.match(active, /200 análises de IA por mês/);
  assert.doesNotMatch(active, /<form/);
});

test('canario oferece apenas o modal Pro e mantem Business indisponivel', () => {
  const html = render({ checkoutAllowed: { PRO: true, BUSINESS: false } });
  assert.equal([...html.matchAll(/<form\b/g)].length, 1);
  assert.match(html, /Assinar Pro/);
  assert.doesNotMatch(html, /Assinar Business/);
  assert.match(html.split('aria-label="Plano Business"')[1], /Assinaturas em liberação gradual/);
});
