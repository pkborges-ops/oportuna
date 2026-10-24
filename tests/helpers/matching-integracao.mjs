// Executado em processo isolado: doubles apenas nas fronteiras externas.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { test, beforeEach } from "node:test";

const perfilRow = {
  id: "p1",
  usuario_id: "u1",
  nome_empresa: "Empresa SC",
  cnpj: "",
  segmento: "tecnologia",
  porte: "ME",
  uf: "SC",
  palavras_chave: ["software"],
  status: "ativo",
  criado_em: "2026-09-18",
};
const opRow = {
  id: "o1",
  codigo: "001",
  origem: "PNCP",
  tipo: "LICITACAO",
  titulo: "Software nacional",
  orgao: "Órgão",
  cidade: "São Paulo",
  uf: "SP",
  objeto: "software tecnologia",
  tags: [],
  modalidade: "Pregão",
  valor_estimado: 1000,
  data_publicacao: "2026-09-01",
  data_abertura: "2026-10-01",
  status: "aberta",
  score: 99,
};
import { state } from "./matching-doubles.mjs";
const self = JSON.stringify(
  new URL("./matching-doubles.mjs", import.meta.url).href,
);
const mocks = {
  "@/lib/supabase/server": `import {client} from ${self}; export async function criarClienteSupabaseServer() { return client(); }`,
  "@/lib/supabase/admin": `import {client} from ${self}; export function criarClienteSupabaseAdmin() { return client("admin"); }`,
  "@/lib/openai/analise-oportunidade": `import {state} from ${self}; import {resultadoV2} from ${JSON.stringify(new URL("./analise-v2-fixture.mjs", import.meta.url).href)}; export async function gerarAnaliseOportunidade() { state.aiCalls++; return resultadoV2; }`,
  "next/navigation": `export function redirect(url) { throw Object.assign(new Error('redirect'), {url}); } export function notFound() { throw Error('not-found'); }`,
  "next/cache": "export function revalidatePath() {}",
  "next/link": `export {default} from ${JSON.stringify(new URL("./mock-link.mjs", import.meta.url).href)}`,
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (mocks[specifier])
      return {
        url: `data:text/javascript,${encodeURIComponent(mocks[specifier])}`,
        shortCircuit: true,
      };
    return nextResolve(specifier, context);
  },
});
// Imports dinâmicos após registrar as fronteiras simuladas.
const { default: Listagem } =
  await import("../../app/(painel)/oportunidades/page.tsx");
const { default: Detalhes } =
  await import("../../app/(painel)/oportunidades/[id]/page.tsx");
const { alternarFavorito, analisarOportunidade, desbloquearScore } =
  await import("../../app/(painel)/oportunidades/actions.ts");
const { listarPerfis } = await import("../../services/perfis-service.ts");
const renderList = async (query) =>
  renderToStaticMarkup(
    await Listagem({ searchParams: Promise.resolve(query) }),
  );
const renderDetail = async (query) =>
  renderToStaticMarkup(
    await Detalhes({
      params: Promise.resolve({ id: "o1" }),
      searchParams: Promise.resolve(query),
    }),
  );
const form = (values) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
beforeEach(() => {
  state.tables = {
    perfis_empresa: [
      structuredClone(perfilRow),
      {
        ...perfilRow,
        id: "privado",
        usuario_id: "u2",
        nome_empresa: "Perfil privado",
      },
    ],
    oportunidades_editais: [structuredClone(opRow)],
    oportunidades_favoritos: [],
    analises_oportunidades: [],
    ia_resultados_v1: [],
  };
  state.calls = [];
  state.franquia = undefined; state.estadoIA = null; state.erroIA = null; state.codigoReserva = null;
  state.aiCalls = 0;
  state.rpcRows = undefined;
  state.rpcError = null;
  state.plan = 'PRO';
  state.scoreUnlocks = new Set();
  state.aiReservation = 'reserva-1';
});

test("Free preserva ranking global e revela score somente após desbloqueio", async () => {
  state.plan = "FREE";
  const antes = await renderList({ perfilId: "p1", ordenacao: "maior_aderencia" });
  assert.match(antes, /Software nacional/);
  assert.match(antes, /Desbloquear score/);
  assert.doesNotMatch(antes, /90% aderência/);
  assert.match(await renderDetail({ perfilId: "p1" }), /Desbloquear score/);

  await assert.rejects(
    desbloquearScore(form({ oportunidadeId: "o1", perfilId: "p1", redirectTo: "/oportunidades?perfilId=p1" })),
    (error) => error.url === "/oportunidades?perfilId=p1",
  );
  assert.match(await renderList({ perfilId: "p1", ordenacao: "maior_aderencia" }), /90% aderência/);
  assert.match(await renderDetail({ perfilId: "p1" }), /90% aderência/);
});

test("lista com perfil único: nacional, score determinístico, detalhes e favoritos preservam filtros", async () => {
  const html = await renderList({
    busca: "software",
    status: "aberta",
    uf: "SP",
    aderencia: "alta",
    ordenacao: "mais_novas",
  });
  assert.match(html, /90% aderência/);
  assert.doesNotMatch(html, /99%|Perfil privado/);
  assert.match(
    html,
    /\/oportunidades\/o1\?busca=software&amp;status=aberta&amp;uf=SP&amp;perfilId=p1&amp;aderencia=alta&amp;ordenacao=mais_novas/,
  );
  assert.match(
    html,
    /name="redirectTo" value="\/oportunidades\?busca=software&amp;status=aberta&amp;uf=SP&amp;perfilId=p1&amp;aderencia=alta&amp;ordenacao=mais_novas"/,
  );
  const call = state.calls.find((c) => c.rpc === "listar_oportunidades_paginadas_v2");
  assert.equal(call.args.p_status, "aberta");
  assert.equal(call.args.p_uf, "SP");
  assert.equal(call.args.p_busca, "software");
  assert.equal(state.aiCalls, 0);
});
test("filtros existentes e aderência alteram os resultados", async () => {
  for (const query of [
    { uf: "SC" },
    { status: "encerrada" },
    { busca: "hospital" },
    { aderencia: "baixa" },
  ]) {
    assert.match(await renderList(query), /Nenhuma oportunidade encontrada/);
  }
  assert.match(await renderList({}), /Software nacional/);
  assert.equal(state.calls.filter(c=>c.rpc).at(-1).args.p_uf, null);
});
test("vários perfis ativos exigem escolha; sem seleção não há score global nem filtro", async () => {
  state.tables.perfis_empresa.push({ ...perfilRow, id: "p2" });
  const html = await renderList({ aderencia: "baixa" });
  assert.match(html, /Selecione um perfil para calcular aderência/);
  assert.match(html, /Software nacional/);
  assert.doesNotMatch(html, /% aderência|% match|name="aderencia"/);
});
test("sem perfis próprios mostra CTA", async () => {
  state.tables.perfis_empresa = state.tables.perfis_empresa.filter(
    (p) => p.usuario_id === "u2",
  );
  assert.match(await renderList({}), /href="\/perfis\/novo"/);
});
test("perfil alheio/inválido/repetido é ignorado nas duas telas, sem fallback", async () => {
  assert.deepEqual(
    (await listarPerfis()).map((p) => p.id),
    ["p1"],
  );
  for (const perfilId of ["privado", "invalid", ["p1", "privado"]]) {
    const html = await renderList({ perfilId, aderencia: "baixa" });
    const detalhe = await renderDetail({ perfilId });
    assert.doesNotMatch(html + detalhe, /% aderência|Perfil privado/);
    assert.equal(
      state.calls.some((c) => c.table === "analises_oportunidades"),
      false,
    );
  }
});
test("detalhes usam mesmo perfil e separam aderência da IA persistida", async () => {
  state.tables.analises_oportunidades.push({
    id: "a1",
    usuario_id: "u1",
    oportunidade_id: "o1",
    perfil_id: "p1",
    score: 81,
    resumo: "IA manual",
    justificativa: "Teste",
    pontos_atencao: [],
    criado_em: "2026-09-18",
  });
  const html = await renderDetail({
    perfilId: "p1",
    busca: "software",
    status: "aberta",
    uf: "SP",
    aderencia: "alta",
    ordenacao: "mais_novas",
  });
  assert.match(html, /90% aderência/);
  assert.doesNotMatch(html, /81% · análise por IA/);
  assert.match(html, /Justificativa histórica/);
  assert.match(html, /Nome do perfil na data da análise não registrado/);
  assert.match(html, /Palavras encontradas: software/);
  assert.match(
    html,
    /name="redirectTo" value="\/oportunidades\/o1\?busca=software&amp;status=aberta&amp;uf=SP&amp;perfilId=p1&amp;aderencia=alta&amp;ordenacao=mais_novas"/,
  );
  assert.equal(state.aiCalls, 0);
});
test("favoritar/desfavoritar executa action real e preserva destino completo", async () => {
  const destino =
    "/oportunidades?perfilId=p1&busca=software&status=aberta&uf=SP&aderencia=alta&ordenacao=mais_novas";
  for (const favoritoAtual of ["false", "true"]) {
    await assert.rejects(
      alternarFavorito(
        form({ oportunidadeId: "o1", favoritoAtual, redirectTo: destino }),
      ),
      (e) => e.url === destino,
    );
    assert.equal(
      state.tables.oportunidades_favoritos.length,
      favoritoAtual === "false" ? 1 : 0,
    );
  }
  assert.equal(state.aiCalls, 0);
});
test("IA continua manual e reutiliza análise persistida; matching não escreve", async () => {
  await renderList({});
  await renderDetail({ perfilId: "p1" });
  assert.equal(
    state.calls.some((c) => c.operation !== "select"),
    false,
  );
  assert.equal(state.aiCalls, 0);
  // Mesmo baixa aderência não bloqueia análise manual.
  state.tables.oportunidades_editais[0].objeto = "material hospitalar";
  state.tables.oportunidades_editais[0].titulo = "Material";
  const data = form({ oportunidadeId: "o1", perfilId: "p1" });
  await assert.rejects(analisarOportunidade(data), (e) =>
    e.url.includes("perfilId=p1"),
  );
  assert.equal(state.aiCalls, 1);
  assert.equal(state.tables.ia_resultados_v1[0].score, null);
  assert.equal(state.tables.ia_resultados_v1[0].versao_schema, 2);
  assert.equal(state.calls.find(c => c.rpc === "ia_reservar_v1").contexto, "usuario");
  assert.equal(state.calls.find(c => c.rpc === "ia_iniciar_v1").contexto, "admin");
  assert.equal(state.calls.find(c => c.rpc === "ia_finalizar_v1").contexto, "admin");
  await assert.rejects(analisarOportunidade(data), (e) =>
    e.url.includes("existente"),
  );
  assert.equal(state.aiCalls, 1);
});
test("ação manual rejeita perfil de outro usuário antes de chamar IA", async () => {
  await assert.rejects(
    analisarOportunidade(form({ oportunidadeId: "o1", perfilId: "privado" })),
    (e) => e.url.includes("erro="),
  );
  assert.equal(state.aiCalls, 0);
});

test("trocar perfil recalcula o mesmo item e não reutiliza IA de outro perfil", async () => {
  state.tables.perfis_empresa.push({
    ...perfilRow,
    id: "p2",
    nome_empresa: "Empresa hospitalar",
    palavras_chave: ["hospital"],
    segmento: "medicina",
    uf: "SP",
  });
  state.tables.analises_oportunidades.push({
    id: "a1",
    usuario_id: "u1",
    oportunidade_id: "o1",
    perfil_id: "p1",
    score: 81,
    resumo: "IA do perfil p1",
    justificativa: "Teste",
    pontos_atencao: [],
    criado_em: "2026-09-18",
  });
  assert.match(await renderList({ perfilId: "p1" }), /90% aderência/);
  assert.match(await renderList({ perfilId: "p2" }), /10% aderência/);
  const detalhe = await renderDetail({ perfilId: "p2" });
  assert.match(detalhe, /10% aderência/);
  assert.doesNotMatch(detalhe, /IA do perfil p1/);
  assert.equal(state.aiCalls, 0);
});

test("UX: ordenação e limpar filtros mantêm contexto entre lista e detalhes", async () => {
  const html = await renderList({
    perfilId: "p1",
    busca: "software",
    ordenacao: "prazo_proximo",
  });
  assert.match(html, /value="prazo_proximo" selected=""/);
  assert.match(html, /href="\/oportunidades\?perfilId=p1"[^>]*>Limpar filtros/);
  assert.ok(
    html.indexOf("Perfil da empresa") < html.indexOf("Buscar oportunidade"),
  );
  assert.ok(html.indexOf("Buscar oportunidade") < html.indexOf(">Status<"));
  const detalhe = await renderDetail({
    perfilId: "p1",
    ordenacao: "prazo_proximo",
  });
  assert.match(detalhe, /name="ordenacao" value="prazo_proximo"/);
  assert.match(
    detalhe,
    /href="\/oportunidades\?perfilId=p1&amp;ordenacao=prazo_proximo"/,
  );
  const semPerfil = await renderList({
    perfilId: "",
    ordenacao: "maior_aderencia",
  });
  assert.doesNotMatch(semPerfil, /value="maior_aderencia"/);
  assert.match(semPerfil, /value="recomendadas" selected=""/);
});

test("listagem recomenda abertas mesmo com score menor e preserva filtros", async () => {
  state.tables.oportunidades_editais = [
    {
      ...opRow,
      id: "fechada",
      titulo: "Encerrada aderente",
      status: "encerrada",
    },
    {
      ...opRow,
      id: "aberta",
      titulo: "Aberta sem aderência",
      objeto: "hospital",
    },
  ];
  const html = await renderList({ perfilId: "p1", visao: "todas" });
  assert.ok(
    html.indexOf("Aberta sem aderência") < html.indexOf("Encerrada aderente"),
  );
  const maior = await renderList({
    perfilId: "p1",
    visao: "todas",
    ordenacao: "maior_aderencia",
  });
  assert.ok(
    maior.indexOf("Encerrada aderente") < maior.indexOf("Aberta sem aderência"),
  );
  const filtrada = await renderList({
    perfilId: "p1",
    visao: "historico",
    status: "encerrada",
    ordenacao: "mais_novas",
  });
  assert.doesNotMatch(filtrada, /Aberta sem aderência/);
  assert.match(filtrada, /Encerrada aderente/);
});

test('contrato da RPC: 21º só sinaliza próxima, favoritos e score vêm do banco', async () => {
  const { listarOportunidadesPaginadas } = await import('../../services/oportunidades-service.ts');
  state.rpcRows = Array.from({length:21},(_,i)=>({
    oportunidade:{...opRow,id:'pagina-'+i, titulo:'RPC-'+i,
      dataPublicacao:opRow.data_publicacao,dataAbertura:opRow.data_abertura,valorEstimado:opRow.valor_estimado},
    match:{score:42,nivel:'media',palavrasEncontradas:[],termosSegmentoEncontrados:[],mesmaUf:false,motivos:['Do banco']},
    favorito:i===0,
  }));
  const pagina = await listarOportunidadesPaginadas({perfilId:'p1',pagina:2});
  assert.equal(pagina.itens.length,20); assert.equal(pagina.temProxima,true);
  assert.equal(pagina.temAnterior,true); assert.equal(pagina.pagina,2);
  assert.equal(pagina.itens[0].match.score,42); assert.equal(pagina.itens[0].oportunidade.favorito,true);
  assert.equal(state.calls.some(c=>c.table==='oportunidades_favoritos'),false);
  const html = await renderList({perfilId:'p1',pagina:'2'});
  assert.match(html,/Página 2/); assert.match(html,/42% aderência/);
  assert.match(html,/pagina=3/); assert.match(html,/pagina=2/);
  assert.doesNotMatch(html,/RPC-20/);
});
test('página vazia continua navegável; filtros novos não enviam pagina antiga', async () => {
  state.rpcRows=[];
  const html = await renderList({perfilId:'p1',pagina:'3'});
  assert.match(html,/Nenhuma oportunidade encontrada/); assert.match(html,/pagina=2/);
  assert.doesNotMatch(html,/name="pagina"/);
  assert.match(html,/disabled=""[^>]*>Próxima/);
});
test('falha RPC não apresenta ranking parcial', async () => {
  state.rpcError={message:'erro interno não expor'};
  await assert.rejects(renderList({}),/Não foi possível listar/);
});
test('detalhe preserva página ao voltar e favoritar', async () => {
  const html=await renderDetail({perfilId:'p1',pagina:'4'});
  assert.match(html,/href="\/oportunidades\?perfilId=p1&amp;pagina=4"/);
  assert.match(html,/name="redirectTo"[^>]+pagina=4/);
  assert.ok(state.calls.some(c=>c.rpc==='calcular_match_oportunidade_v1'));
});
test('dashboard conta a base sem usar tamanho de página', async () => {
  state.tables.oportunidades_editais=Array.from({length:1200},(_,i)=>({...opRow,id:'o'+i}));
  const { default:Dashboard }=await import('../../app/(painel)/dashboard/page.tsx');
  const html=renderToStaticMarkup(await Dashboard());
  assert.match(html,/1200/);
  assert.ok(state.calls.some(c=>c.rpc==='resumo_oportunidades_ativas_v1'));
  assert.equal(state.calls.some(c=>c.table==='oportunidades_editais'),false);
});


test('ciclo: ativas exclui prazo vencido antes do ranking e preserva histórico', async () => {
  const future=new Date(Date.now()+86400000).toISOString();
  const past=new Date(Date.now()-86400000).toISOString();
  state.tables.oportunidades_editais=[
    {...opRow,id:'vencida',titulo:'Vencida aderente',participacao_prazo_limite:past},
    {...opRow,id:'futura',titulo:'Futura hospital',objeto:'hospital',participacao_prazo_limite:future},
    {...opRow,id:'sem-prazo',titulo:'Sem prazo confiável',data_abertura:'2000-01-01'},
  ];
  const antes=structuredClone(state.tables.oportunidades_editais);
  const ativa=await renderList({perfilId:'p1'});
  assert.doesNotMatch(ativa,/Vencida aderente/);
  assert.match(ativa,/Futura hospital/);assert.match(ativa,/Sem prazo confiável/);
  assert.match(ativa,/ATIVA/);assert.match(ativa,/PRAZO A CONFIRMAR/);
  const historico=await renderList({perfilId:'p1',visao:'historico',uf:'SP',busca:'software'});
  assert.match(historico,/Histórico de oportunidades/);assert.match(historico,/Vencida aderente/);
  assert.doesNotMatch(historico,/Futura hospital|Sem prazo confiável/);
  assert.match(historico,/90% aderência/);
  const todas=await renderList({perfilId:'p1',visao:'todas'});
  assert.ok(todas.indexOf('Futura hospital')<todas.indexOf('Vencida aderente'));
  assert.deepEqual(state.tables.oportunidades_editais,antes);
  assert.equal(state.aiCalls,0);
});

test('ciclo: favorito histórico, detalhe, troca de perfil e retorno continuam acessíveis', async () => {
  state.tables.oportunidades_editais[0].participacao_prazo_limite=new Date(Date.now()-86400000).toISOString();
  state.tables.oportunidades_favoritos=[{usuario_id:'u1',oportunidade_id:'o1'}];
  const {default:Favoritos}=await import('../../app/(painel)/favoritos/page.tsx');
  const html=renderToStaticMarkup(await Favoritos({searchParams:Promise.resolve({})}));
  assert.match(html,/Software nacional/);assert.match(html,/ENCERRADA/);
  const detalhe=await renderDetail({visao:'historico',pagina:'3',perfilId:'p1',uf:'SP'});
  assert.match(detalhe,/O prazo desta oportunidade já foi encerrado/);
  assert.match(detalhe,/90% aderência/);assert.match(detalhe,/Favorito/);
  assert.match(detalhe,/name="visao" value="historico"/);assert.match(detalhe,/name="pagina" value="3"/);
  assert.match(detalhe,/visao=historico/);assert.match(detalhe,/pagina=3/);
  assert.equal(state.tables.oportunidades_favoritos.length,1);
  assert.equal(state.calls.some(c=>c.operation==='delete'),false);
});

test('ciclo: dashboard conta acionáveis e mostra total completo separadamente', async () => {
  state.tables.oportunidades_editais=[opRow,{...opRow,id:'encerrada',status:'encerrada'}];
  const {default:Dashboard}=await import('../../app/(painel)/dashboard/page.tsx');
  const html=renderToStaticMarkup(await Dashboard());
  assert.ok(html.includes('Oportunidades ativas / a confirmar'));assert.match(html,/Base completa: 2 oportunidades/);
  const {obterResumoOportunidades}=await import('../../services/oportunidades-service.ts');
  const resumo=await obterResumoOportunidades();assert.equal(resumo.total,1);assert.equal(resumo.totalBase,2);
});

test("conteúdo v2 aparece sem score IA e mantém matching Free bloqueado",async()=>{
 state.plan='FREE';
 state.tables.ia_resultados_v1.push({
   execucao_id:'v2',usuario_id:'u1',oportunidade_id:'o1',perfil_id:'p1',
   versao_schema:2,score:null,justificativa:null,pontos_atencao:null,
   resumo:'IA manual',conteudo:(await import('./analise-v2-fixture.mjs')).resultadoV2,criado_em:'2026-10-21',
 });
 const html=await renderDetail({perfilId:'p1'});
 assert.match(html,/Compatibilidade com a empresa/);
 assert.match(html,/Informação a confirmar/); assert.match(html,/Próximo passo/);
 assert.doesNotMatch(html,/90% aderência|81%|Palavras encontradas: software/);
 assert.equal(state.aiCalls,0);
});
test("histórico da Etapa 1 continua consultável sem reinterpretar score",async()=>{
 state.tables.ia_resultados_v1.push({
   execucao_id:'v1',usuario_id:'u1',oportunidade_id:'o1',perfil_id:'p1',versao_schema:1,
   score:81,resumo:'Resumo histórico',justificativa:'Justificativa original',pontos_atencao:['Ponto original'],criado_em:'2026-10-20',
 });
 const html=await renderDetail({perfilId:'p1'});
 assert.match(html,/Justificativa original/); assert.match(html,/Ponto original/);
 assert.doesNotMatch(html,/81%/); assert.equal(state.tables.ia_resultados_v1[0].score,81);
 assert.equal(state.aiCalls,0);
});

const saldoIA = (plano, disponiveis=2) => ({codigo:'OK',plano,limite:3,consumidas:3-disponiveis,reservadas:0,disponiveis,inicio:null,fim:null,renovacao:null});
test('interface IA: Free demonstração disponível e esgotada; sem renovação inventada',async()=>{
 state.plan='FREE'; state.franquia={...saldoIA('FREE',1),limite:1,consumidas:0};
 const inicial=await renderDetail({perfilId:'p1'});
 assert.match(inicial,/Plano Free/); assert.match(inicial,/demonstração vitalícia/);
 assert.match(inicial,/Analisar oportunidade/); assert.doesNotMatch(inicial,/Fim do ciclo/);
 state.franquia={...state.franquia,consumidas:1,disponiveis:0};
 const fim=await renderDetail({perfilId:'p1'});
 assert.match(fim,/Limite de análises/); assert.match(fim,/Conhecer os planos pagos/);
 assert.match(fim,/disabled=""/); assert.equal(state.aiCalls,0);
});
for(const plano of ['PRO','BUSINESS']) test(`interface IA: ${plano} usa franquia efetiva e fim conhecido`,async()=>{
 state.franquia={...saldoIA(plano,6),limite:7,consumidas:1,fim:'2027-01-01T00:00:00Z'};
 const html=await renderDetail({perfilId:'p1'});
 assert.match(html,new RegExp(`Plano ${plano==='PRO'?'Pro':'Business'}`));
 assert.match(html,/Disponíveis/); assert.match(html,/>6<\/dd>/); assert.match(html,/Fim do ciclo/);
 assert.doesNotMatch(html,/Conhecer os planos pagos|>200<|>1\.000<\/dd>/);
});
test('interface IA: ciclo não autorizado não inventa saldo nem oferece compra',async()=>{
 state.franquia={...saldoIA('PRO',0),codigo:'CICLO_NAO_AUTORIZADO',limite:null};
 const html=await renderDetail({perfilId:'p1'});
 assert.match(html,/ciclo da assinatura/); assert.match(html,/Saldo indisponível/);
 assert.doesNotMatch(html,/Conhecer os planos pagos/);
});
for(const [estado, texto] of [['pending','Estamos analisando'],['processing','Estamos analisando'],['uncertain','reserva permanece retida'],['failed','Nenhuma unidade foi consumida']]) {
 test(`interface IA: recarga recupera ${estado} sem chamar provedor`,async()=>{
  state.estadoIA=estado;
  const html=await renderDetail({perfilId:'p1'});
  assert.match(html,new RegExp(texto)); assert.match(html,/Consultar estado e saldo/);
  assert.match(html,/role="status"/); assert.equal(state.aiCalls,0);
  if(estado!=='failed') {
   await assert.rejects(analisarOportunidade(form({oportunidadeId:'o1',perfilId:'p1'})),e=>e.url.includes(estado==='uncertain'?'INCERTA':'EM_ANDAMENTO'));
   assert.equal(state.aiCalls,0);
  }
 });
}
test('interface IA: concluída, reconsulta gratuita, mudança cosmética e atualização explícita',async()=>{
 const data=form({oportunidadeId:'o1',perfilId:'p1'});
 await assert.rejects(analisarOportunidade(data),e=>e.url.includes('CONCLUIDA'));
 let html=await renderDetail({perfilId:'p1'});
 assert.match(html,/Reconsulta gratuita/); assert.match(html,/Concluída em/);
 assert.match(html,/Perfil na data da análise/); assert.match(html,/Informações não verificadas/);
 assert.equal(state.aiCalls,1);
 state.tables.oportunidades_editais[0].objeto='  '+state.tables.oportunidades_editais[0].objeto+'  ';
 await assert.rejects(analisarOportunidade(data),e=>e.url.includes('EXISTENTE'));
 assert.equal(state.aiCalls,1);
 state.tables.perfis_empresa[0].nome_empresa='Nome novo';
 html=await renderDetail({perfilId:'p1'});
 assert.match(html,/informações anteriores/); assert.match(html,/Gerar análise atualizada/);
 assert.doesNotMatch(html,/Perfil na data da análise: Nome novo/);
 state.franquia=saldoIA('PRO',0); state.codigoReserva='LIMITE_ATINGIDO';
 await assert.rejects(analisarOportunidade(form({oportunidadeId:'o1',perfilId:'p1',atualizar:'true'})),e=>e.url.includes('LIMITE_ATINGIDO'));
 assert.equal(state.aiCalls,1);
 assert.match(await renderDetail({perfilId:'p1'}),/Limite de análises/);
 state.franquia=saldoIA('PRO',2);state.codigoReserva=null;
 await assert.rejects(analisarOportunidade(form({oportunidadeId:'o1',perfilId:'p1',atualizar:'true'})),e=>e.url.includes('CONCLUIDA'));
 assert.equal(state.aiCalls,2);
});
test('interface IA: indisponibilidade falha fechada e não expõe erros ou mensagens de URL',async()=>{
 state.erroIA={message:'segredo interno RPC'};
 const html=await renderDetail({perfilId:'p1',ia:'segredo interno RPC',erro:'stack token'});
 assert.match(html,/Não foi possível consultar/); assert.doesNotMatch(html,/segredo interno RPC|stack token/);
 assert.equal(state.aiCalls,0);
});
test('interface IA: sem perfil orienta cadastro; histórico sem snapshot não recebe nome atual',async()=>{
 state.tables.perfis_empresa=[];
 assert.match(await renderDetail({}),/crie um perfil de empresa/);
 assert.equal(state.calls.some(c=>c.rpc==='ia_consultar_interface_v1'),false);
});
