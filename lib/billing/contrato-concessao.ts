// Contrato financeiro v1. Sem dependencia de Asaas ou implementacao de consumo IA.
export type ConcessaoFinanceiraV1 = {
  contrato_versao: 1;
  concessao_id: string;
  ambiente: "sandbox" | "production";
  usuario_id: string;
  assinatura_id: string | null;
  pagamento_id: string | null;
  origem: "PAYMENT" | "ADMIN";
  plano: "PRO" | "BUSINESS";
  franquia: number | null;
  inicio: string;
  fim: string;
  estado: "AUTHORIZED" | "REVIEW" | "REVOKED";
  revisao: number;
};

export type ResultadoEntregaFinanceira = "delivered" | "duplicate" | "pending" |
  "retry" | "stale" | "lease_lost" | "not_found";
