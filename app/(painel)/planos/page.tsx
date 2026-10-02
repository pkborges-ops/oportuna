import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PlanViewEvent } from "@/components/planos/upgrade-prompt";
import { getPlanEntitlements } from "@/lib/planos/entitlements";
import { paidOffer, PLAN_CATALOG, type PaidPlanCode } from "@/lib/planos/catalogo";
import { obterConfigAsaas } from "@/lib/billing/asaas";
import { criarClienteSupabaseServer } from "@/lib/supabase/server";
import { obterPlanoAtual } from "@/services/planos-service";

export default async function PlanosPage({ searchParams }: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const plano = await obterPlanoAtual();
  const supabase = await criarClienteSupabaseServer();
  const { data: estado, error: estadoErro } = await supabase.rpc("billing_estado_atual_v1");
  const billing = estado as { status?: string; plan_code?: PaidPlanCode; paid_until?: string } | null;
  let ambientePronto = Boolean(process.env.SUPABASE_SECRET_KEY && !estadoErro);
  try { obterConfigAsaas(); } catch { ambientePronto = false; }
  const pendente = billing?.status && ["creating", "uncertain", "checkout_pending",
    "checkout_paid", "payment_pending", "past_due"].includes(billing.status);
  const podeIniciar = !billing?.status || ["canceled", "expired"].includes(billing.status);
  const { erro } = await searchParams;
  const free = getPlanEntitlements("FREE");
  return <div className="grid gap-6">
    <PlanViewEvent />
    <section>
      <h2 className="text-2xl font-semibold text-slate-950">Planos</h2>
      <p className="mt-1 text-slate-600">Seu plano atual: {plano.codigo}.</p>
      {erro ? <p role="alert" className="mt-2 text-red-700">{erro}</p> : null}
      {pendente && plano.codigo === "FREE" ? <p className="mt-2 text-amber-800">
        Pagamento pendente para {billing?.plan_code ?? "o plano escolhido"}. O acesso é liberado após confirmação financeira.
      </p> : null}
    </section>
    <div className="grid gap-4 lg:grid-cols-3">
      <Card><CardHeader><CardTitle>Free</CardTitle></CardHeader><CardContent>
        <ul className="grid list-disc gap-2 pl-5 text-sm text-slate-700">
          <li>{free.maxProfiles} perfil de empresa</li>
          <li>{free.dailyMatchViews} novos scores por dia</li>
          <li>{free.maxFavorites} favoritos</li>
          <li>{free.aiAnalysisLimit} análise por IA de demonstração</li>
          <li>Histórico dos últimos {free.historyDays} dias</li>
          <li>Sem alertas automáticos</li>
        </ul>
        <p className="mt-4 font-semibold">{plano.codigo === "FREE" ? "Plano atual" : "Gratuito para novas contas"}</p>
      </CardContent></Card>
      {(["PRO", "BUSINESS"] as const).map((code) => {
        const oferta = paidOffer(code);
        const atual = plano.codigo === code;
        const outroPago = plano.codigo !== "FREE" && !atual;
        const reutilizar = billing?.status === "checkout_pending" && billing.plan_code === code;
        const disponivel = ambientePronto && oferta !== null && !outroPago && (podeIniciar || reutilizar);
        const regras = getPlanEntitlements(code);
        return <Card key={code}><CardHeader><CardTitle>{PLAN_CATALOG[code].name} mensal</CardTitle></CardHeader><CardContent>
          <ul className="grid list-disc gap-2 pl-5 text-sm text-slate-700">
            <li>{regras.maxProfiles === null ? "Mais perfis; limite comercial a definir" : `Até ${regras.maxProfiles} perfis de empresa`}</li>
            <li>Scores e favoritos ilimitados</li>
            <li>{code === "BUSINESS" ? "Alertas atuais; recursos avançados futuros" : "Alertas automáticos"}</li>
            <li>Histórico completo</li>
            <li>{oferta?.aiQuota ? `${oferta.aiQuota} análises por IA por mês` :
              "Franquia de IA a definir por assinatura"}</li>
            {code === "BUSINESS" ? <li>Equipes e Assistente de Participação: previstos para etapa futura</li> : null}
          </ul>
          <p className="mt-4 font-semibold">{oferta ? `${(oferta.priceCents / 100).toLocaleString("pt-BR", {
            style: "currency", currency: "BRL" })} / mês` : "Condições comerciais a definir"}</p>
          {atual ? <p className="mt-4 font-semibold text-emerald-700">
            Plano atual{billing?.paid_until ? ` até ${new Date(billing.paid_until).toLocaleDateString("pt-BR")}` : ""}.
            {billing?.status ? " Gerencie a assinatura pelo suporte nesta primeira versão." : ""}
          </p> : disponivel ? <form action="/api/billing/checkout" method="post" className="mt-4 grid gap-3">
            <input type="hidden" name="plan" value={code} />
            <label className="grid gap-1 text-sm">Nome do pagador
              <input name="nomePagador" required minLength={3} maxLength={120}
                className="rounded-md border px-3 py-2" autoComplete="name" />
            </label>
            <label className="grid gap-1 text-sm">CPF ou CNPJ do pagador
              <input name="documentoPagador" required inputMode="numeric"
                className="rounded-md border px-3 py-2" />
            </label>
            <button type="submit" className="rounded-md bg-cyan-700 px-4 py-2 font-semibold text-white">
              {reutilizar ? "Continuar pagamento" : `Assinar ${PLAN_CATALOG[code].name}`}
            </button>
            <p className="text-xs text-slate-600">Checkout seguro hospedado pelo Asaas Sandbox. O Oportuna não recebe dados do cartão.</p>
          </form> : <p className="mt-4 text-sm text-slate-600">
            {outroPago ? "Troca de plano requer atendimento nesta versão." : !oferta ?
              "Contratação indisponível até definição de preço e franquia." :
              ambientePronto ? "Assinatura em processamento ou revisão." : "Assinatura indisponível neste ambiente."}
          </p>}
        </CardContent></Card>;
      })}
    </div>
  </div>;
}
