import assert from "node:assert/strict";
import test from "node:test";
import { ordenarOportunidades } from "../lib/matching/ordenar-oportunidades.ts";
import {
  destinoLimparFiltros,
  lerContexto,
  montarDestino,
  prepararListagem,
} from "../lib/matching/contexto.ts";

const item = (id, status, score, dataPublicacao, extras = {}) => ({
  oportunidade: {
    id,
    status,
    dataPublicacao,
    dataAbertura: "2026-10-01",
    ...extras,
  },
  match: { score },
});
const ids = (lista, modo = "recomendadas", perfil = true) =>
  ordenarOportunidades(lista, modo, perfil).map((x) => x.oportunidade.id);
const lista = [
  item("encerrada", "encerrada", 100, "2026-09-30"),
  item("analise", "em_analise", 90, "2026-09-25"),
  item("aberta", "aberta", 10, "2026-09-01"),
];

test("recomendadas: aberta com score menor precede em análise e encerrada", () => {
  assert.deepEqual(ids(lista), ["aberta", "analise", "encerrada"]);
});
test("mesmo status: score primeiro, empate por publicação mais recente", () => {
  assert.deepEqual(
    ids([
      item("baixo", "aberta", 10, "2026-09-30"),
      item("antigo", "aberta", 90, "2026-09-01"),
      item("novo", "aberta", 90, "2026-09-20"),
    ]),
    ["novo", "antigo", "baixo"],
  );
});
test("sem perfil usa status e publicação, ignorando scores", () => {
  assert.deepEqual(
    ids(
      [...lista, item("aberta-nova", "aberta", 0, "2026-09-29")],
      "recomendadas",
      false,
    ),
    ["aberta-nova", "aberta", "analise", "encerrada"],
  );
});
test("mais novas agrupa abertas/em análise e mantém encerradas no fim", () => {
  assert.deepEqual(ids(lista, "mais_novas"), [
    "analise",
    "aberta",
    "encerrada",
  ]);
});
test("maior aderência prioriza score, situação no empate e publicação depois", () => {
  const entrada = [
    ...lista,
    item("encerrada-empate", "encerrada", 90, "2026-09-30"),
  ];
  assert.deepEqual(ids(entrada, "maior_aderencia"), [
    "encerrada",
    "analise",
    "encerrada-empate",
    "aberta",
  ]);
});
test("maior aderência sem perfil recua para recomendadas", () => {
  assert.deepEqual(ids(lista, "maior_aderencia", false), [
    "aberta",
    "analise",
    "encerrada",
  ]);
});
test("prazo próximo usa participação, fallback abertura e encerradas no fim", () => {
  const entrada = [
    item("fim", "encerrada", 100, "2026-09-01", { dataAbertura: "2026-01-01" }),
    item("participacao", "aberta", 10, "2026-09-01", {
      dataAbertura: "2026-12-01",
      participacao: { prazoLimite: "2026-09-21T10:00:00-03:00" },
    }),
    item("fallback", "em_analise", 50, "2026-09-01", {
      dataAbertura: "2026-09-22",
    }),
    item("prioriza-prazo", "aberta", 50, "2026-09-01", {
      dataAbertura: "2026-01-01",
      participacao: { prazoLimite: "2026-09-23" },
    }),
    item("sem-data", "aberta", 50, "2026-09-01", { dataAbertura: "" }),
  ];
  assert.deepEqual(ids(entrada, "prazo_proximo"), [
    "participacao",
    "fallback",
    "prioriza-prazo",
    "sem-data",
    "fim",
  ]);
});
test("datas inválidas não sobem no ranking e prazo inválido usa fallback", () => {
  const entrada = [
    item("invalido", "aberta", 50, "", { dataAbertura: "" }),
    item("valido", "aberta", 50, "2026-09-01", {
      participacao: { prazoLimite: "invalido" },
    }),
  ];
  for (const modo of ["recomendadas", "mais_novas", "prazo_proximo"])
    assert.deepEqual(ids(entrada, modo), ["valido", "invalido"]);
});
test("ordenação não muta a entrada nem altera os scores", () => {
  const antes = structuredClone(lista);
  for (const modo of [
    "recomendadas",
    "mais_novas",
    "maior_aderencia",
    "prazo_proximo",
  ])
    ids(lista, modo);
  assert.deepEqual(lista, antes);
});
test("ordenacao validada e preservada nas URLs de lista e detalhes", () => {
  const contexto = lerContexto({
    perfilId: "p1",
    ordenacao: "prazo_proximo",
    busca: "software",
  });
  for (const caminho of ["/oportunidades", "/oportunidades/o1"]) {
    const url = new URL(montarDestino(contexto, caminho), "https://local.test");
    assert.equal(url.searchParams.get("ordenacao"), "prazo_proximo");
    assert.equal(url.searchParams.get("perfilId"), "p1");
  }
  for (const valor of ["invalida", "toString", ["mais_novas", "recomendadas"]])
    assert.equal(lerContexto({ ordenacao: valor }).ordenacao, undefined);
});
test("limpar mantém somente perfil e retorna à ordenação padrão", () => {
  assert.equal(
    destinoLimparFiltros({
      perfilId: "p1",
      ordenacao: "mais_novas",
      busca: "software",
      status: "aberta",
      aderencia: "alta",
      uf: "SC",
    }),
    "/oportunidades?perfilId=p1",
  );
  assert.equal(
    destinoLimparFiltros({ perfilId: "", ordenacao: "mais_novas" }),
    "/oportunidades?perfilId=",
  );
});
test("prepararListagem aplica recomendadas também sem perfil", () => {
  const oportunidades = lista.map((x) => x.oportunidade);
  assert.deepEqual(
    prepararListagem(oportunidades).map((x) => x.oportunidade.id),
    ["aberta", "analise", "encerrada"],
  );
});
