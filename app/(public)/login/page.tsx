import Link from "next/link";

import { entrar, entrarComGoogle } from "@/app/auth/actions";
import { GoogleAuthButton } from "@/components/auth/google-auth-button";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { appConfig } from "@/lib/app-config";

type LoginPageProps = {
  searchParams: Promise<{
    erro?: string;
    mensagem?: string;
    redirectedFrom?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const redirectTo = params.redirectedFrom ?? "/dashboard";

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 sm:px-6 lg:grid lg:place-items-center lg:p-8">
      <section className="mx-auto grid w-full max-w-6xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm lg:min-h-[620px] lg:grid-cols-[1.1fr_0.9fr]">
        <div
          className="relative min-h-56 bg-cover bg-center lg:min-h-full"
          style={{
            backgroundImage: "url('/images/login-opportunities-hero.png')",
          }}
        >
          <div className="absolute inset-0 bg-slate-950/45" />
          <div className="relative flex h-full min-h-56 flex-col justify-end p-6 text-white sm:p-8 lg:p-10">
            <p className="text-sm font-semibold uppercase tracking-normal text-cyan-100">
              Radar de oportunidades
            </p>
            <h1 className="mt-3 max-w-lg text-3xl font-semibold leading-tight tracking-normal sm:text-4xl">
              Encontre oportunidades para vender ao governo.
            </h1>
            <p className="mt-4 max-w-md text-sm leading-6 text-slate-100 sm:text-base">
              Centralize buscas, priorize contratos aderentes e acompanhe prazos
              com mais clareza.
            </p>
          </div>
        </div>

        <div className="grid place-items-center p-5 sm:p-8">
          <Card className="w-full max-w-md border-0 shadow-none">
            <CardHeader className="px-0">
              <CardTitle className="text-2xl">
                Entrar na {appConfig.name}
              </CardTitle>
              <CardDescription>
                Acesse seu painel de oportunidades, favoritos e alertas.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {params.erro ? (
                <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">
                  {params.erro}
                </div>
              ) : null}
              {params.mensagem ? (
                <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">
                  {params.mensagem}
                </div>
              ) : null}

              <form action={entrarComGoogle}>
                <input type="hidden" name="redirectTo" value={redirectTo} />
                <input type="hidden" name="rotaErro" value="/login" />
                <GoogleAuthButton>Continuar com Google</GoogleAuthButton>
              </form>

              <div className="my-5 flex items-center gap-3">
                <span className="h-px flex-1 bg-slate-200" />
                <span className="text-xs font-medium uppercase tracking-normal text-slate-400">
                  ou entre com e-mail
                </span>
                <span className="h-px flex-1 bg-slate-200" />
              </div>

              <form action={entrar} className="grid gap-4">
                <input type="hidden" name="redirectTo" value={redirectTo} />
                <Input
                  label="E-mail"
                  name="email"
                  type="email"
                  placeholder="voce@empresa.com.br"
                  required
                />
                <Input
                  label="Senha"
                  name="senha"
                  type="password"
                  placeholder="Sua senha"
                  required
                />
                <Button type="submit" className="mt-2">
                  Entrar
                </Button>
              </form>
              <p className="mt-5 text-center text-sm text-slate-600">
                Ainda não tem conta?{" "}
                <Link href="/cadastro" className="font-semibold text-slate-950">
                  Criar cadastro
                </Link>
              </p>
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}
