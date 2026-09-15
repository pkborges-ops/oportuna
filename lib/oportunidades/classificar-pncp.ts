import type { OpportunityType } from "@/types";

// Domínio oficial: https://pncp.gov.br/api/pncp/v1/modalidades
// Manter os aliases históricos em sincronia com a migration origem/tipo.
const modalidades = [
  [1, "leilão-eletrônico", "LICITACAO"],
  [2, "diálogo competitivo", "LICITACAO"],
  [3, "concurso", "LICITACAO"],
  [4, "concorrência-eletrônica", "LICITACAO"],
  [5, "concorrência-presencial", "LICITACAO"],
  [6, "pregão-eletrônico", "LICITACAO"],
  [7, "pregão-presencial", "LICITACAO"],
  [8, "dispensa", "CONTRATACAO_DIRETA"],
  [9, "inexigibilidade", "CONTRATACAO_DIRETA"],
  [10, "manifestação de interesse", "OUTRO"],
  [11, "pré-qualificação", "OUTRO"],
  [12, "credenciamento", "CREDENCIAMENTO"],
  [13, "leilão-presencial", "LICITACAO"],
  [14, "inaplicabilidade da licitação", "OUTRO"],
  [15, "chamada pública", "OUTRO"],
  [16, "concorrência-eletrônica internacional", "LICITACAO"],
  [17, "concorrência-presencial internacional", "LICITACAO"],
  [18, "pregão-eletrônico internacional", "LICITACAO"],
  [19, "pregão-presencial internacional", "LICITACAO"],
] as const satisfies ReadonlyArray<readonly [number, string, OpportunityType]>;

const porId = new Map<number, OpportunityType>(
  modalidades.map(([id, , tipo]) => [id, tipo]),
);
const porNome = new Map<string, OpportunityType>(
  modalidades.map(([, nome, tipo]) => [nome, tipo]),
);
porNome.set("dispensa de licitação", "CONTRATACAO_DIRETA");

function normalizarNome(nome: string) {
  return nome.toLowerCase().trim().replace(/\s+/g, " ")
    .replace(/\s*[-–—]\s*/g, "-");
}

export function classificarPncp({
  modalidadeId,
  modalidadeNome,
}: {
  modalidadeId?: number | null;
  modalidadeNome?: string | null;
}): OpportunityType {
  const peloNome = porNome.get(normalizarNome(modalidadeNome ?? ""));

  if (modalidadeId != null) {
    const peloId = porId.get(modalidadeId);
    // ID desconhecido ou categorias conflitantes não permitem classificação segura.
    if (!peloId || (peloNome !== undefined && peloNome !== peloId)) {
      return "OUTRO";
    }
    return peloId;
  }

  return peloNome ?? "OUTRO";
}
