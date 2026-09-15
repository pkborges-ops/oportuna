import { formatarCnpj, interpretarNumeroControlePncp } from "@/lib/pncp";
import type { Opportunity } from "@/types";

type ApresentacaoOrigem = {
  campos: { label: string; valor: string }[];
  link: { url: string; label: string };
};

export function obterApresentacaoOrigem(
  oportunidade: Pick<Opportunity, "origem" | "codigo">,
): ApresentacaoOrigem | null {
  if (oportunidade.origem !== "PNCP") return null;

  const dados = interpretarNumeroControlePncp(oportunidade.codigo);
  if (!dados) return null;

  return {
    campos: [
      { label: "Código PNCP", valor: oportunidade.codigo },
      { label: "CNPJ do órgão", valor: formatarCnpj(dados.cnpj) },
    ],
    link: {
      url: `https://pncp.gov.br/app/editais/${dados.cnpj}/${dados.ano}/${dados.sequencial}`,
      label: "Ver no PNCP ↗",
    },
  };
}
