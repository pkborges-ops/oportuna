import { timingSafeEqual } from "node:crypto";
import { ASAAS_ENVIRONMENTS, asaasEnvironment, type AsaasEnvironment } from "@/lib/billing/ambiente";

export { precoEmCentavos } from "@/lib/billing/preco";

export function validarUrlCheckout(link: string, environment: AsaasEnvironment): string {
  const definition = ASAAS_ENVIRONMENTS[asaasEnvironment(environment)];
  const url = new URL(link);
  if (url.protocol !== "https:" || url.hostname !== definition.checkoutHost ||
    url.port || url.username || url.password ||
    !definition.checkoutPath.test(url.pathname)) {
    throw new Error("URL de Checkout invalida para o ambiente.");
  }
  return url.toString();
}

export function linkDoCheckout(checkout: { id: string; link?: string }, environment: AsaasEnvironment): string {
  if (typeof checkout.id !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(checkout.id)) {
    throw new Error("Resposta de checkout incompleta.");
  }
  const definition = ASAAS_ENVIRONMENTS[asaasEnvironment(environment)];
  const link = checkout.link ?? `https://${definition.checkoutHost}/checkoutSession/show?id=${encodeURIComponent(checkout.id)}`;
  return validarUrlCheckout(link, environment);
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

export type DadosPagador = {
  nome: string; documento: string; email: string; celular: string;
  cep: string; numero: string; complemento?: string;
};

function digitosFormatados(valor: unknown): string | null {
  if (typeof valor !== "string" || !/^[\d\s.()+\/-]+$/.test(valor)) return null;
  return valor.replace(/\D/g, "");
}

function documentoValido(digits: string): boolean {
  if (![11, 14].includes(digits.length) || /^(\d)\1+$/.test(digits)) return false;
  const base = digits.slice(0, -2);
  const calcular = (texto: string, pesos: number[]) => {
    const resto = [...texto].reduce((soma, digit, i) => soma + Number(digit) * pesos[i], 0) % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const pesos = digits.length === 11
    ? [[10, 9, 8, 7, 6, 5, 4, 3, 2], [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]]
    : [[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]];
  const primeiro = calcular(base, pesos[0]);
  return digits.endsWith(`${primeiro}${calcular(base + primeiro, pesos[1])}`);
}

export function dadosPagadorValidos(entrada: Record<string, unknown>): DadosPagador | null {
  const { nome, documento, email, celular, cep, numero, complemento } = entrada;
  if (typeof nome !== "string" || typeof email !== "string" || typeof numero !== "string" ||
    (complemento !== undefined && typeof complemento !== "string")) return null;
  const nomeLimpo = nome.trim().replace(/\s+/g, " ");
  const documentoLimpo = digitosFormatados(documento);
  const emailLimpo = email.trim();
  let celularLimpo = digitosFormatados(celular);
  if (celularLimpo?.length === 13 && celularLimpo.startsWith("55")) celularLimpo = celularLimpo.slice(2);
  const cepLimpo = digitosFormatados(cep);
  const numeroLimpo = numero.trim();
  const complementoLimpo = typeof complemento === "string" ? complemento.trim() : "";
  const inseguro = /[\u0000-\u001f\u007f<>]/;
  if (nomeLimpo.length < 3 || nomeLimpo.length > 120 || !/\p{L}.*\p{L}/u.test(nomeLimpo) ||
    inseguro.test(nome) || !documentoLimpo || !documentoValido(documentoLimpo) ||
    emailLimpo.length > 254 || !/^[^\s@<>]{1,64}@(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,63}$/i.test(emailLimpo) ||
    inseguro.test(email) || !celularLimpo || !/^[1-9]\d9\d{8}$/.test(celularLimpo) ||
    !cepLimpo || !/^\d{8}$/.test(cepLimpo) || /^(\d)\1+$/.test(cepLimpo) ||
    !/^(?:\d[\p{L}\d\s/-]{0,19}|s\/?n)$/iu.test(numeroLimpo) ||
    complementoLimpo.length > 255 || inseguro.test(complementoLimpo)) return null;
  return { nome: nomeLimpo, documento: documentoLimpo, email: emailLimpo,
    celular: celularLimpo, cep: cepLimpo, numero: numeroLimpo,
    ...(complementoLimpo ? { complemento: complementoLimpo } : {}) };
}
