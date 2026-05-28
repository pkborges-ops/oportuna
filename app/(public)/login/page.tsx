import Link from "next/link";

import { entrar } from "@/app/auth/actions";
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
    <main className="grid min-h-screen place-items-center bg-slate-100 px-5 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Entrar na {appConfig.name}</CardTitle>
          <CardDescription>
            Acesse o painel para acompanhar editais, favoritos e alertas.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
    </main>
  );
}
