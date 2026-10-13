import { cobrancaPertenceAoCheckout } from "@/lib/billing/validacao";

type CobrancaConsultada = {
  id: string; subscription: string; customer: string; checkoutSession?: unknown;
};
type ListaCobrancas = { data: CobrancaConsultada[]; hasMore: boolean };

// O pagamento deve vir do GET autenticado /payments/{id}, nunca diretamente
// do webhook. O vinculo explicito da cobranca evita depender da listagem
// por checkout, que no Sandbox retornou zero itens apos pagamento.
export async function verificarCheckoutDaCobranca(
  pagamento: CobrancaConsultada,
  checkoutId: string,
  consultar: <T>(path: string) => Promise<T>,
): Promise<boolean> {
  if (!checkoutId) return false;
  if (pagamento.checkoutSession !== undefined && pagamento.checkoutSession !== null) {
    return pagamento.checkoutSession === checkoutId;
  }
  // Compatibilidade com respostas sem o campo; continua exigindo vinculos
  // de pagamento, assinatura e cliente na listagem filtrada da API.
  const lista = await consultar<ListaCobrancas>(
    `/payments?checkoutSession=${encodeURIComponent(checkoutId)}&limit=100`,
  );
  return cobrancaPertenceAoCheckout(lista, pagamento);
}
