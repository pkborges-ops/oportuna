import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { dadosPagadorValidos } from '../lib/billing/validacao.ts';
import { obterCliente, payloadCliente } from '../lib/billing/cliente.ts';
import { pedidoCheckout } from '../lib/billing/pedido.ts';
import { paidOffer } from '../lib/planos/catalogo.ts';
import { AssinaturaDialog } from '../components/planos/assinatura-dialog.tsx';

const entrada = { nome: '  Ana Teste  ', documento: '249.715.637-92',
  email: 'ana@example.invalid', celular: '+55 (11) 99999-9999', cep: '01310-100',
  numero: '100', complemento: ' Sala 2 ' };
const pagador = dadosPagadorValidos(entrada);

test('pagador sanitiza documento, celular e CEP sem inventar endereco', () => {
  assert.deepEqual(pagador, { nome: 'Ana Teste', documento: '24971563792',
    email: 'ana@example.invalid', celular: '11999999999', cep: '01310100',
    numero: '100', complemento: 'Sala 2' });
  assert.equal(dadosPagadorValidos({ ...entrada, documento: '11.444.777/0001-61' })?.documento,
    '11444777000161');
});

for (const [campo, valores] of Object.entries({
  nome: ['', ' ', 'A', '12345', 'Ana\nTeste'],
  documento: ['12345678901', '11111111111', '11.444.777/0001-62', 'abc24971563792'],
  email: ['ana', 'ana@', 'a@ex..com', 'a@example.com\nBcc: x'],
  celular: ['123', '1133334444', '00199999999', 'abc11999999999'],
  cep: ['12345', '00000000', '123456789', 'abc01310100'],
  numero: ['', ' ', '<script>', 'x'.repeat(21)],
  complemento: ['x'.repeat(256), '<script>', 'Sala\n2'],
})) test(`servidor rejeita ${campo} invalido`, () => {
  for (const valor of valores) assert.equal(dadosPagadorValidos({ ...entrada, [campo]: valor }), null);
});

test('complemento opcional nao entra no payload quando ausente', () => {
  const dados = dadosPagadorValidos({ ...entrada, complemento: '' });
  assert.ok(dados);
  const payload = payloadCliente('usuario-a', dados);
  assert.equal('complement' in payload, false);
  assert.equal('address' in payload, false);
  assert.equal('province' in payload, false);
  assert.equal('city' in payload, false);
});

function dependencias(reserva, respostas) {
  const chamadas = [];
  return { chamadas, deps: {
    rpc: async (nome, args) => {
      chamadas.push({ rpc: nome, args });
      return nome === 'billing_reservar_cliente_v1' ? reserva : {};
    },
    chamarAsaas: async (path, init = {}) => {
      chamadas.push({ path, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : undefined });
      const resposta = respostas.shift();
      if (resposta instanceof Error) throw resposta;
      assert.notEqual(resposta, undefined, `Chamada inesperada: ${path}`);
      return resposta;
    },
  } };
}

const cliente = { id: 'cus_a', ...payloadCliente('usuario-a', pagador) };

test('criacao envia os dados validados ao Asaas e vincula o ID ao usuario do servidor', async () => {
  const { deps, chamadas } = dependencias({ state: 'claim', id: 'local-a' }, [{ data: [] }, cliente]);
  assert.equal(await obterCliente('usuario-a', pagador, deps), 'cus_a');
  const post = chamadas.find(c => c.method === 'POST');
  assert.deepEqual(post, { path: '/customers', method: 'POST', body: {
    name: 'Ana Teste', cpfCnpj: '24971563792', email: 'ana@example.invalid',
    mobilePhone: '11999999999', postalCode: '01310100', addressNumber: '100',
    complement: 'Sala 2', externalReference: 'usuario-a',
  } });
  assert.deepEqual(chamadas.at(-1), { rpc: 'billing_salvar_cliente_v1',
    args: { p_id: 'local-a', p_gateway_id: 'cus_a' } });
});

test('cliente existente com os mesmos dados e reutilizado sem PUT nem POST', async () => {
  const { deps, chamadas } = dependencias({ state: 'ready', customer_id: 'cus_a' }, [cliente]);
  assert.equal(await obterCliente('usuario-a', pagador, deps), 'cus_a');
  assert.deepEqual(chamadas.filter(c => c.path).map(c => c.method), ['GET']);
});

test('cliente existente e atualizado no mesmo ID apenas com campos alterados', async () => {
  const { deps, chamadas } = dependencias({ state: 'ready', customer_id: 'cus_a' },
    [{ ...cliente, email: 'antigo@example.invalid', postalCode: '01311000' }, cliente]);
  assert.equal(await obterCliente('usuario-a', pagador, deps), 'cus_a');
  assert.deepEqual(chamadas.find(c => c.method === 'PUT'), { path: '/customers/cus_a',
    method: 'PUT', body: { email: 'ana@example.invalid', postalCode: '01310100' } });
  assert.equal(chamadas.some(c => c.method === 'POST'), false);
});

test('conciliacao atualiza cliente encontrado e nao cria duplicata', async () => {
  const { deps, chamadas } = dependencias({ state: 'reconcile', id: 'local-a' },
    [{ data: [{ ...cliente, mobilePhone: null }] }, cliente]);
  assert.equal(await obterCliente('usuario-a', pagador, deps), 'cus_a');
  assert.equal(chamadas.find(c => c.method === 'PUT')?.body.mobilePhone, '11999999999');
  assert.equal(chamadas.some(c => c.method === 'POST'), false);
});

test('cliente alheio nao e atualizado nem reutilizado', async () => {
  const { deps, chamadas } = dependencias({ state: 'ready', customer_id: 'cus_a' },
    [{ ...cliente, externalReference: 'usuario-b' }]);
  await assert.rejects(obterCliente('usuario-a', pagador, deps), /nao corresponde/);
  assert.equal(chamadas.some(c => ['PUT', 'POST'].includes(c.method)), false);
});

test('falha na atualizacao impede continuar e nao cria outro cliente', async () => {
  const { deps, chamadas } = dependencias({ state: 'ready', customer_id: 'cus_a' },
    [{ ...cliente, email: null }, new Error('Asaas Sandbox retornou HTTP 400.')]);
  await assert.rejects(obterCliente('usuario-a', pagador, deps), /HTTP 400/);
  assert.equal(chamadas.some(c => c.method === 'POST'), false);
});

test('timeout de criacao fica em conciliacao e nao e repetido sem certeza', async () => {
  const primeiro = dependencias({ state: 'claim', id: 'local-a' }, [{ data: [] }, new Error('timeout')]);
  await assert.rejects(obterCliente('usuario-a', pagador, primeiro.deps));
  assert.equal(primeiro.chamadas.at(-1).rpc, 'billing_cliente_incerteza_v1');
  const segundo = dependencias({ state: 'reconcile', id: 'local-a' }, [{ data: [] }]);
  await assert.rejects(obterCliente('usuario-a', pagador, segundo.deps), /conciliacao/);
  assert.equal(segundo.chamadas.some(c => c.method === 'POST'), false);
});

test('browser nao define preco, quota, identidade nem um plano fora do catalogo', () => {
  const form = new FormData();
  for (const [field, key] of Object.entries({ nomePagador: 'nome', documentoPagador: 'documento',
    emailPagador: 'email', celularPagador: 'celular', cepPagador: 'cep',
    numeroPagador: 'numero', complementoPagador: 'complemento' })) form.set(field, entrada[key]);
  form.set('price', '1'); form.set('quota', '99999'); form.set('usuario', 'usuario-b');
  const config = { PRO_MONTHLY_PRICE: '99', BUSINESS_MONTHLY_PRICE: '197',
    PRO_MONTHLY_AI_LIMIT: '200', BUSINESS_MONTHLY_AI_LIMIT: '1000' };
  for (const [code, price, ai] of [['PRO', 9900, 200], ['BUSINESS', 19700, 1000]]) {
    form.set('plan', code);
    const pedido = pedidoCheckout(form);
    assert.deepEqual(Object.keys(pedido), ['planCode', 'pagador']);
    assert.deepEqual(pedido.pagador, pagador);
    assert.equal(paidOffer(pedido.planCode, config).priceCents, price);
    assert.equal(paidOffer(pedido.planCode, config).aiQuota, ai);
  }
  for (const code of ['FREE', 'PRO_EVIL', 'ADMIN', 'pro']) {
    form.set('plan', code); assert.equal(pedidoCheckout(form).planCode, null);
  }
});

test('modal dos planos tem formulario unico por acao, prefill e nao coleta cartao', () => {
  for (const [planCode, planName, priceLabel] of [['PRO', 'Pro', 'R$ 99,00'], ['BUSINESS', 'Business', 'R$ 197,00']]) {
    const html = renderToStaticMarkup(createElement(AssinaturaDialog, { planCode, planName, priceLabel,
      nomeInicial: 'Nome da Conta', emailInicial: 'conta@example.invalid', reutilizar: false }));
    assert.match(html, /<dialog/);
    assert.match(html, new RegExp(`Assinar ${planName}`));
    assert.ok(html.includes(priceLabel));
    assert.match(html, /value="Nome da Conta"/);
    assert.match(html, /value="conta@example.invalid"/);
    assert.match(html, /name="documentoPagador"[^>]*\/>/);
    assert.doesNotMatch(html, /name="(?:price|quota|cardNumber|cvv|usuario)"/);
  }
});

test('retorno de successUrl consulta estado mas nao pode ativar plano', () => {
  const fonte = readFileSync(new URL('../app/(painel)/planos/retorno/page.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('retorno.tsx', fonte, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = ast.statements.filter(ts.isImportDeclaration).map(n => n.moduleSpecifier.text);
  assert.deepEqual(imports.sort(), ['next/link', '@/lib/supabase/server', '@/services/planos-service',
    '@/lib/planos/catalogo'].sort());
  const chamadas = [];
  const visitar = node => {
    if (ts.isCallExpression(node)) chamadas.push(node.expression.getText(ast));
    ts.forEachChild(node, visitar);
  };
  visitar(ast);
  assert.deepEqual(chamadas.sort(), ['obterPlanoAtual', 'criarClienteSupabaseServer', 'supabase.rpc', 'paidPlanCode'].sort());
  assert.match(fonte, /rpc\("billing_estado_atual_v1"\)/);
});
