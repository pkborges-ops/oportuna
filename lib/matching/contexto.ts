import type { Opportunity, OpportunityStatus, Profile } from "@/types";
import {
  aplicarMatching,
  type MatchLevel,
  type OpportunityMatch,
} from "@/lib/matching/calcular-match";

export type QueryOportunidades = Record<string, string | string[] | undefined>;
export type ContextoOportunidades = {
  busca?: string;
  status?: OpportunityStatus | "";
  uf?: string;
  perfilId?: string;
  aderencia?: MatchLevel;
  erro?: string;
  mensagem?: string;
};

export function lerContexto(query: QueryOportunidades): ContextoOportunidades {
  const texto = (chave: string) =>
    typeof query[chave] === "string" ? query[chave] : undefined;
  const status = texto("status");
  const aderencia = texto("aderencia");
  return {
    busca: texto("busca"),
    uf: texto("uf"),
    status:
      status === "aberta" || status === "em_analise" || status === "encerrada"
        ? status
        : "",
    // Parâmetro repetido/inválido não pode disparar seleção automática.
    perfilId:
      query.perfilId === undefined ? undefined : (texto("perfilId") ?? ""),
    aderencia:
      aderencia === "alta" || aderencia === "media" || aderencia === "baixa"
        ? aderencia
        : undefined,
    erro: texto("erro"),
    mensagem: texto("mensagem"),
  };
}

// Recebe SOMENTE os perfis retornados por listarPerfis (restritos ao usuário).
export function selecionarPerfil(
  perfisDoUsuario: readonly Profile[],
  perfilId?: string,
) {
  if (perfilId !== undefined)
    return perfisDoUsuario.find((perfil) => perfil.id === perfilId);
  const ativos = perfisDoUsuario.filter((perfil) => perfil.status === "ativo");
  return ativos.length === 1 ? ativos[0] : undefined;
}

export function montarDestino(
  contexto: ContextoOportunidades,
  caminho = "/oportunidades",
) {
  const query = new URLSearchParams();
  for (const chave of [
    "busca",
    "status",
    "uf",
    "perfilId",
    "aderencia",
  ] as const) {
    const valor = contexto[chave];
    if (valor || (chave === "perfilId" && valor !== undefined))
      query.set(chave, valor ?? "");
  }
  return query.size ? `${caminho}?${query.toString()}` : caminho;
}

export function prepararListagem(
  oportunidades: readonly Opportunity[],
  perfil?: Profile,
  aderencia?: MatchLevel,
): { oportunidade: Opportunity; match?: OpportunityMatch }[] {
  if (!perfil) return oportunidades.map((oportunidade) => ({ oportunidade }));
  const resultados = aplicarMatching(oportunidades, perfil);
  return aderencia
    ? resultados.filter(({ match }) => match.nivel === aderencia)
    : resultados;
}
