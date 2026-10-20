import { PLAN_CATALOG, type PlanCode } from "@/lib/planos/catalogo";

export type BillingEstado = {
  status?: string; plan_code?: PlanCode; paid_until?: string;
  checkout_expira_em?: string; franquia_ia?: number | null;
};
export type EstadoPlano = { label: string; message?: string; action?: "subscribe" | "continue" };

export function dataDoPlano(value?: string): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date(value));
}

export function estadoDoPlano(code: PlanCode, current: PlanCode, billing: BillingEstado | null,
  ready: boolean, offer: boolean, now = Date.now()): EstadoPlano {
  if (code === current) return { label: "Plano atual" };
  if (code === "FREE") return { label: "Gratuito para novas contas" };
  if (current !== "FREE") return { label: "Alteração pelo suporte",
    message: "Para mudar de plano, entre em contato com o suporte." };
  if (!ready || !offer) return { label: "Indisponível no momento",
    message: "A contratação deste plano está temporariamente indisponível." };
  const status = billing?.status;
  if (!status || status === "canceled" || status === "expired") {
    return { label: `Assinar ${PLAN_CATALOG[code].name}`, action: "subscribe" };
  }
  if (billing?.plan_code !== code) return { label: "Em processamento",
    message: "Já existe uma contratação em andamento. Acompanhe o plano escolhido." };
  if (status === "checkout_pending") {
    const valid = billing?.checkout_expira_em && Date.parse(billing.checkout_expira_em) > now;
    return valid ? { label: "Pagamento pendente", action: "continue",
      message: "Você pode continuar o pagamento já iniciado." }
      : { label: "Em processamento", message: "Estamos verificando o pagamento. Não é necessário contratar novamente." };
  }
  if (status === "checkout_paid" || status === "payment_pending") return {
    label: "Aguardando confirmação", message: "O acesso será liberado após confirmação do pagamento." };
  if (status === "past_due") return { label: "Pagamento pendente",
    message: "Confira a situação da cobrança com o suporte." };
  return { label: "Em processamento", message: "Estamos verificando sua assinatura. Não é necessário contratar novamente." };
}

export function mensagemDoRetorno(current: PlanCode, billing: BillingEstado | null, journey?: string): string {
  if (current !== "FREE" && billing?.plan_code === current) {
    return `Seu plano ${PLAN_CATALOG[current].name} está disponível conforme a confirmação registrada na sua conta.`;
  }
  if (journey === "cancelado") return "Você retornou de um checkout cancelado. Seu plano não foi alterado por este retorno.";
  if (journey === "expirado") return "Você retornou de um checkout expirado. Confira a situação da assinatura nos planos.";
  return "Aguardando confirmação do pagamento.";
}
