import { timingSafeEqual } from "node:crypto";

export function precoEmCentavos(valor: string | undefined): number | null {
  if (!valor || !/^\d+(?:\.\d{1,2})?$/.test(valor)) return null;
  const centavos = Math.round(Number(valor) * 100);
  return Number.isSafeInteger(centavos) && centavos > 0 ? centavos : null;
}

export function validarUrlCheckout(link: string): string {
  const url = new URL(link);
  if (url.protocol !== "https:" || url.hostname !== "sandbox.asaas.com" ||
    url.port || url.username || url.password ||
    !url.pathname.startsWith("/checkoutSession/")) {
    throw new Error("URL de Checkout Sandbox invalida.");
  }
  return url.toString();
}

export function tokenWebhookValido(recebido: string | null, esperado: string): boolean {
  if (!recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function cobrancaPertenceAoCheckout(
  lista: { data?: Array<{ id?: string; subscription?: string; customer?: string }>;
    hasMore?: boolean },
  pagamento: { id: string; subscription: string; customer: string },
): boolean {
  return Array.isArray(lista.data) && lista.hasMore === false &&
    lista.data.some((item) => item.id === pagamento.id &&
      item.subscription === pagamento.subscription && item.customer === pagamento.customer);
}

export function dadosPagadorValidos(nome: unknown, documento: unknown):
  { nome: string; documento: string } | null {
  if (typeof nome !== "string" || typeof documento !== "string") return null;
  const normalizado = nome.trim();
  const digits = documento.replace(/\D/g, "");
  if (normalizado.length < 3 || normalizado.length > 120 ||
      ![11, 14].includes(digits.length)) return null;
  return { nome: normalizado, documento: digits };
}
