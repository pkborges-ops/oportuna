import "server-only";

import { chamarAsaas, obterConfigAsaas } from "@/lib/billing/asaas";
import { linkDoCheckout, validarUrlCheckout, type DadosPagador } from "@/lib/billing/validacao";
import { obterCliente, type Reservation } from "@/lib/billing/cliente";
import { paidOffer, type PaidPlanCode } from "@/lib/planos/catalogo";
import { criarClienteBilling } from "@/lib/billing/banco";
import { checkoutPermitido } from "@/lib/billing/canario";

type Checkout = { id: string; link?: string };

export async function criarOuReutilizarCheckout(
  usuarioId: string, pagador: DadosPagador, planCode: PaidPlanCode,
): Promise<string> {
  if (!checkoutPermitido(usuarioId, planCode)) throw new Error("Assinaturas em liberação gradual.");
  const oferta = paidOffer(planCode);
  if (!oferta) throw new Error("Plano sem preco mensal configurado.");
  const config = obterConfigAsaas();
  const admin = await criarClienteBilling(config.environment);
  const rpc = async (name: string, args: Record<string, unknown>): Promise<Reservation> => {
    const { data, error } = await admin.rpc(name, args);
    if (error) throw new Error(`Falha ao preparar faturamento: ${name}.`);
    return data as Reservation;
  };
  const customerId = await obterCliente(usuarioId, pagador, { rpc, chamarAsaas });
  const reserva = await rpc("billing_reservar_checkout_v1", {
    p_usuario: usuarioId, p_plan_code: oferta.code, p_valor: oferta.priceCents,
    p_franquia_ia: oferta.aiQuota,
  });
  if (reserva.state === "reuse" && reserva.url) return validarUrlCheckout(reserva.url, config.environment);
  if (reserva.state !== "claim" || !reserva.id || reserva.customer_id !== customerId) {
    throw new Error(reserva.state === "paid_active"
      ? "Plano pago ativo: alteracoes de plano exigem atendimento."
      : "Ja existe um checkout ou assinatura em andamento. Consulte o estado do plano.");
  }
  try {
    const expiraEm = new Date(Date.now() + 60 * 60_000);
    const checkout = await chamarAsaas<Checkout>("/checkouts", {
      method: "POST",
      body: JSON.stringify({
        billingTypes: ["CREDIT_CARD"], chargeTypes: ["RECURRENT"],
        minutesToExpire: 60, externalReference: reserva.id,
        customer: customerId,
        callback: {
          successUrl: `${config.baseUrl}/planos/retorno?estado=sucesso`,
          cancelUrl: `${config.baseUrl}/planos/retorno?estado=cancelado`,
          expiredUrl: `${config.baseUrl}/planos/retorno?estado=expirado`,
        },
        items: [{ name: `Oportuna ${oferta.name} mensal`, quantity: 1,
          value: oferta.priceCents / 100 }],
        subscription: { cycle: oferta.cycle, nextDueDate: new Intl.DateTimeFormat("sv-SE", {
          timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "medium",
        }).format(new Date()) },
      }),
    });
    const url = linkDoCheckout(checkout, config.environment);
    await rpc("billing_salvar_checkout_v1", {
      p_id: reserva.id, p_gateway_id: checkout.id, p_url: url,
      p_expira_em: expiraEm.toISOString(),
    });
    return url;
  } catch (error) {
    await rpc("billing_checkout_incerteza_v1", { p_id: reserva.id });
    throw error;
  }
}
