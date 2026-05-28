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
import { Input } from "@/components/ui/input";
import { formatarData, formatarMoeda, formatarStatus } from "@/lib/formatters";
import { listarOportunidades } from "@/services/oportunidades-service";
import type { OpportunityStatus } from "@/types";

type OportunidadesPageProps = {
  searchParams: Promise<{
    busca?: string;
    status?: OpportunityStatus | "";
    uf?: string;
    erro?: string;
  }>;
};

const campoSelect =
  "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100";

function montarDestino(params: Awaited<OportunidadesPageProps["searchParams"]>) {
  const query = new URLSearchParams();

  if (params.busca) query.set("busca", params.busca);
  if (params.status) query.set("status", params.status);
  if (params.uf) query.set("uf", params.uf);

  const queryString = query.toString();
  return queryString ? `/oportunidades?${queryString}` : "/oportunidades";
}

export default async function OportunidadesPage({
  searchParams,
}: OportunidadesPageProps) {
  const params = await searchParams;
  const oportunidades = await listarOportunidades(params);
  const destino = montarDestino(params);

  return (
    <div className="grid gap-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-950">
            Oportunidades
          </h2>
          <p className="mt-1 text-slate-600">
            Busque, filtre e avalie editais com score gerado por IA.
          </p>
        </div>
        <form
          action="/oportunidades"
          className="grid w-full gap-3 sm:max-w-2xl sm:grid-cols-[1fr_140px_90px_auto] sm:items-end"
        >
          <Input
            label="Buscar edital"
            name="busca"
            defaultValue={params.busca ?? ""}
            placeholder="Software, engenharia, licenças..."
          />
          <label className="grid gap-2 text-sm font-medium text-slate-700">
            <span>Status</span>
            <select
              name="status"
              className={campoSelect}
              defaultValue={params.status ?? ""}
            >
              <option value="">Todos</option>
              <option value="aberta">Aberta</option>
              <option value="em_analise">Em análise</option>
              <option value="encerrada">Encerrada</option>
            </select>
          </label>
          <Input
            label="UF"
            name="uf"
            defaultValue={params.uf ?? ""}
            placeholder="SP"
            maxLength={2}
          />
          <Button type="submit">Filtrar</Button>
        </form>
      </section>

      <section className="grid gap-4">
        {params.erro ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">
            {params.erro}
          </div>
        ) : null}

        {oportunidades.length === 0 ? (
          <Card>
            <CardContent className="pt-5">
              <p className="text-sm text-slate-600">
                Nenhuma oportunidade encontrada para os filtros informados.
              </p>
            </CardContent>
          </Card>
        ) : null}

        {oportunidades.map((oportunidade) => (
          <Card key={oportunidade.id}>
            <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle>{oportunidade.titulo}</CardTitle>
                <CardDescription>
                  {oportunidade.orgao} - {oportunidade.cidade}/{oportunidade.uf}
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-md bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
                  {formatarStatus(oportunidade.status)}
                </span>
                <span className="rounded-md bg-cyan-100 px-3 py-1 text-sm font-bold text-cyan-900">
                  {oportunidade.analise?.score}% match
                </span>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4">
              <p className="text-sm leading-6 text-slate-600">
                {oportunidade.objeto}
              </p>
              <div className="grid gap-3 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-slate-500">Modalidade</p>
                  <p className="font-medium text-slate-950">
                    {oportunidade.modalidade}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Valor</p>
                  <p className="font-medium text-slate-950">
                    {formatarMoeda(oportunidade.valorEstimado)}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Publicação</p>
                  <p className="font-medium text-slate-950">
                    {formatarData(oportunidade.dataPublicacao)}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Abertura</p>
                  <p className="font-medium text-slate-950">
                    {formatarData(oportunidade.dataAbertura)}
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-2">
                  {oportunidade.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <form action={alternarFavorito}>
                    <input
                      type="hidden"
                      name="oportunidadeId"
                      value={oportunidade.id}
                    />
                    <input
                      type="hidden"
                      name="favoritoAtual"
                      value={String(oportunidade.favorito)}
                    />
                    <input type="hidden" name="redirectTo" value={destino} />
                    <Button
                      type="submit"
                      variant={oportunidade.favorito ? "ghost" : "primary"}
                    >
                      {oportunidade.favorito ? "Desfavoritar" : "Favoritar"}
                    </Button>
                  </form>
                  <Link
                    href={`/oportunidades/${oportunidade.id}`}
                    className={buttonClassName({ variant: "secondary" })}
                  >
                    Ver detalhes
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
