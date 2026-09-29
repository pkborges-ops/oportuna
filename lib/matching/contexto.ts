import {
  ORDENACOES,
  type OrdenacaoOportunidades,
} from "@/lib/matching/ordenar-oportunidades";
import type { OpportunityStatus, Profile } from "@/types";
import type { MatchLevel } from "@/lib/matching/calcular-match";
import { normalizarVisao, type VisaoOportunidades } from "@/lib/oportunidades/ciclo-vida";

export type QueryOportunidades = Record<string, string | string[] | undefined>;
export type ContextoOportunidades = {
  busca?: string;
  status?: OpportunityStatus | "";
  uf?: string;
  perfilId?: string;
  aderencia?: MatchLevel;
  ordenacao?: OrdenacaoOportunidades;
  pagina?: number;
  visao?: VisaoOportunidades;
  erro?: string;
  mensagem?: string;
};

export function lerContexto(query: QueryOportunidades): ContextoOportunidades {
  const texto = (chave: string) =>
    typeof query[chave] === "string" ? query[chave] : undefined;
  const status = texto("status");
  const aderencia = texto("aderencia");
  const ordenacao = texto("ordenacao");
  const pagina = normalizarPagina(texto("pagina"));
  return {
    busca: texto("busca"),
    pagina,
    visao: normalizarVisao(query.visao),
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

export function normalizarPagina(valor?: string | number): number {
  if (valor === undefined || !/^[1-9]\d*$/.test(String(valor))) return 1;
  const numero = Number(valor);
  return Number.isSafeInteger(numero) && numero <= 2_147_483_647 ? numero : 1;
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
  if (contexto.pagina && contexto.pagina > 1) query.set("pagina", String(contexto.pagina));
  if (contexto.visao && contexto.visao !== "ativas") query.set("visao", contexto.visao);
  return query.size ? `${caminho}?${query.toString()}` : caminho;
}

export function destinoLimparFiltros(contexto: ContextoOportunidades) {
  return montarDestino({ perfilId: contexto.perfilId, visao: contexto.visao });
}
