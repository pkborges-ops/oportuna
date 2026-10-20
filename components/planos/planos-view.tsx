import { AssinaturaDialog } from "@/components/planos/assinatura-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PLAN_CATALOG, type PlanCode, type PaidPlanCode, type paidOffer } from "@/lib/planos/catalogo";
import { getPlanEntitlements } from "@/lib/planos/entitlements";
import { dataDoPlano, estadoDoPlano, type BillingEstado } from "@/lib/planos/apresentacao";

type Props = {
  current: PlanCode; billing: BillingEstado | null; ready: boolean;
  offers: Record<PaidPlanCode, ReturnType<typeof paidOffer>>;
  nomeInicial: string; emailInicial: string; error?: string; now?: number;
};
const priceLabel = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function PlanosView({ current, billing, ready, offers, nomeInicial, emailInicial, error, now }: Props) {
  const until = billing?.plan_code === current ? dataDoPlano(billing.paid_until) : null;
  const quota = billing?.plan_code === current ? billing.franquia_ia : null;
  const pending = current === "FREE" && billing?.status && !["canceled", "expired"].includes(billing.status);
  return <div className="grid gap-6">
    <section aria-label="Resumo do plano atual" className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
      <h1 className="text-2xl font-semibold text-slate-950">Planos</h1>
      <p className="mt-1 text-slate-700">Escolha o plano para o seu volume de oportunidades.</p>
      <p className="mt-4 flex flex-wrap items-center gap-2 font-semibold text-emerald-900">
        Seu plano: {PLAN_CATALOG[current].name}
        <span className="rounded-full bg-emerald-700 px-3 py-1 text-xs text-white">{current === "FREE" ? "Plano atual" : "Acesso ativo"}</span>
      </p>
      {until ? <p className="mt-2 text-sm text-emerald-900">Acesso ativo até {until}</p> : null}
      {current !== "FREE" && quota ? <p className="mt-1 text-sm text-slate-700">{quota.toLocaleString("pt-BR")} análises de IA por mês</p> : null}
      {pending ? <p role="status" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        {estadoDoPlano(billing?.plan_code === "BUSINESS" ? "BUSINESS" : "PRO", current, billing, ready,
          Boolean(billing?.plan_code && billing.plan_code !== "FREE" && offers[billing.plan_code]), now).label}.
        {" "}O acesso será liberado após confirmação do pagamento.
      </p> : null}
      {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
    </section>
    <div className="grid items-stretch gap-5 lg:grid-cols-3">
      {(["FREE", "PRO", "BUSINESS"] as const).map(code => {
        const actual = current === code;
        const offer = code === "FREE" ? null : offers[code];
        const rules = getPlanEntitlements(code);
        const state = estadoDoPlano(code, current, billing, ready, code === "FREE" || Boolean(offer), now);
        const benefits = [
          code === "FREE" ? `${rules.aiAnalysisLimit} análise de IA de demonstração` :
            offer?.aiQuota ? `${offer.aiQuota.toLocaleString("pt-BR")} análises IA/mês` : "Franquia de IA sob consulta",
          code === "FREE" ? `${rules.dailyMatchViews} novos scores por dia` : "Scores ilimitados",
          code === "FREE" ? `${rules.maxFavorites} favoritos` : "Favoritos ilimitados",
          code === "FREE" ? "Sem alertas automáticos" : "Alertas automáticos",
          code === "FREE" ? `Histórico dos últimos ${rules.historyDays} dias` : "Histórico completo",
          code === "BUSINESS" ? "Perfis de empresa" :
            code === "FREE" ? `${rules.maxProfiles} perfil de empresa` : `Até ${rules.maxProfiles} perfis de empresa`,
        ];
        return <Card key={code} aria-label={`Plano ${PLAN_CATALOG[code].name}`}
          className="flex min-w-0 flex-col rounded-xl"
          style={{ borderWidth: 2, borderColor: actual ? "#059669" : code === "PRO" ? "#0891b2" : "#cbd5e1",
            backgroundColor: actual ? "#f0fdf4" : code === "PRO" ? "#ecfeff" : "#ffffff" }}>
          <CardHeader>
            <div className="flex min-h-7 flex-wrap items-center gap-2">
              {code === "PRO" ? <span className="rounded-full bg-cyan-700 px-3 py-1 text-xs font-semibold text-white">Recomendado</span> : null}
              {actual ? <span className="rounded-full bg-emerald-700 px-3 py-1 text-xs font-semibold text-white">Plano atual</span> : null}
            </div>
            <CardTitle className="pt-2 text-xl">{PLAN_CATALOG[code].name}</CardTitle>
            <p className="min-h-10 pt-1 text-sm text-slate-600">{code === "FREE" ? "Para começar" :
              code === "PRO" ? "Principal opção para acompanhar oportunidades" : "Para maior volume de IA"}</p>
            <p className="min-h-10 text-3xl font-bold tracking-tight text-slate-950">
              {code === "FREE" ? priceLabel(0) : offer ? priceLabel(offer.priceCents) : "Sob consulta"}
              <span className="ml-1 text-sm font-normal text-slate-600">/mês</span>
            </p>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col">
            <ul className="grid gap-3 text-sm text-slate-700">
              {benefits.map(benefit => <li key={benefit} className="flex gap-2"><span aria-hidden="true" className="text-cyan-700">✓</span>{benefit}</li>)}
            </ul>
            <div className="mt-auto pt-6">
              {state.action && code !== "FREE" && offer ? <>
                {state.action === "continue" ? <p className="mb-2 text-sm font-semibold text-amber-900">{state.label}</p> : null}
                <AssinaturaDialog planCode={code} planName={offer.name} priceLabel={priceLabel(offer.priceCents)}
                  nomeInicial={nomeInicial} emailInicial={emailInicial} reutilizar={state.action === "continue"} />
              </> : <p className={`rounded-lg border px-4 py-3 text-center text-sm font-semibold ${actual ?
                "border-emerald-300 bg-emerald-100 text-emerald-900" : "border-slate-200 bg-slate-100 text-slate-700"}`}>{state.label}</p>}
              <p className="mt-3 min-h-12 text-sm text-slate-600">{actual ?
                until ? `Acesso ativo até ${until}. Gerencie a assinatura pelo suporte.` :
                  code === "FREE" ? "Gratuito. Não exige dados de pagamento." : "Gerencie a assinatura pelo suporte." :
                state.message ?? (state.action ? "Checkout seguro hospedado pelo Asaas." : "")}</p>
            </div>
          </CardContent>
        </Card>;
      })}
    </div>
  </div>;
}
