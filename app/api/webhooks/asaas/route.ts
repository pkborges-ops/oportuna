import { chamarAsaas, obterConfigAsaas } from "@/lib/billing/asaas";
import { tokenWebhookValido } from "@/lib/billing/validacao";
import { verificarCheckoutDaCobranca } from "@/lib/billing/webhook";
import { criarClienteBilling } from "@/lib/billing/banco";

const EVENTOS = new Set([
  "CHECKOUT_CREATED", "CHECKOUT_CANCELED", "CHECKOUT_EXPIRED", "CHECKOUT_PAID",
  "SUBSCRIPTION_CREATED", "SUBSCRIPTION_UPDATED", "SUBSCRIPTION_INACTIVATED",
  "SUBSCRIPTION_DELETED", "PAYMENT_CREATED", "PAYMENT_UPDATED",
  "PAYMENT_CONFIRMED", "PAYMENT_RECEIVED", "PAYMENT_OVERDUE",
  "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED", "PAYMENT_REFUNDED",
  "PAYMENT_CHARGEBACK_REQUESTED",
]);

type Payment = { id: string; status: string; subscription: string; customer: string;
  value: number; dueDate: string; billingType: string; checkoutSession?: unknown };

export async function POST(request: Request) {
  let config: ReturnType<typeof obterConfigAsaas>;
  try { config = obterConfigAsaas(); } catch { return new Response(null, { status: 503 }); }
  if (!tokenWebhookValido(request.headers.get("asaas-access-token"), config.webhookToken)) {
    return new Response(null, { status: 401 });
  }
  if (Number(request.headers.get("content-length") || 0) > 65536) {
    return new Response(null, { status: 413 });
  }
  let payload: Record<string, unknown>;
  try {
    const body = await request.text();
    if (body.length > 65536) return new Response(null, { status: 413 });
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch { return new Response(null, { status: 400 }); }
  if (!payload || typeof payload.id !== "string" ||
    payload.id.length === 0 || payload.id.length > 200 ||
    typeof payload.event !== "string" || !EVENTOS.has(payload.event)) {
    return new Response(null, { status: 400 });
  }
  let admin: Awaited<ReturnType<typeof criarClienteBilling>>;
  try { admin = await criarClienteBilling(config.environment); }
  catch { return new Response(null, { status: 503 }); }
  const { data: jaProcessado, error: erroConsulta } = await admin.rpc(
    "billing_evento_processado_v1", { p_event_id: payload.id },
  );
  if (erroConsulta) return new Response(null, { status: 503 });
  if (jaProcessado === true) return new Response(null, { status: 200 });
  let checkoutVerificado: string | null = null;
  if (payload.event === "PAYMENT_CONFIRMED") {
    const recebido = payload.payment as Payment | undefined;
    if (!recebido || typeof recebido.id !== "string" ||
      !/^[a-zA-Z0-9_\-]+$/.test(recebido.id)) return new Response(null, { status: 400 });
    try {
      // Confirma o estado no Asaas alem de validar o token e os vinculos no banco.
      const atual = await chamarAsaas<Payment>(`/payments/${recebido.id}`);
      if (!["CONFIRMED", "RECEIVED"].includes(atual.status) ||
        atual.id !== recebido.id || atual.subscription !== recebido.subscription ||
        atual.customer !== recebido.customer || atual.value !== recebido.value ||
        atual.billingType !== "CREDIT_CARD") return new Response(null, { status: 503 });
      // O evento SUBSCRIPTION_CREATED pode chegar antes da cobranca. A primeira
      // confirmacao so vincula a assinatura se a API autenticada do Asaas
      // comprovar a sessao de checkout salva para este cliente.
      const { data: pendente, error: erroPendente } = await admin.rpc(
        "billing_checkout_pendente_v1", { p_gateway_customer_id: atual.customer },
      );
      if (erroPendente) return new Response(null, { status: 503 });
      const checkoutId = (pendente as { checkout_id?: unknown } | null)?.checkout_id;
      if (typeof checkoutId === "string") {
        if (!await verificarCheckoutDaCobranca(atual, checkoutId, chamarAsaas)) {
          // Somente metadados de validacao; nunca payload, tokens ou dados do pagador.
          console.error("asaas_webhook_checkout_mismatch");
          return new Response(null, { status: 503 });
        }
        checkoutVerificado = checkoutId;
      }
      // O objeto consultado na API substitui os campos financeiros do webhook.
      payload = { ...payload, payment: atual };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      console.error("asaas_webhook_verification_failed", {
        httpStatus: /^Asaas retornou HTTP (\d{3})\.$/.exec(message)?.[1] ?? null,
      });
      return new Response(null, { status: 503 });
    }
  }
  const { data, error } = await admin.rpc(
    "billing_processar_webhook_v1", { p: payload, p_checkout_verificado: checkoutVerificado },
  );
  if (error || data === "retry") return new Response(null, { status: 503 });
  return new Response(null, { status: 200 });
}
