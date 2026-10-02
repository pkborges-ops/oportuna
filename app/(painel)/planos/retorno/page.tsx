import Link from "next/link";

import { criarClienteSupabaseServer } from "@/lib/supabase/server";
import { obterPlanoAtual } from "@/services/planos-service";
import { PLAN_CATALOG, paidPlanCode } from "@/lib/planos/catalogo";

export default async function RetornoCheckout({ searchParams }: {
  searchParams: Promise<{ estado?: string }>;
}) {
  const { estado } = await searchParams;
  const plano = await obterPlanoAtual();
  const supabase = await criarClienteSupabaseServer();
  const { data } = await supabase.rpc("billing_estado_atual_v1");
  const billing = data as { status?: string; plan_code?: string } | null;
  const planCode = paidPlanCode(billing?.plan_code);
  const planName = planCode ? PLAN_CATALOG[planCode].name : "o plano escolhido";
  const mensagem = estado === "cancelado" ? "O checkout foi cancelado." :
    estado === "expirado" ? "O checkout expirou." :
    `Pagamento recebido pelo checkout. Estamos confirmando sua assinatura ${planName}.`;
  return <section className="grid gap-4">
    <h1 className="text-2xl font-semibold">Assinatura</h1>
    <p>{mensagem}</p>
    <p>Plano efetivo agora: <strong>{plano.codigo}</strong>.
      {billing?.status ? ` Estado do pagamento: ${billing.status}.` : ""}</p>
    <p>Esta página não libera acesso. A confirmação é processada pelo webhook financeiro.</p>
    <Link href="/planos" className="text-cyan-700 underline">Voltar aos planos</Link>
  </section>;
}
