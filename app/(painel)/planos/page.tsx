import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PlanViewEvent } from "@/components/planos/upgrade-prompt";
import { getPlanEntitlements } from "@/lib/planos/entitlements";
import { obterPlanoAtual } from "@/services/planos-service";

export default async function PlanosPage() {
  const plano = await obterPlanoAtual();
  const free = getPlanEntitlements("FREE");
  const pro = getPlanEntitlements("PRO");
  return <div className="grid gap-6">
    <PlanViewEvent />
    <section>
      <h2 className="text-2xl font-semibold text-slate-950">Planos</h2>
      <p className="mt-1 text-slate-600">Seu plano atual: {plano.codigo}. O Pro estará disponível em breve.</p>
    </section>
    <div className="grid gap-4 md:grid-cols-2">
      <Card><CardHeader><CardTitle>Free</CardTitle></CardHeader><CardContent>
        <ul className="grid list-disc gap-2 pl-5 text-sm text-slate-700">
          <li>{free.maxProfiles} perfil de empresa</li>
          <li>{free.dailyMatchViews} novos scores por dia</li>
          <li>{free.maxFavorites} favoritos</li>
          <li>{free.aiAnalysisLimit} análise por IA de demonstração</li>
          <li>Histórico dos últimos {free.historyDays} dias</li>
          <li>Sem alertas automáticos</li>
        </ul>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Pro — em breve</CardTitle></CardHeader><CardContent>
        <ul className="grid list-disc gap-2 pl-5 text-sm text-slate-700">
          <li>Até {pro.maxProfiles} perfis de empresa</li>
          <li>Scores e favoritos ilimitados</li>
          <li>Alertas automáticos</li>
          <li>Histórico completo</li>
          <li>Análises por IA com franquia ampliada e configurável</li>
        </ul>
      </CardContent></Card>
    </div>
  </div>;
}
