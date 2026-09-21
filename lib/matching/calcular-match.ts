import type { Opportunity, Profile } from "@/types";
import {
  normalizarTexto,
  termosRelevantes,
} from "@/lib/matching/normalizar-texto";

export type MatchLevel = "alta" | "media" | "baixa";
export type OpportunityMatch = {
  score: number;
  nivel: MatchLevel;
  palavrasEncontradas: string[];
  termosSegmentoEncontrados: string[];
  mesmaUf: boolean;
  motivos: string[];
};

type PerfilMatching = Pick<Profile, "palavrasChave" | "segmento" | "uf">;
type OportunidadeMatching = Pick<
  Opportunity,
  "titulo" | "objeto" | "tags" | "modalidade" | "uf"
>;

export function classificarAderencia(score: number): MatchLevel {
  return score >= 70 ? "alta" : score >= 40 ? "media" : "baixa";
}

// Preparado uma vez por perfil em cada listagem; nenhuma persistência ou I/O.
function prepararPerfil(perfil: PerfilMatching) {
  const palavras = new Map<string, { original: string; termos: string[] }>();
  for (const palavra of perfil.palavrasChave) {
    const normalizada = normalizarTexto(palavra);
    const termos = termosRelevantes(palavra);
    if (termos.length && !palavras.has(normalizada)) {
      palavras.set(normalizada, { original: palavra.trim(), termos });
    }
  }
  return {
    palavras: [...palavras.values()],
    segmento: termosRelevantes(perfil.segmento),
    uf: perfil.uf.trim().toUpperCase(),
  };
}

function calcularComPerfil(
  perfil: ReturnType<typeof prepararPerfil>,
  oportunidade: OportunidadeMatching,
): OpportunityMatch {
  const texto = normalizarTexto(
    [
      oportunidade.titulo,
      oportunidade.objeto,
      ...oportunidade.tags,
      oportunidade.modalidade,
    ].join(" "),
  );
  const tokens = new Set(texto.split(" "));
  // Frases diretas também satisfazem esta regra. Exige todos os termos inteiros,
  // mas permite termos separados e em outra ordem, sem sinônimos ou stemming.
  const palavrasEncontradas = perfil.palavras
    .filter(({ termos }) => termos.every((termo) => tokens.has(termo)))
    .map(({ original }) => original);
  const termosSegmentoEncontrados = perfil.segmento.filter((termo) =>
    tokens.has(termo),
  );
  const mesmaUf =
    /^[A-Z]{2}$/.test(perfil.uf) &&
    perfil.uf === oportunidade.uf.trim().toUpperCase();
  const temPalavras = perfil.palavras.length > 0;
  const scorePalavras = temPalavras
    ? (65 * palavrasEncontradas.length) / perfil.palavras.length
    : 0;
  const scoreSegmento = perfil.segmento.length
    ? ((temPalavras ? 25 : 90) * termosSegmentoEncontrados.length) /
      perfil.segmento.length
    : 0;
  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(scorePalavras + scoreSegmento + (mesmaUf ? 10 : 0)),
    ),
  );
  const motivos = [
    temPalavras
      ? `${palavrasEncontradas.length} de ${perfil.palavras.length} palavras-chave encontradas.`
      : "Sem palavras-chave úteis: o segmento representa até 90 pontos.",
    `${termosSegmentoEncontrados.length} de ${perfil.segmento.length} termos do segmento encontrados.`,
  ];
  if (palavrasEncontradas.length)
    motivos.push(`Palavras encontradas: ${palavrasEncontradas.join(", ")}.`);
  if (mesmaUf) motivos.push("Oportunidade na mesma UF do perfil (+10 pontos).");
  return {
    score,
    nivel: classificarAderencia(score),
    palavrasEncontradas,
    termosSegmentoEncontrados,
    mesmaUf,
    motivos,
  };
}

export function calcularMatch({
  perfil,
  oportunidade,
}: {
  perfil: PerfilMatching;
  oportunidade: OportunidadeMatching;
}): OpportunityMatch {
  return calcularComPerfil(prepararPerfil(perfil), oportunidade);
}

function dataOrdenacao(data: string): number {
  const timestamp = Date.parse(data);
  return Number.isFinite(timestamp) ? timestamp : Infinity;
}

export function aplicarMatching(
  oportunidades: readonly Opportunity[],
  perfil: PerfilMatching,
) {
  const preparado = prepararPerfil(perfil);
  return oportunidades
    .map((oportunidade) => ({
      oportunidade,
      match: calcularComPerfil(preparado, oportunidade),
    }))
    .sort(
      (a, b) =>
        b.match.score - a.match.score ||
        dataOrdenacao(a.oportunidade.dataAbertura) -
          dataOrdenacao(b.oportunidade.dataAbertura),
    );
}
