import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const claim = n => ({ entrega_id: id(n), token: id(n + 100) });
function fixture(env = { ASAAS_ENVIRONMENT: 'sandbox' }, outcomes = []) {
  const calls = [];
  let creation = 0;
  const client = { rpc: async (name, args) => {
    calls.push({ name, args });
    const result = outcomes.shift();
    if (result instanceof Error) throw result;
    return result;
  } };
  const { outputText } = ts.transpileModule(readFileSync(new URL('../lib/billing/entregas-financeiras.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  new Function('require', 'exports', 'process', outputText)(name => {
    if (name === 'server-only') return {};
    assert.equal(name, '@/lib/supabase/admin', 'recuperacao nao deve depender de Asaas ou IA');
    return { criarClienteSupabaseAdmin: () => { creation++; return client; } };
  }, exports, { env });
  return { run: exports.recuperarEntregasFinanceiras, calls, client, creation: () => creation };
}
const ok = data => ({ data, error: null });

test('recuperacao financeira entrega pendencias sem novo webhook ou chamada Asaas', async () => {
  const f = fixture(undefined, [ok([claim(1), claim(2)]), ok('delivered'), ok('duplicate')]);
  assert.deepEqual(await f.run(), { reservadas: 2, entregues: 1, duplicadas: 1, pendentes: 0, obsoletas: 0, falhas: 0 });
  assert.equal(f.creation(), 1);
  assert.deepEqual(f.calls, [
    { name: 'billing_concessoes_reservar_entregas_v1', args: { p_ambiente: 'sandbox', p_limite: 20 } },
    ...[1, 2].map(n => ({ name: 'billing_concessoes_entregar_v1', args: {
      p_ambiente: 'sandbox', p_entrega: id(n), p_token: id(n + 100),
    } })),
  ]);
});

for (const environment of ['sandbox', 'production']) {
  test(`recuperacao ${environment} usa ambiente do servidor sem exigir checkout/canario`, async () => {
    const f = fixture({ ASAAS_ENVIRONMENT: environment }, [ok([])]);
    assert.equal((await f.run(1, f.client)).reservadas, 0);
    assert.equal(f.creation(), 0);
    assert.equal(f.calls[0].args.p_ambiente, environment);
  });
}

test('consumidor ausente e revisao obsoleta nao sao tratados como entrega concluida', async () => {
  const states = ['pending', 'stale', 'lease_lost', 'not_found', 'retry', 'unknown'];
  const f = fixture(undefined, [ok(states.map((_, i) => claim(i + 1))), ...states.map(ok)]);
  assert.deepEqual(await f.run(), { reservadas: 6, entregues: 0, duplicadas: 0, pendentes: 1, obsoletas: 3, falhas: 2 });
});

test('erro de transporte/SQL nao confirma entrega e nao impede recuperar demais itens', async () => {
  const f = fixture(undefined, [ok([claim(1), claim(2), claim(3)]), new Error('segredo ficticio'),
    { data: null, error: { message: 'dado privado ficticio' } }, ok('delivered')]);
  const result = await f.run();
  assert.equal(result.falhas, 2);
  assert.equal(result.entregues, 1);
  assert.equal(JSON.stringify(result).includes('ficticio'), false);
  assert.equal(f.calls.length, 4);
});

test('configuracao de ambiente ausente ou invalida falha antes de criar cliente', async () => {
  for (const environment of [undefined, '', 'prod', 'SANDBOX', 'sandbox ']) {
    const f = fixture({ ASAAS_ENVIRONMENT: environment });
    await assert.rejects(() => f.run(), /Configuracao/);
    assert.equal(f.creation(), 0);
    assert.equal(f.calls.length, 0);
  }
});

test('limites de lote invalidos rejeitados sem acesso ao banco', async () => {
  for (const limit of [0, -1, 101, 1.5, NaN, '20', null]) {
    const f = fixture();
    await assert.rejects(() => f.run(limit), /Configuracao/);
    assert.equal(f.creation(), 0);
  }
});

test('reserva malformada ou com erro nao e despachada nem vaza detalhes', async () => {
  for (const response of [ok(null), ok({}), ok([{ entrega_id: 'invalido', token: id(1) }]),
    ok([{ entrega_id: id(1), token: 'invalido' }]), ok([null]), { data: [], error: { message: 'segredo' } }]) {
    const f = fixture(undefined, [response]);
    await assert.rejects(() => f.run(), { message: 'Nao foi possivel reservar entregas financeiras.' });
    assert.equal(f.calls.length, 1);
  }
});
