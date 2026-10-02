// Execução manual. Não carrega .env, não grava arquivos, não usa service role.
// Autenticação cria sessões Auth; tabelas da aplicação são somente consultadas.
import { pathToFileURL } from 'node:url';

const ORIGEM = 'https://uzmgxxhiedevsxedgqij.supabase.co';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROTULOS = ['Conta A / Perfil A', 'Conta A / Perfil B', 'Conta B / Perfil B', 'Conta B / Perfil A'];
const falhas = mensagem => ROTULOS.map(caso => ({ caso, status: 'FAIL', mensagem }));

function configurar(env) {
  const erros = [];
  const rpc = env.HOMOLOG_ISOLAMENTO_RPC === 'v2'
    ? 'listar_oportunidades_paginadas_v2' : 'listar_oportunidades_paginadas_v1';
  if (env.HOMOLOG_ISOLAMENTO_RPC && !['v1', 'v2'].includes(env.HOMOLOG_ISOLAMENTO_RPC))
    erros.push('HOMOLOG_ISOLAMENTO_RPC deve ser v1 ou v2');
  const key = env.HOMOLOG_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (env.HOMOLOG_SUPABASE_URL && env.HOMOLOG_SUPABASE_URL !== ORIGEM) erros.push('HOMOLOG_SUPABASE_URL deve apontar ao projeto de homologação fixado no script');
  // Aceita exclusivamente a chave publicável moderna; rejeita JWT e sb_secret_.
  if (!key) erros.push('HOMOLOG_SUPABASE_PUBLISHABLE_KEY ausente');
  else if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) erros.push('HOMOLOG_SUPABASE_PUBLISHABLE_KEY inválida: use a chave completa sb_publishable_, sem aspas');
  const contas = ['A', 'B'].map(letra => ({
    email: env[`HOMOLOG_CONTA_${letra}_EMAIL`]?.trim(),
    senha: env[`HOMOLOG_CONTA_${letra}_SENHA`],
    perfil: env[`HOMOLOG_PERFIL_${letra}_ID`]?.trim().toLowerCase(),
  }));
  for (const [i, c] of contas.entries()) {
    const letra = i === 0 ? 'A' : 'B';
    if (!c.email) erros.push(`HOMOLOG_CONTA_${letra}_EMAIL ausente`);
    if (!c.senha) erros.push(`HOMOLOG_CONTA_${letra}_SENHA ausente`);
    if (!UUID.test(c.perfil ?? '')) erros.push(`HOMOLOG_PERFIL_${letra}_ID ausente ou com formato inválido: copie o UUID da URL de edição do perfil`);
  }
  if (contas[0].email && contas[0].email.toLowerCase() === contas[1].email?.toLowerCase()) erros.push('as contas A e B precisam ter emails distintos');
  if (contas[0].perfil && contas[0].perfil === contas[1].perfil) erros.push('os perfis A e B precisam ter UUIDs distintos');
  if (erros.length) return { erros };
  return { key, contas, rpc };
}

// Não retorna mensagens/corpos externos para o terminal, mesmo em erros de rede.
async function requisitar(fetchImpl, key, path, token, body) {
  const response = await fetchImpl(`${ORIGEM}${path}`, {
    method: body ? 'POST' : 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(45000),
    headers: {
      apikey: key,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() };
}

function erroLogin(auth) {
  // Códigos conhecidos viram textos fixos; nunca refletir message/error externos.
  const codigo = auth.data?.code ?? auth.data?.error_code;
  switch (codigo) {
    case 'invalid_credentials': return 'e-mail ou senha do Oportuna inválidos, ou conta inexistente na homologação; não use a senha do Gmail';
    case 'email_not_confirmed': return 'e-mail ainda não confirmado; confirme o cadastro da homologação';
    case 'email_provider_disabled': return 'login por e-mail desabilitado na homologação';
    case 'user_banned': return 'conta bloqueada pelo serviço de autenticação';
    case 'over_request_rate_limit': return 'limite de tentativas atingido; aguarde antes de repetir';
    default:
      if (auth.status === 429) return 'limite de tentativas atingido; aguarde antes de repetir';
      if (auth.status >= 500) return 'serviço de autenticação indisponível';
      if (auth.status === 401 || auth.status === 403) return 'acesso ao serviço de autenticação rejeitado; confira a chave publicável do projeto de homologação';
      return 'login recusado ou resposta de autenticação inválida; confira o cadastro por e-mail e senha na homologação';
  }
}

async function autenticar(fetchImpl, key, conta) {
  const auth = await requisitar(fetchImpl, key, '/auth/v1/token?grant_type=password', null,
    { email: conta.email, password: conta.senha });
  if (auth.status !== 200 || !auth.data?.access_token) return { erro: erroLogin(auth) };
  const token = auth.data.access_token;
  const usuario = await requisitar(fetchImpl, key, '/auth/v1/user', token);
  if (usuario.status !== 200 || !UUID.test(usuario.data?.id ?? '') || usuario.data.id !== auth.data.user?.id) return { erro: 'login respondeu, mas a identidade da sessão não pôde ser confirmada' };
  return { token, id: usuario.data.id };
}

function paginaValida(r, rpc) {
  return r.status === 200 && Array.isArray(r.data) && r.data.length > 0 && r.data.length <= 21 && r.data.every(row =>
    UUID.test(row?.oportunidade?.id ?? '') && typeof row.favorito === 'boolean' &&
    (rpc === 'listar_oportunidades_paginadas_v2' && row.match === null ||
      Number.isInteger(row.match?.score) && row.match.score >= 0 && row.match.score <= 100 &&
      row.match.nivel === (row.match.score >= 70 ? 'alta' : row.match.score >= 40 ? 'media' : 'baixa')));
}

export async function validarIsolamento(env = process.env, fetchImpl = globalThis.fetch) {
  const config = configurar(env);
  if (config.erros) return falhas(`Não executado: ${config.erros.join('; ')}.`);
  const { key, contas, rpc } = config;
  const sessoes = [];
  for (const conta of contas) {
    try {
      sessoes.push(await autenticar(fetchImpl, key, conta));
    } catch {
      sessoes.push({ erro: 'falha de rede, timeout ou resposta inválida na autenticação' });
    }
  }
  if (sessoes.some(s => s.erro)) {
    const diagnostico = sessoes.map((s, i) => `Conta ${i === 0 ? 'A' : 'B'}: ${s.erro ?? 'login confirmado'}`).join('; ');
    return falhas(`Não executado: ${diagnostico}.`);
  }
  if (sessoes[0].id === sessoes[1].id) return falhas('Não executado: os dois logins correspondem ao mesmo usuário; use duas contas reais distintas.');

  // Confirma propriedade real usando SELECT sob a sessão de cada usuário.
  try {
    for (let i = 0; i < contas.length; i++) {
      const perfil = await requisitar(fetchImpl, key,
        `/rest/v1/perfis_empresa?select=id,usuario_id&id=eq.${contas[i].perfil}`, sessoes[i].token);
      if (perfil.status !== 200 || !Array.isArray(perfil.data) || perfil.data.length !== 1 ||
          perfil.data[0].id !== contas[i].perfil || perfil.data[0].usuario_id !== sessoes[i].id) {
        return falhas('Não executado: cada perfil deve existir e pertencer à sua respectiva conta.');
      }
    }
  } catch {
    return falhas('Não executado: não foi possível confirmar a propriedade dos perfis.');
  }

  const combinacoes = [[0, 0], [0, 1], [1, 1], [1, 0]];
  const respostas = [];
  for (const [conta, perfil] of combinacoes) {
    try {
      // GET de função STABLE: PostgREST executa em transação somente leitura.
      respostas.push(await requisitar(fetchImpl, key,
        `/rest/v1/rpc/${rpc}?p_perfil_id=${contas[perfil].perfil}&p_ordenacao=recomendadas&p_pagina=1${rpc.endsWith('_v2') ? '&p_visao=ativas' : ''}`, sessoes[conta].token));
    } catch {
      respostas.push(null);
    }
  }
  const controlesValidos = [0, 2].every(i => respostas[i] && paginaValida(respostas[i], rpc));
  return respostas.map((r, i) => {
    const proprio = i === 0 || i === 2;
    const bloqueado = r?.status === 403 && r.data?.code === '42501' && r.data?.message === 'Perfil indisponível';
    const passou = proprio ? Boolean(r && paginaValida(r, rpc)) : controlesValidos && bloqueado;
    let mensagem;
    if (passou) mensagem = proprio ? 'Perfil próprio retornou página válida com matching.' : 'Perfil alheio rejeitado explicitamente pela RPC.';
    else if (!r) mensagem = 'Erro de rede, timeout ou resposta inválida; isolamento não comprovado.';
    else if (proprio) mensagem = 'Perfil próprio não retornou página válida; verifique autenticação, permissões e massa de homologação.';
    else if (!controlesValidos) mensagem = 'Controles com perfis próprios falharam; bloqueio cruzado não comprova isolamento.';
    else if (r.status === 200) mensagem = 'RPC aceitou perfil alheio, mesmo que o resultado esteja vazio.';
    else mensagem = 'Erro diferente da rejeição de perfil esperada; isolamento não comprovado.';
    return { caso: ROTULOS[i], status: passou ? 'PASS' : 'FAIL', mensagem };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let resultados;
  try { resultados = await validarIsolamento(); }
  catch { resultados = falhas('Falha inesperada; nenhuma evidência de isolamento obtida.'); }
  for (const r of resultados) console.log(`${r.status} | ${r.caso} | ${r.mensagem}`);
  process.exitCode = resultados.every(r => r.status === 'PASS') ? 0 : 1;
}
