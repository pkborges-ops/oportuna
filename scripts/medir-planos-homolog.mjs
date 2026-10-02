// Medição manual: somente projeto isolado de homologação, sem service role.
// Credenciais são lidas do ambiente e nunca incluídas na saída.
import { performance } from 'node:perf_hooks';

const ORIGEM = 'https://uzmgxxhiedevsxedgqij.supabase.co';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CENARIOS = [
  ['Recomendadas', { p_ordenacao: 'recomendadas' }],
  ['Maior aderência', { p_ordenacao: 'maior_aderencia' }],
  ['Aderência alta', { p_ordenacao: 'recomendadas', p_aderencia: 'alta' }],
  ['Busca textual', { p_ordenacao: 'recomendadas', p_busca: 'software' }],
];

function configurar() {
  const env = process.env;
  const chave = env.HOMOLOG_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (env.HOMOLOG_SUPABASE_URL && env.HOMOLOG_SUPABASE_URL !== ORIGEM)
    throw new Error('URL diferente da homologação fixada');
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(chave ?? ''))
    throw new Error('chave publicável da homologação ausente ou inválida');
  const plano = env.HOMOLOG_TESTE_PLANO;
  if (!['FREE', 'PRO'].includes(plano)) throw new Error('escolha FREE ou PRO');
  const conta = {
    plano,
    email: env.HOMOLOG_CONTA_EMAIL?.trim(),
    senha: env.HOMOLOG_CONTA_SENHA,
    perfil: env.HOMOLOG_PERFIL_ID?.trim(),
  };
  if (!conta.email || !conta.senha || !UUID.test(conta.perfil ?? ''))
    throw new Error('preencha e-mail, senha e UUID do perfil da conta');
  return { chave, conta };
}

async function chamar(chave, caminho, token, corpo) {
  const inicio = performance.now();
  const resposta = await fetch(`${ORIGEM}${caminho}`, {
    method: corpo === undefined ? 'GET' : 'POST',
    headers: {
      apikey: chave,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    signal: AbortSignal.timeout(45000),
    redirect: 'error',
  });
  const texto = await resposta.text();
  const duracao = performance.now() - inicio;
  let dados;
  try { dados = JSON.parse(texto); } catch { dados = null; }
  return { status: resposta.status, duracao, bytes: Buffer.byteLength(texto), dados };
}

async function autenticar(chave, conta) {
  const login = await chamar(chave, '/auth/v1/token?grant_type=password', null,
    { email: conta.email, password: conta.senha });
  if (login.status !== 200 || !login.dados?.access_token)
    throw new Error(`${conta.plano}: autenticação não confirmada`);
  const token = login.dados.access_token;
  const usuario = await chamar(chave, '/auth/v1/user', token);
  if (usuario.status !== 200 || !UUID.test(usuario.dados?.id ?? '') ||
      usuario.dados.id !== login.dados.user?.id)
    throw new Error(`${conta.plano}: identidade da sessão não confirmada`);
  const perfil = await chamar(chave,
    `/rest/v1/perfis_empresa?select=id,usuario_id&id=eq.${conta.perfil}`, token);
  if (perfil.status !== 200 || perfil.dados?.length !== 1 ||
      perfil.dados[0].usuario_id !== usuario.dados.id)
    throw new Error(`${conta.plano}: perfil não pertence à conta`);
  const plano = await chamar(chave, '/rest/v1/rpc/plano_atual_v1', token);
  if (plano.status !== 200 || plano.dados !== conta.plano)
    throw new Error(`${conta.plano}: plano não confirmado na homologação`);
  return { token, perfil: conta.perfil };
}

function estatisticas(valores) {
  const ordenados = [...valores].sort((a, b) => a - b);
  return {
    minimo: ordenados[0], maximo: ordenados.at(-1),
    media: valores.reduce((a, b) => a + b, 0) / valores.length,
    mediana: ordenados[Math.floor(ordenados.length / 2)],
  };
}

function paginaValida(resposta, plano, permitirVazia = false) {
  return resposta.status === 200 && Array.isArray(resposta.dados) &&
    resposta.dados.length >= (permitirVazia ? 0 : 1) && resposta.dados.length <= 21 &&
    resposta.dados.every(item => UUID.test(item?.oportunidade?.id ?? '') &&
      typeof item.favorito === 'boolean' &&
      (plano === 'FREE' ? item.match === null || Number.isInteger(item?.match?.score)
        : Number.isInteger(item?.match?.score)));
}

function caminhoPagina(perfil, filtros) {
  return `/rest/v1/rpc/listar_oportunidades_paginadas_v2?${new URLSearchParams({
    p_perfil_id: perfil, p_pagina: '1', p_visao: 'ativas', ...filtros,
  })}`;
}

async function medir(chave, conta, plano) {
  for (const [cenario, filtros] of CENARIOS) {
    const amostras = [];
    for (let i = 0; i < 3; i++) {
      let resposta;
      try { resposta = await chamar(chave, caminhoPagina(conta.perfil, filtros), conta.token); }
      catch { throw new Error(`${plano} / ${cenario} / execução ${i + 1}: rede ou timeout`); }
      const valido = paginaValida(resposta, plano, cenario === 'Aderência alta');
      console.log(`${plano} | ${cenario} | ${i + 1} | HTTP ${resposta.status} | ` +
        `${resposta.duracao.toFixed(1)} ms | ${Array.isArray(resposta.dados) ? resposta.dados.length : 0} itens | ` +
        `${resposta.bytes} bytes | ${valido ? 'PASS' : 'FAIL'}`);
      if (!valido) throw new Error(`${plano} / ${cenario}: resposta funcional inválida`);
      amostras.push(resposta.duracao);
    }
    const s = estatisticas(amostras);
    console.log(`${plano} | ${cenario} | mínimo ${s.minimo.toFixed(1)} | máximo ${s.maximo.toFixed(1)} | ` +
      `média ${s.media.toFixed(1)} | mediana ${s.mediana.toFixed(1)} ms`);
  }
}

async function testarQuartoDireto(chave, conta) {
  const dia = await chamar(chave, '/rest/v1/rpc/plano_dia_v1', conta.token);
  if (dia.status !== 200 || !/^\d{4}-\d{2}-\d{2}$/.test(dia.dados ?? ''))
    throw new Error('dia de cota não confirmado');
  const caminhoContagem = `/rest/v1/score_desbloqueios?select=oportunidade_id&dia=eq.${dia.dados}`;
  const pagina = await chamar(chave,
    caminhoPagina(conta.perfil, { p_ordenacao: 'recomendadas' }), conta.token);
  const candidato = Array.isArray(pagina.dados) ? pagina.dados.find(item => item.match === null) : null;
  if (!candidato || !UUID.test(candidato.oportunidade?.id ?? ''))
    throw new Error('não foi encontrado score novo para testar bloqueio direto');
  const antes = await chamar(chave, caminhoContagem, conta.token);
  if (antes.status !== 200 || !Array.isArray(antes.dados))
    throw new Error(`consulta autenticada da cota falhou (HTTP ${antes.status})`);
  if (antes.dados.length !== 3)
    throw new Error(`cota Free inicial deve ser três hoje; observados ${antes.dados.length}`);
  const resposta = await chamar(chave, '/rest/v1/rpc/desbloquear_score_v1', conta.token,
    { p_perfil_id: conta.perfil, p_oportunidade_id: candidato.oportunidade.id });
  const depois = await chamar(chave, caminhoContagem, conta.token);
  const passou = resposta.status === 200 && resposta.dados === false &&
    depois.status === 200 && Array.isArray(depois.dados) && depois.dados.length === 3;
  console.log(`FREE | quarto desbloqueio direto | HTTP ${resposta.status} | ` +
    `${passou ? 'PASS: rejeitado e cota permaneceu em 3' : 'FAIL'}`);
  if (!passou) throw new Error('bloqueio direto acima da cota não comprovado');
}

async function testarProSemLimite(chave, conta) {
  const pagina = await chamar(chave,
    caminhoPagina(conta.perfil, { p_ordenacao: 'recomendadas' }), conta.token);
  if (!paginaValida(pagina, 'PRO') || pagina.dados.length < 4)
    throw new Error('página Pro não tem quatro oportunidades válidas');
  for (const item of pagina.dados.slice(0, 4)) {
    const resposta = await chamar(chave, '/rest/v1/rpc/desbloquear_score_v1', conta.token,
      { p_perfil_id: conta.perfil, p_oportunidade_id: item.oportunidade.id });
    if (resposta.status !== 200 || resposta.dados !== true)
      throw new Error('Pro não liberou quatro scores via RPC');
  }
  console.log('PRO | quatro desbloqueios diretos | HTTP 200 | PASS: sem cota diária');
}

try {
  const { chave, conta } = configurar();
  const sessao = await autenticar(chave, conta);
  if (conta.plano === 'FREE') await testarQuartoDireto(chave, sessao);
  else await testarProSemLimite(chave, sessao);
  await medir(chave, sessao, conta.plano);
} catch (erro) {
  // Somente mensagens locais fixas; nunca refletir resposta da API ou segredo.
  console.error(`FAIL | ${erro instanceof Error ? erro.message : 'falha inesperada'}`);
  process.exitCode = 1;
}
