import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { normalizarTexto } from "../lib/matching/normalizar-texto.ts";
import {
  calcularMatch,
  aplicarMatching,
  classificarAderencia,
} from "../lib/matching/calcular-match.ts";
import {
  selecionarPerfil,
  montarDestino,
  lerContexto,
  prepararListagem,
} from "../lib/matching/contexto.ts";

const perfil = {
  id: "p1",
  palavrasChave: ["software"],
  segmento: "Tecnologia da Informação",
  uf: "SC",
  status: "ativo",
};
const oportunidade = {
  id: "o1",
  titulo: "",
  objeto: "Software de tecnologia da informação",
  tags: [],
  modalidade: "",
  uf: "SC",
  dataAbertura: "2026-10-01",
  status: "aberta",
};
const match = (p = {}, o = {}) =>
  calcularMatch({
    perfil: { ...perfil, ...p },
    oportunidade: { ...oportunidade, ...o },
  });

test("normalização remove acentos, caixa, pontuação e espaços", () => {
  assert.equal(
    normalizarTexto("  GESTÃO Pública / Software—Licença!  "),
    "gestao publica software licenca",
  );
});
test("palavra simples, composta direta e termos separados", () => {
  assert.deepEqual(match().palavrasEncontradas, ["software"]);
  for (const objeto of [
    "Gestão Pública",
    "Gestão / Pública",
    "gestão de compras da administração pública",
  ]) {
    assert.deepEqual(
      match({ palavrasChave: ["gestão pública"] }, { objeto })
        .palavrasEncontradas,
      ["gestão pública"],
    );
  }
});
test("palavras inteiras evitam substrings e frases incompletas", () => {
  assert.equal(
    match(
      { palavrasChave: ["obra", "gestão pública"] },
      { objeto: "manobra gestão privada" },
    ).palavrasEncontradas.length,
    0,
  );
});
test("deduplica palavras normalizadas e ignora entradas vazias/stopwords", () => {
  assert.equal(
    match({ palavrasChave: ["Software", "software!", "  ", "de para", "///"] })
      .score,
    100,
  );
});
test("palavra ausente não pontua e cobertura parcial usa 65/25/10", () => {
  assert.equal(match({ palavrasChave: ["ausente"] }).score, 35);
  assert.equal(
    match(
      { palavrasChave: ["software", "licença", "gestão", "ausente"] },
      { objeto: "software licença gestão tecnologia informação" },
    ).score,
    84,
  );
});
test("segmento parcial, repetição e stopwords não inflam cobertura", () => {
  assert.equal(
    match(
      { segmento: "Tecnologia da Informação Informação" },
      { objeto: "software tecnologia" },
    ).score,
    88,
  );
  assert.equal(match({ segmento: "de da para" }).score, 75);
});
test("mesma UF soma exatamente 10; diferente não zera", () => {
  assert.equal(match().score - match({}, { uf: "SP" }).score, 10);
  assert.equal(match({}, { uf: "SP" }).score, 90);
  assert.equal(match({ uf: " sc " }).mesmaUf, true);
  assert.equal(match({ uf: "" }, { uf: "" }).mesmaUf, false);
});
test("sem palavras úteis redistribui 90/10; segmento vazio não inventa pontos", () => {
  assert.equal(match({ palavrasChave: [] }).score, 100);
  assert.equal(
    match({ palavrasChave: ["de", "  "] }, { objeto: "tecnologia" }).score,
    55,
  );
  assert.equal(match({ palavrasChave: [], segmento: "" }).score, 10);
});
test("status, porte e tipo não alteram resultado", () => {
  assert.deepEqual(
    match(),
    match({ porte: "Grande" }, { status: "encerrada", tipo: "CREDENCIAMENTO" }),
  );
});
test("modalidade sem preferência não recebe bônus; pode ser termo pesquisável", () => {
  assert.equal(
    match({}, { modalidade: "Pregão Eletrônico" }).score,
    match().score,
  );
  assert.deepEqual(
    match(
      { palavrasChave: ["credenciamento"] },
      { modalidade: "Credenciamento" },
    ).palavrasEncontradas,
    ["credenciamento"],
  );
});
test("titulo, objeto e tags pesquisáveis; órgão e cidade excluídos", () => {
  for (const campo of ["titulo", "objeto", "tags"]) {
    const op = {
      titulo: "",
      objeto: "",
      tags: [],
      [campo]: campo === "tags" ? ["software"] : "software",
    };
    assert.equal(match({}, op).palavrasEncontradas.length, 1);
  }
  assert.equal(
    match(
      {},
      {
        titulo: "",
        objeto: "",
        tags: [],
        orgao: "software",
        cidade: "software",
      },
    ).palavrasEncontradas.length,
    0,
  );
});
test("score limitado a 0–100 em coberturas variadas", () => {
  for (let i = 0; i <= 100; i++) {
    const palavrasChave = Array.from({ length: i }, (_, j) => `termo${j}`);
    const r = match(
      { palavrasChave, segmento: "" },
      { uf: "", objeto: palavrasChave.slice(0, 50).join(" ") },
    );
    assert.ok(r.score >= 0 && r.score <= 100 && Number.isInteger(r.score));
  }
  assert.equal(
    match({ segmento: "", palavrasChave: [] }, { uf: "SP" }).score,
    0,
  );
  assert.equal(match().score, 100);
});
for (const [score, nivel] of [
  [0, "baixa"],
  [39, "baixa"],
  [40, "media"],
  [69, "media"],
  [70, "alta"],
  [100, "alta"],
]) {
  test(`nível ${score}: ${nivel}`, () =>
    assert.equal(classificarAderencia(score), nivel));
}
test("ranking: score desc, data crescente, ausente por último; não muta nem exclui UF", () => {
  const entrada = [
    { ...oportunidade, id: "baixa", objeto: "", dataAbertura: "2026-01-01" },
    { ...oportunidade, id: "tardia", uf: "SP", dataAbertura: "2026-12-01" },
    { ...oportunidade, id: "sem-data", uf: "SP", dataAbertura: "" },
    { ...oportunidade, id: "cedo", uf: "SP", dataAbertura: "2026-09-01" },
  ];
  const antes = structuredClone(entrada);
  assert.deepEqual(
    aplicarMatching(entrada, perfil).map((x) => x.oportunidade.id),
    ["cedo", "tardia", "sem-data", "baixa"],
  );
  assert.deepEqual(entrada, antes);
});
test("determinístico, sem I/O e sem dependências OpenAI/fetch", (t) => {
  t.mock.method(globalThis, "fetch", () =>
    assert.fail("matcher não pode acessar rede"),
  );
  assert.deepEqual(match(), match());
  aplicarMatching([oportunidade], perfil);
  for (const arquivo of readdirSync("lib/matching")) {
    assert.doesNotMatch(
      readFileSync(`lib/matching/${arquivo}`, "utf8"),
      /\bfetch\s*\(|from\s+["'][^"']*(openai|supabase)|\bprocess\.env/,
    );
  }
});
test("seleção explícita ou único ativo; nunca primeiro arbitrário/outro usuário", () => {
  const inativo = { ...perfil, id: "p2", status: "inativo" };
  assert.equal(selecionarPerfil([perfil, inativo]), perfil);
  assert.equal(selecionarPerfil([perfil, { ...perfil, id: "p3" }]), undefined);
  assert.equal(selecionarPerfil([perfil], "outro-usuario"), undefined);
  assert.equal(selecionarPerfil([perfil], ""), undefined);
  assert.equal(selecionarPerfil([inativo]), undefined);
  assert.equal(selecionarPerfil([perfil, inativo], "p2"), inativo);
  assert.equal(selecionarPerfil([]), undefined);
});
test("URL preserva todos os filtros, seleção e detalhes com encoding", () => {
  const contexto = lerContexto({
    busca: "gestão & software",
    status: "aberta",
    uf: "SC",
    perfilId: "p1",
    aderencia: "alta",
  });
  for (const caminho of ["/oportunidades", "/oportunidades/o1"]) {
    const url = new URL(montarDestino(contexto, caminho), "https://local.test");
    assert.equal(url.pathname, caminho);
    for (const chave of ["busca", "status", "uf", "perfilId", "aderencia"])
      assert.equal(url.searchParams.get(chave), contexto[chave]);
  }
});
test("query repetida/inválida segura; sem perfil ignora filtro e não produz score falso", () => {
  const contexto = lerContexto({
    perfilId: ["p1", "p2"],
    aderencia: "invalida",
    status: ["aberta"],
    busca: ["x"],
  });
  assert.equal(contexto.perfilId, "");
  assert.equal(contexto.aderencia, undefined);
  assert.equal(selecionarPerfil([perfil], contexto.perfilId), undefined);
  assert.deepEqual(prepararListagem([oportunidade], undefined, "alta"), [
    { oportunidade },
  ]);
});
test("filtro de aderência usa faixas e mantém nacional sem filtro de UF implícito", () => {
  const lista = [
    { ...oportunidade, uf: "SP" },
    { ...oportunidade, id: "baixa", objeto: "" },
  ];
  assert.equal(
    prepararListagem(lista, perfil, "alta")[0].oportunidade.uf,
    "SP",
  );
  assert.equal(
    prepararListagem(lista, perfil, "baixa")[0].oportunidade.id,
    "baixa",
  );
  assert.equal(prepararListagem(lista, perfil, "media").length, 0);
});
