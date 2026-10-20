import { PlanViewEvent } from "@/components/planos/upgrade-prompt";
import { PlanosView } from "@/components/planos/planos-view";
import { paidOffer } from "@/lib/planos/catalogo";
import { type BillingEstado } from "@/lib/planos/apresentacao";
import { obterConfigAsaas } from "@/lib/billing/asaas";
import { criarClienteBilling } from "@/lib/billing/banco";
import { criarClienteSupabaseServer } from "@/lib/supabase/server";
import { obterPlanoAtual } from "@/services/planos-service";

export default async function PlanosPage({ searchParams }: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const plano = await obterPlanoAtual();
  const supabase = await criarClienteSupabaseServer();
  const [{ data: { user } }, { data: estado, error: estadoErro }, params] = await Promise.all([
    supabase.auth.getUser(), supabase.rpc("billing_estado_atual_v1"), searchParams,
  ]);
  const nomeConta = user?.user_metadata?.nome ?? user?.user_metadata?.full_name ?? user?.user_metadata?.name;
  let ready = false;
  if (!estadoErro) {
    try {
      const config = obterConfigAsaas();
      await criarClienteBilling(config.environment);
      ready = true;
    } catch { /* Sem configuracao compativel, nenhuma contratacao e oferecida. */ }
  }
  return <>
    <PlanViewEvent />
    <PlanosView current={plano.codigo} billing={estado as BillingEstado | null} ready={ready}
      offers={{ PRO: paidOffer("PRO"), BUSINESS: paidOffer("BUSINESS") }}
      nomeInicial={typeof nomeConta === "string" ? nomeConta.slice(0, 120) : ""}
      emailInicial={user?.email ?? ""} error={params.erro ? "Não foi possível continuar. Confira os dados do pagador ou acompanhe a situação da assinatura." : undefined} />
  </>;
}
