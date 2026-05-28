import Link from "next/link";

import { alternarFavorito } from "@/app/(painel)/oportunidades/actions";
import { Button, buttonClassName } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatarData, formatarMoeda } from "@/lib/formatters";
import { listarFavoritos } from "@/services/oportunidades-service";

type FavoritosPageProps = {
  searchParams: Promise<{
    erro?: string;
  }>;
};

export default async function FavoritosPage({ searchParams }: FavoritosPageProps) {
  const params = await searchParams;
  const favoritos = await listarFavoritos();

  return (
    <div className="grid gap-6">
      <section>
        <h2 className="text-2xl font-semibold text-slate-950">Favoritos</h2>
        <p className="mt-1 text-slate-600">
          Editais salvos para acompanhamento e decisao comercial.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {params.erro ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800 md:col-span-2">
            {params.erro}
          </div>
        ) : null}

        {favoritos.length === 0 ? (
          <Card className="md:col-span-2">
            <CardContent className="pt-5">
              <p className="text-sm text-slate-600">
                Nenhuma oportunidade favorita ainda.
              </p>
            </CardContent>
          </Card>
        ) : null}

        {favoritos.map((oportunidade) => (
          <Card key={oportunidade.id}>
            <CardHeader>
              <CardTitle>{oportunidade.titulo}</CardTitle>
              <CardDescription>
                {oportunidade.orgao} - {oportunidade.cidade}/{oportunidade.uf}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <p className="text-sm leading-6 text-slate-600">
                {oportunidade.objeto}
              </p>
              <div className="grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <p className="text-slate-500">Match</p>
                  <p className="font-semibold text-cyan-900">
                    {oportunidade.analise?.score}%
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Valor</p>
                  <p className="font-medium text-slate-950">
                    {formatarMoeda(oportunidade.valorEstimado)}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Abertura</p>
                  <p className="font-medium text-slate-950">
                    {formatarData(oportunidade.dataAbertura)}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <form action={alternarFavorito}>
                  <input
                    type="hidden"
                    name="oportunidadeId"
                    value={oportunidade.id}
                  />
                  <input type="hidden" name="favoritoAtual" value="true" />
                  <input type="hidden" name="redirectTo" value="/favoritos" />
                  <Button type="submit" variant="ghost">
                    Desfavoritar
                  </Button>
                </form>
                <Link
                  href={`/oportunidades/${oportunidade.id}`}
                  className={buttonClassName({ variant: "secondary" })}
                >
                  Ver análise
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
