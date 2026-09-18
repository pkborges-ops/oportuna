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
  "@/lib/openai/analise-oportunidade": `import {state} from ${self}; export async function gerarAnaliseOportunidade() { state.aiCalls++; return {score: 81, resumo: 'IA manual', justificativa: 'Teste', pontos_atencao: []}; }`,
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
const { alternarFavorito, analisarOportunidade } =
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
  };
  state.calls = [];
  state.aiCalls = 0;
});

test("lista com perfil único: nacional, score determinístico, detalhes e favoritos preservam filtros", async () => {
  const html = await renderList({
    busca: "software",
    status: "aberta",
    uf: "SP",
    aderencia: "alta",
  });
  assert.match(html, /90% aderência/);
  assert.doesNotMatch(html, /99%|Perfil privado/);
  assert.match(
    html,
    /\/oportunidades\/o1\?busca=software&amp;status=aberta&amp;uf=SP&amp;perfilId=p1&amp;aderencia=alta/,
  );
  assert.match(
    html,
    /name="redirectTo" value="\/oportunidades\?busca=software&amp;status=aberta&amp;uf=SP&amp;perfilId=p1&amp;aderencia=alta"/,
  );
  const call = state.calls.find((c) => c.table === "oportunidades_editais");
  assert.deepEqual(call.filters, [
    ["status", "aberta"],
    ["uf", "SP"],
  ]);
  assert.ok(call.orFilter.includes("software"));
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
  assert.ok(
    state.calls
      .filter((c) => c.table === "oportunidades_editais")
      .at(-1)
      .filters.every(([k]) => k !== "uf"),
  );
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
  });
  assert.match(html, /90% aderência/);
  assert.match(html, /81% · análise por IA/);
  assert.match(html, /Palavras encontradas: software/);
  assert.match(
    html,
    /name="redirectTo" value="\/oportunidades\/o1\?busca=software&amp;status=aberta&amp;uf=SP&amp;perfilId=p1&amp;aderencia=alta"/,
  );
  assert.equal(state.aiCalls, 0);
});
test("favoritar/desfavoritar executa action real e preserva destino completo", async () => {
  const destino =
    "/oportunidades?perfilId=p1&busca=software&status=aberta&uf=SP&aderencia=alta";
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
  assert.equal(state.tables.analises_oportunidades[0].score, 81);
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
    id: "a1", usuario_id: "u1", oportunidade_id: "o1", perfil_id: "p1",
    score: 81, resumo: "IA do perfil p1", justificativa: "Teste", pontos_atencao: [], criado_em: "2026-09-18",
  });
  assert.match(await renderList({ perfilId: "p1" }), /90% aderência/);
  assert.match(await renderList({ perfilId: "p2" }), /10% aderência/);
  const detalhe = await renderDetail({ perfilId: "p2" });
  assert.match(detalhe, /10% aderência/);
  assert.doesNotMatch(detalhe, /IA do perfil p1/);
  assert.equal(state.aiCalls, 0);
});
