import { dadosPagadorValidos } from "@/lib/billing/validacao";
import { paidPlanCode } from "@/lib/planos/catalogo";

// Apenas estes campos entram na operacao; preco, quota e usuario vem do servidor.
export function pedidoCheckout(form: FormData) {
  const planCode = paidPlanCode(form.get("plan"));
  const pagador = dadosPagadorValidos({
    nome: form.get("nomePagador"), documento: form.get("documentoPagador"),
    email: form.get("emailPagador"), celular: form.get("celularPagador"),
    cep: form.get("cepPagador"), numero: form.get("numeroPagador"),
    complemento: form.get("complementoPagador") ?? undefined,
  });
  return { planCode, pagador };
}
