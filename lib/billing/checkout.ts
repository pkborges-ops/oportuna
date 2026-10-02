import "server-only";

import { chamarAsaas, obterConfigAsaas } from "@/lib/billing/asaas";
import { validarUrlCheckout } from "@/lib/billing/validacao";
import { paidOffer, type PaidPlanCode } from "@/lib/planos/catalogo";
import { criarClienteSupabaseAdmin } from "@/lib/supabase/admin";

type Reservation = { state: string; id?: string; customer_id?: string; url?: string };
type Customer = { id: string; externalReference?: string };
type Customers = { data: Customer[] };
type Checkout = { id: string; link: string };

async function rpc(name: string, args: Record<string, unknown>): Promise<Reservation> {
  const { data, error } = await criarClienteSupabaseAdmin().rpc(name, args);
  if (error) throw new Error(`Falha ao preparar faturamento: ${name}.`);
  return data as Reservation;
}

async function obterCliente(usuarioId: string, nome: string, documento: string): Promise<string> {
  const reserva = await rpc("billing_reservar_cliente_v1", { p_usuario: usuarioId });
  if (reserva.state === "ready" && reserva.customer_id) return reserva.customer_id;
  if (reserva.state === "busy") throw new Error("Cadastro em andamento. Aguarde e tente novamente.");
  if (!reserva.id || !["claim", "reconcile"].includes(reserva.state)) {
    throw new Error("Cadastro de pagamento indisponivel.");
  }
  try {
    const encontrados = await chamarAsaas<Customers>(
      `/customers?externalReference=${encodeURIComponent(usuarioId)}&limit=2`,
    );
    if (encontrados.data.length > 1) throw new Error("Cliente duplicado no Asaas: revisao necessaria.");
    if (encontrados.data.length === 1) {
      const cliente = encontrados.data[0];
      if (cliente.externalReference !== usuarioId) throw new Error("Cliente nao corresponde ao usuario.");
      await rpc("billing_salvar_cliente_v1", { p_id: reserva.id, p_gateway_id: cliente.id });
      return cliente.id;
    }
    // Apos timeout anterior, ausencia em uma consulta nao prova que o POST
    // anterior nao sera concluido. Bloqueamos nova criacao ate conciliacao.
    if (reserva.state === "reconcile") {
      throw new Error("Cadastro ainda em conciliacao. Nenhum novo cliente foi criado.");
    }
    const cliente = await chamarAsaas<Customer>("/customers", {
      method: "POST",
      body: JSON.stringify({ name: nome, cpfCnpj: documento, externalReference: usuarioId }),
    });
    if (!cliente.id) throw new Error("Resposta de cliente incompleta.");
    await rpc("billing_salvar_cliente_v1", { p_id: reserva.id, p_gateway_id: cliente.id });
    return cliente.id;
  } catch (error) {
    await rpc("billing_cliente_incerteza_v1", { p_id: reserva.id });
    throw error;
  }
}

export async function criarOuReutilizarCheckout(
  usuarioId: string, nome: string, documento: string, planCode: PaidPlanCode,
): Promise<string> {
  const oferta = paidOffer(planCode);
  if (!oferta) throw new Error("Plano sem preco mensal configurado.");
  const config = obterConfigAsaas();
  const customerId = await obterCliente(usuarioId, nome, documento);
  const reserva = await rpc("billing_reservar_checkout_v1", {
    p_usuario: usuarioId, p_plan_code: oferta.code, p_valor: oferta.priceCents,
    p_franquia_ia: oferta.aiQuota,
  });
  if (reserva.state === "reuse" && reserva.url) return validarUrlCheckout(reserva.url);
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
    if (!checkout.id || !checkout.link) throw new Error("Resposta de checkout incompleta.");
    const url = validarUrlCheckout(checkout.link);
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
