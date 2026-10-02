import { criarOuReutilizarCheckout } from "@/lib/billing/checkout";
import { dadosPagadorValidos } from "@/lib/billing/validacao";
import { paidPlanCode } from "@/lib/planos/catalogo";
import { criarClienteSupabaseServer } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
  const supabase = await criarClienteSupabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return new Response(null, { status: 401 });
  let form: FormData;
  try { form = await request.formData(); } catch { return new Response(null, { status: 400 }); }
  const planCode = paidPlanCode(form.get("plan"));
  if (!planCode) return new Response(null, { status: 400 });
  const pagador = dadosPagadorValidos(form.get("nomePagador"), form.get("documentoPagador"));
  if (!pagador) {
    return Response.redirect(new URL("/planos?erro=Informe%20nome%20e%20CPF%20ou%20CNPJ%20validos.", request.url), 303);
  }
  try {
    const checkout = await criarOuReutilizarCheckout(data.user.id, pagador.nome, pagador.documento, planCode);
    return Response.redirect(checkout, 303);
  } catch {
    return Response.redirect(new URL(
      "/planos?erro=Nao%20foi%20possivel%20iniciar%20o%20pagamento.%20Confira%20o%20estado%20do%20plano%20ou%20tente%20mais%20tarde.",
      request.url), 303);
  }
}
