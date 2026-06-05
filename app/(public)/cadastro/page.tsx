import Link from "next/link";

import { cadastrar, entrarComGoogle } from "@/app/auth/actions";
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

type CadastroPageProps = {
  searchParams: Promise<{
    erro?: string;
  }>;
};

export default async function CadastroPage({ searchParams }: CadastroPageProps) {
  const params = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 px-5 py-10">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Criar conta</CardTitle>
          <CardDescription>
            Configure o acesso inicial à {appConfig.name}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {params.erro ? (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">
              {params.erro}
            </div>
          ) : null}

          <form action={cadastrar} className="grid gap-4 sm:grid-cols-2">
            <Input label="Nome" name="nome" placeholder="Seu nome" required />
            <Input
              label="Empresa"
              name="empresa"
              placeholder="Nome da empresa"
              required
            />
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
              placeholder="Crie uma senha"
              minLength={6}
              required
            />
            <div className="sm:col-span-2">
              <Button type="submit" className="w-full">
                Criar conta
              </Button>
            </div>
          </form>

          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-slate-200" />
            <span className="text-xs font-medium uppercase tracking-normal text-slate-400">
              ou
            </span>
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          <form action={entrarComGoogle}>
            <input type="hidden" name="redirectTo" value="/dashboard" />
            <input type="hidden" name="rotaErro" value="/cadastro" />
            <GoogleAuthButton>Criar conta com Google</GoogleAuthButton>
          </form>

          <p className="mt-5 text-center text-sm text-slate-600">
            Já possui acesso?{" "}
            <Link href="/login" className="font-semibold text-slate-950">
              Entrar
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
