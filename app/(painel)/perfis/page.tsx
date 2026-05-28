import Link from "next/link";

import { excluirPerfil } from "@/app/(painel)/perfis/actions";
import { Button, buttonClassName } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatarData, formatarStatus } from "@/lib/formatters";
import { listarPerfis } from "@/services/perfis-service";

type PerfisPageProps = {
  searchParams: Promise<{
    erro?: string;
    mensagem?: string;
  }>;
};

export default async function PerfisPage({ searchParams }: PerfisPageProps) {
  const params = await searchParams;
  const perfis = await listarPerfis();

  return (
    <div className="grid gap-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-950">
            Perfis de empresa
          </h2>
          <p className="mt-1 text-slate-600">
            Configure empresas, segmentos e palavras-chave para orientar a IA.
          </p>
        </div>
        <Link href="/perfis/novo" className={buttonClassName()}>
          Novo perfil
        </Link>
      </section>

      <section className="grid gap-4">
        {params.erro ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">
            {params.erro}
          </div>
        ) : null}
        {params.mensagem ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">
            {params.mensagem}
          </div>
        ) : null}

        {perfis.length === 0 ? (
          <Card>
            <CardContent className="pt-5">
              <p className="text-sm text-slate-600">
                Nenhum perfil cadastrado ainda.
              </p>
            </CardContent>
          </Card>
        ) : null}

        {perfis.map((perfil) => (
          <Card key={perfil.id}>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>{perfil.nomeEmpresa}</CardTitle>
                <CardDescription>
                  {perfil.segmento} - {perfil.cnpj}
                </CardDescription>
              </div>
              <span className="w-fit rounded-md bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-800">
                {formatarStatus(perfil.status)}
              </span>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <p className="text-slate-500">Porte</p>
                  <p className="font-medium text-slate-950">{perfil.porte}</p>
                </div>
                <div>
                  <p className="text-slate-500">UF</p>
                  <p className="font-medium text-slate-950">{perfil.uf}</p>
                </div>
                <div>
                  <p className="text-slate-500">Criado em</p>
                  <p className="font-medium text-slate-950">
                    {formatarData(perfil.criadoEm)}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {perfil.palavrasChave.map((palavra) => (
                  <span
                    key={palavra}
                    className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
                  >
                    {palavra}
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
                <Link
                  href={`/perfis/${perfil.id}`}
                  className={buttonClassName({ variant: "secondary" })}
                >
                  Editar
                </Link>
                <form action={excluirPerfil}>
                  <input type="hidden" name="id" value={perfil.id} />
                  <Button type="submit" variant="ghost">
                    Excluir
                  </Button>
                </form>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
