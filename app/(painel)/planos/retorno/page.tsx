import Link from "next/link";

import { criarClienteSupabaseServer } from "@/lib/supabase/server";
import { obterPlanoAtual } from "@/services/planos-service";
import { PLAN_CATALOG } from "@/lib/planos/catalogo";
import { mensagemDoRetorno, type BillingEstado } from "@/lib/planos/apresentacao";

export default async function RetornoCheckout({ searchParams }: {
  searchParams: Promise<{ estado?: string }>;
}) {
  const { estado } = await searchParams;
  const plano = await obterPlanoAtual();
  const supabase = await criarClienteSupabaseServer();
  const { data } = await supabase.rpc("billing_estado_atual_v1");
  const billing = data as BillingEstado | null;
  const mensagem = mensagemDoRetorno(plano.codigo, billing, estado);
  return <section className="grid gap-4">
    <h1 className="text-2xl font-semibold">Assinatura</h1>
    <p>{mensagem}</p>
    <p>Seu plano atual: <strong>{PLAN_CATALOG[plano.codigo].name}</strong>.</p>
    <p>O acesso depende da confirmação do pagamento. Retornar do checkout não altera seu plano.</p>
    <Link href="/planos" className="text-cyan-700 underline">Voltar aos planos</Link>
  </section>;
}
