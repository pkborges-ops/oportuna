export const VISOES = {
  ativas: "Ativas",
  historico: "Histórico",
  todas: "Todas",
} as const;

export type VisaoOportunidades = keyof typeof VISOES;
export type SituacaoOperacional = "ativa" | "encerrada" | "indeterminada";

export function normalizarVisao(valor: unknown): VisaoOportunidades {
  return typeof valor === "string" && Object.hasOwn(VISOES, valor)
    ? (valor as VisaoOportunidades)
    : "ativas";
}

// Referência de teste da classificação SQL. As telas recebem a situação do banco.
// data_abertura é início das propostas/publicação; nunca é fallback de encerramento.
export function classificarSituacao(
  status: string,
  prazo: string | null | undefined,
  agora: number,
): SituacaoOperacional {
  if (status === "encerrada") return "encerrada";
  const limite = prazo ? Date.parse(prazo) : NaN;
  if (!Number.isFinite(limite)) return "indeterminada";
  return limite <= agora ? "encerrada" : "ativa";
}
