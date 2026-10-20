import { criarOuReutilizarCheckout } from "@/lib/billing/checkout";
import { pedidoCheckout } from "@/lib/billing/pedido";
import { checkoutPermitido } from "@/lib/billing/canario";
import { criarClienteSupabaseServer } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
  const supabase = await criarClienteSupabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return new Response(null, { status: 401 });
  let form: FormData;
  try { form = await request.formData(); } catch { return new Response(null, { status: 400 }); }
  const { planCode, pagador } = pedidoCheckout(form);
  if (!planCode) return new Response(null, { status: 400 });
  if (!checkoutPermitido(data.user.id, planCode)) {
    return new Response("Assinaturas em liberação gradual.", {
      status: 403, headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  if (!pagador) {
    return Response.redirect(new URL("/planos?erro=Confira%20nome,%20CPF%20ou%20CNPJ,%20email,%20celular,%20CEP%20e%20numero%20do%20pagador.", request.url), 303);
  }
  try {
    const checkout = await criarOuReutilizarCheckout(data.user.id, pagador, planCode);
    return Response.redirect(checkout, 303);
  } catch {
    return Response.redirect(new URL(
      "/planos?erro=Nao%20foi%20possivel%20iniciar%20o%20pagamento.%20Confira%20o%20estado%20do%20plano%20ou%20tente%20mais%20tarde.",
      request.url), 303);
  }
}
