import Link from "next/link";

import { buttonClassName } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { appConfig } from "@/lib/app-config";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-6">
        <nav className="flex items-center justify-between">
          <Link href="/" className="text-lg font-semibold">
            {appConfig.name}
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="rounded-md px-3 py-2 text-sm font-medium text-slate-200 transition hover:text-white"
            >
              Entrar
            </Link>
            <Link href="/cadastro" className={buttonClassName()}>
              Começar
            </Link>
          </div>
        </nav>

        <div className="grid flex-1 items-center gap-10 py-12 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="max-w-3xl">
            <span className="inline-flex rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-sm font-medium text-cyan-100">
              {appConfig.description}
            </span>
            <h1 className="mt-6 text-4xl font-semibold tracking-normal text-white sm:text-6xl">
              Encontre editais com maior chance de aderência ao seu negócio.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
              Cadastre perfis de empresa, acompanhe oportunidades, receba
              alertas por e-mail e use IA para priorizar editais com match
              score, resumo e pontos de atenção.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/dashboard" className={buttonClassName({ size: "lg" })}>
                Ver dashboard
              </Link>
              <Link
                href="/oportunidades"
                className="inline-flex h-11 items-center justify-center rounded-md border border-white/15 px-5 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Explorar oportunidades
              </Link>
            </div>
          </div>

          <Card className="border-white/10 bg-white/10 text-white shadow-2xl shadow-cyan-950/40 backdrop-blur">
            <CardContent className="space-y-5 p-6">
              <div className="flex items-start justify-between gap-5 border-b border-white/10 pb-5">
                <div>
                  <p className="text-sm text-slate-300">Match recomendado</p>
                  <h2 className="mt-1 text-2xl font-semibold">
                    Pregão eletrônico 42/2026
                  </h2>
                </div>
                <span className="rounded-md bg-emerald-300 px-3 py-1 text-sm font-bold text-emerald-950">
                  92%
                </span>
              </div>
              <div className="grid gap-3 text-sm text-slate-200">
                <div className="rounded-md bg-white/10 p-4">
                  Fornecimento de plataforma SaaS para gestão documental com
                  integração de assinatura eletrônica.
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md bg-white/10 p-4">
                    <p className="text-slate-400">Valor estimado</p>
                    <p className="mt-1 font-semibold text-white">
                      R$ 480.000,00
                    </p>
                  </div>
                  <div className="rounded-md bg-white/10 p-4">
                    <p className="text-slate-400">Abertura</p>
                    <p className="mt-1 font-semibold text-white">12/06/2026</p>
                  </div>
                </div>
                <div className="rounded-md border border-cyan-300/20 bg-cyan-300/10 p-4 text-cyan-50">
                  A IA identificou alta aderência técnica, baixa exigência de
                  capital social e prazo adequado para preparação da proposta.
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}
