import Link from "next/link";

import { buttonClassName } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatarData, formatarMoeda } from "@/lib/formatters";
import {
  listarFavoritos,
  listarOportunidades,
} from "@/services/oportunidades-service";
import { listarPerfis } from "@/services/perfis-service";

export default async function DashboardPage() {
  const [oportunidades, perfis, favoritos] = await Promise.all([
    listarOportunidades(),
    listarPerfis(),
    listarFavoritos(),
  ]);
  const melhorMatch = [...oportunidades].sort(
    (a, b) => (b.analise?.score ?? 0) - (a.analise?.score ?? 0),
  )[0];

  return (
    <div className="grid gap-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-950">Dashboard</h2>
          <p className="mt-1 text-slate-600">
            Visão consolidada dos perfis, oportunidades e alertas de editais.
          </p>
        </div>
        <Link href="/oportunidades" className={buttonClassName()}>
          Buscar editais
        </Link>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        {[
          { label: "Oportunidades", value: oportunidades.length },
          { label: "Favoritos", value: favoritos.length },
          { label: "Perfis ativos", value: perfis.length },
          { label: "Alertas por e-mail", value: 12 },
        ].map((item) => (
          <Card key={item.label}>
            <CardHeader>
              <CardDescription>{item.label}</CardDescription>
              <CardTitle className="text-3xl">{item.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>Melhor oportunidade do momento</CardTitle>
            <CardDescription>
              Priorizada pela análise de aderência entre edital e perfil.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {melhorMatch ? (
              <>
                <div className="flex flex-col gap-3 rounded-lg bg-slate-50 p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="font-semibold text-slate-950">
                      {melhorMatch.titulo}
                    </h3>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                      {melhorMatch.objeto}
                    </p>
                  </div>
                  <span className="w-fit rounded-md bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-800">
                    {melhorMatch.analise?.score ?? 0}% match
                  </span>
                </div>
                <div className="grid gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <p className="text-slate-500">Orgao</p>
                    <p className="mt-1 font-medium text-slate-950">
                      {melhorMatch.orgao}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Valor estimado</p>
                    <p className="mt-1 font-medium text-slate-950">
                      {formatarMoeda(melhorMatch.valorEstimado)}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Abertura</p>
                    <p className="mt-1 font-medium text-slate-950">
                      {formatarData(melhorMatch.dataAbertura)}
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
                Nenhuma oportunidade cadastrada ainda.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Proximas acoes</CardTitle>
            <CardDescription>
              Pontos preparados para a evolucao do produto.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 text-sm text-slate-700">
              <div className="rounded-md border border-slate-200 p-3">
              Conectar autenticação real e controle de sessão.
              </div>
              <div className="rounded-md border border-slate-200 p-3">
                Substituir mocks por API de editais e persistência.
              </div>
              <div className="rounded-md border border-slate-200 p-3">
                Integrar fila de alertas por e-mail.
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
