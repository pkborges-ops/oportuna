import test from 'node:test';
import assert from 'node:assert/strict';
import { validarIsolamento } from '../scripts/validar-isolamento-rpc.mjs';

const usuarios = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'];
const perfis = ['20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002'];
const env = {
  HOMOLOG_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_chave_ficticia',
  HOMOLOG_CONTA_A_EMAIL: 'a@example.invalid', HOMOLOG_CONTA_A_SENHA: 'SENHA_NAO_LOGAR_A',
  HOMOLOG_CONTA_B_EMAIL: 'b@example.invalid', HOMOLOG_CONTA_B_SENHA: 'SENHA_NAO_LOGAR_B',
  HOMOLOG_PERFIL_A_ID: perfis[0], HOMOLOG_PERFIL_B_ID: perfis[1],
};
const resposta = (status, data) => ({ status, json: async () => data });
const pagina = [{ oportunidade: { id: '30000000-0000-4000-8000-000000000001' }, match: { score: 98, nivel: 'alta' }, favorito: false }];
function simular({ cruzado, proprio, mesmoUsuario = false, falhaLogin = false } = {}) {
  const chamadas = [];
  const fetch = async (url, init) => {
    chamadas.push({ url, method: init.method });
    assert.equal(new URL(url).origin, 'https://uzmgxxhiedevsxedgqij.supabase.co');
    assert.equal(init.redirect, 'error');
    if (url.includes('/auth/v1/token?')) {
      if (falhaLogin) return resposta(400, { message: env.HOMOLOG_CONTA_A_SENHA });
      const i = JSON.parse(init.body).email === env.HOMOLOG_CONTA_A_EMAIL ? 0 : 1;
      return resposta(200, { access_token: `TOKEN_NAO_LOGAR_${i}`, refresh_token: 'REFRESH_NAO_LOGAR', user: { id: usuarios[mesmoUsuario ? 0 : i] } });
    }
    const i = init.headers.Authorization === 'Bearer TOKEN_NAO_LOGAR_0' ? 0 : 1;
    assert.equal(init.method, 'GET');
    if (url.endsWith('/auth/v1/user')) return resposta(200, { id: usuarios[mesmoUsuario ? 0 : i] });
    if (url.includes('/perfis_empresa?')) return resposta(200, [{ id: perfis[i], usuario_id: usuarios[i] }]);
    assert.ok(url.includes('/rpc/listar_oportunidades_paginadas_v1?'));
    return new URL(url).searchParams.get('p_perfil_id') === perfis[i]
      ? (proprio?.() ?? resposta(200, pagina))
      : (cruzado?.() ?? resposta(403, { code: '42501', message: 'Perfil indisponível' }));
  };
  return { fetch, chamadas };
}

test('isolamento: quatro PASS exigem duas identidades, propriedade e rejeição explícita', async () => {
  const mock = simular();
  const r = await validarIsolamento(env, mock.fetch);
  assert.deepEqual(r.map(x => x.status), ['PASS', 'PASS', 'PASS', 'PASS']);
  assert.equal(mock.chamadas.filter(x => x.url.includes('/rpc/')).length, 4);
  assert.equal(mock.chamadas.filter(x => x.method === 'POST').length, 2);
  assert.doesNotMatch(JSON.stringify(r), /TOKEN_NAO_LOGAR|SENHA_NAO_LOGAR|REFRESH_NAO_LOGAR/);
});
test('isolamento: URL diferente, service role e configuração incompleta não fazem rede', async () => {
  for (const overrides of [
    { HOMOLOG_SUPABASE_URL: 'https://producao.invalid' },
    { HOMOLOG_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_PROIBIDO' },
    { HOMOLOG_SUPABASE_PUBLISHABLE_KEY: 'eyJhbGci.fake.jwt' },
    { HOMOLOG_CONTA_B_SENHA: '' },
    { HOMOLOG_PERFIL_B_ID: perfis[0] },
  ]) {
    const r = await validarIsolamento({ ...env, ...overrides }, () => assert.fail('Não deve conectar'));
    assert.ok(r.every(x => x.status === 'FAIL'));
  }
});
test('isolamento: diagnóstico indica campos inválidos sem reproduzir valores', async () => {
  const r = await validarIsolamento({ ...env,
    HOMOLOG_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_NAO_REVELAR',
    HOMOLOG_PERFIL_B_ID: 'UUID_NAO_REVELAR',
    HOMOLOG_CONTA_A_SENHA: '',
  }, () => assert.fail('Não deve conectar'));
  assert.ok(r.every(x => x.status === 'FAIL'));
  assert.match(r[0].mensagem, /HOMOLOG_SUPABASE_PUBLISHABLE_KEY inválida/);
  assert.match(r[0].mensagem, /HOMOLOG_PERFIL_B_ID ausente ou com formato inválido/);
  assert.match(r[0].mensagem, /HOMOLOG_CONTA_A_SENHA ausente/);
  assert.doesNotMatch(JSON.stringify(r), /NAO_REVELAR|SENHA_NAO_LOGAR|example.invalid/);
});
test('isolamento: mesma identidade ou login inválido não comprovam RLS', async () => {
  for (const config of [{ mesmoUsuario: true }, { falhaLogin: true }]) {
    const mock = simular(config);
    const r = await validarIsolamento(env, mock.fetch);
    assert.ok(r.every(x => x.status === 'FAIL'));
    assert.ok(mock.chamadas.every(x => !x.url.includes('/rpc/')));
    assert.doesNotMatch(JSON.stringify(r), /SENHA_NAO_LOGAR/);
  }
});
test('isolamento: perfil alheio com HTTP 200 inclusive vazio é FAIL', async () => {
  for (const data of [[], pagina]) {
    const r = await validarIsolamento(env, simular({ cruzado: () => resposta(200, data) }).fetch);
    assert.deepEqual(r.map(x => x.status), ['PASS', 'FAIL', 'PASS', 'FAIL']);
  }
});
test('isolamento: diagnóstico de login identifica a conta e sanitiza o erro externo', async () => {
  const casos = [
    [400, { code: 'invalid_credentials' }, /Conta B: e-mail ou senha do Oportuna inválidos/],
    [400, { error_code: 'email_not_confirmed' }, /Conta B: e-mail ainda não confirmado/],
    [429, {}, /Conta B: limite de tentativas atingido/],
    [503, {}, /Conta B: serviço de autenticação indisponível/],
    [401, {}, /Conta B: acesso ao serviço de autenticação rejeitado/],
    [400, { code: 'TOKEN_NAO_LOGAR' }, /Conta B: login recusado/],
  ];
  for (const [status, data, esperado] of casos) {
    const mock = simular();
    const r = await validarIsolamento(env, (url, init) => {
      if (url.includes('/auth/v1/token?') && JSON.parse(init.body).email === env.HOMOLOG_CONTA_B_EMAIL) {
        return resposta(status, { ...data, message: 'SENHA_NAO_LOGAR TOKEN_NAO_LOGAR REFRESH_NAO_LOGAR' });
      }
      return mock.fetch(url, init);
    });
    assert.ok(r.every(x => x.status === 'FAIL'));
    assert.match(r[0].mensagem, /Conta A: login confirmado/);
    assert.match(r[0].mensagem, esperado);
    assert.ok(mock.chamadas.every(x => !x.url.includes('/rpc/')));
    assert.doesNotMatch(JSON.stringify(r), /SENHA_NAO_LOGAR|TOKEN_NAO_LOGAR|REFRESH_NAO_LOGAR|example.invalid/);
  }
});
test('isolamento: timeout, 401, 5xx e 403 genérico não viram PASS', async () => {
  for (const cruzado of [
    () => { throw new Error('TOKEN_NAO_LOGAR_0'); },
    () => resposta(401, { code: '42501', message: 'Perfil indisponível' }),
    () => resposta(500, { code: '42501', message: 'Perfil indisponível' }),
    () => resposta(403, { code: '42501', message: 'permission denied' }),
  ]) {
    const r = await validarIsolamento(env, simular({ cruzado }).fetch);
    assert.deepEqual(r.map(x => x.status), ['PASS', 'FAIL', 'PASS', 'FAIL']);
    assert.doesNotMatch(JSON.stringify(r), /TOKEN_NAO_LOGAR/);
  }
});
test('isolamento: controle próprio vazio ou sem matching invalida conclusão cruzada', async () => {
  for (const data of [[], [{ ...pagina[0], match: null }]]) {
    const r = await validarIsolamento(env, simular({ proprio: () => resposta(200, data) }).fetch);
    assert.ok(r.every(x => x.status === 'FAIL'));
  }
});
