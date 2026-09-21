import type { Opportunity } from "@/types";
import type { OpportunityMatch } from "@/lib/matching/calcular-match";

export const ORDENACOES = {
  recomendadas: "Recomendadas",
  mais_novas: "Mais novas",
  maior_aderencia: "Maior aderência",
  prazo_proximo: "Prazo próximo",
} as const;
export type OrdenacaoOportunidades = keyof typeof ORDENACOES;
export type OportunidadeComMatch = {
  oportunidade: Opportunity;
  match?: OpportunityMatch;
};

export function resolverOrdenacao(
  ordenacao: OrdenacaoOportunidades | undefined,
  temPerfil: boolean,
): OrdenacaoOportunidades {
  return !ordenacao || (ordenacao === "maior_aderencia" && !temPerfil)
    ? "recomendadas"
    : ordenacao;
}

const prioridadeStatus = { aberta: 0, em_analise: 1, encerrada: 2 };
function timestamp(data?: string) {
  const valor = data ? Date.parse(data) : NaN;
  return Number.isFinite(valor) ? valor : undefined;
}
function compararDatas(
  a: number | undefined,
  b: number | undefined,
  crescente: boolean,
) {
  if (a === undefined) return b === undefined ? 0 : 1;
  if (b === undefined) return -1;
  return crescente ? a - b : b - a;
}
function prazo(oportunidade: Opportunity) {
  return (
    timestamp(oportunidade.participacao?.prazoLimite) ??
    timestamp(oportunidade.dataAbertura)
  );
}

// Apenas apresentação: status e datas nunca alteram o score calculado.
export function ordenarOportunidades(
  itens: readonly OportunidadeComMatch[],
  ordenacao: OrdenacaoOportunidades,
  temPerfil: boolean,
) {
  const modo = resolverOrdenacao(ordenacao, temPerfil);
  return [...itens].sort((a, b) => {
    const oa = a.oportunidade;
    const ob = b.oportunidade;
    const status = prioridadeStatus[oa.status] - prioridadeStatus[ob.status];
    const encerradasDepois =
      Number(oa.status === "encerrada") - Number(ob.status === "encerrada");
    const score = temPerfil ? (b.match?.score ?? 0) - (a.match?.score ?? 0) : 0;
    const publicacao = compararDatas(
      timestamp(oa.dataPublicacao),
      timestamp(ob.dataPublicacao),
      false,
    );
    let ordem: number;
    switch (modo) {
      case "mais_novas":
        ordem = encerradasDepois || publicacao;
        break;
      case "maior_aderencia":
        ordem = score || encerradasDepois || publicacao;
        break;
      case "prazo_proximo":
        ordem =
          encerradasDepois ||
          compararDatas(prazo(oa), prazo(ob), true) ||
          publicacao;
        break;
      default:
        ordem = status || score || publicacao;
    }
    return ordem || oa.id.localeCompare(ob.id);
  });
}
