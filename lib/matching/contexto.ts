import {
  ORDENACOES,
  ordenarOportunidades,
  type OrdenacaoOportunidades,
} from "@/lib/matching/ordenar-oportunidades";
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
  ordenacao?: OrdenacaoOportunidades;
  erro?: string;
  mensagem?: string;
};

export function lerContexto(query: QueryOportunidades): ContextoOportunidades {
  const texto = (chave: string) =>
    typeof query[chave] === "string" ? query[chave] : undefined;
  const status = texto("status");
  const aderencia = texto("aderencia");
  const ordenacao = texto("ordenacao");
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
    ordenacao:
      ordenacao && Object.hasOwn(ORDENACOES, ordenacao)
        ? (ordenacao as OrdenacaoOportunidades)
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
    "ordenacao",
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
  ordenacao: OrdenacaoOportunidades = "recomendadas",
): { oportunidade: Opportunity; match?: OpportunityMatch }[] {
  const resultados = perfil
    ? aplicarMatching(oportunidades, perfil)
    : oportunidades.map(
        (
          oportunidade,
        ): { oportunidade: Opportunity; match?: OpportunityMatch } => ({
          oportunidade,
        }),
      );
  const filtrados =
    perfil && aderencia
      ? resultados.filter(({ match }) => match?.nivel === aderencia)
      : resultados;
  return ordenarOportunidades(filtrados, ordenacao, Boolean(perfil));
}

export function destinoLimparFiltros(contexto: ContextoOportunidades) {
  return montarDestino({ perfilId: contexto.perfilId });
}
