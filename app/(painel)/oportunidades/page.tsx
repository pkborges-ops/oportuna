import {
  ORDENACOES,
  resolverOrdenacao,
} from "@/lib/matching/ordenar-oportunidades";
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
import { listarPerfis } from "@/services/perfis-service";
import {
  BadgeAderencia,
  MotivosAderencia,
} from "@/components/oportunidades/aderencia";
import {
  destinoLimparFiltros,
  lerContexto,
  montarDestino,
  prepararListagem,
  selecionarPerfil,
  type QueryOportunidades,
} from "@/lib/matching/contexto";

type OportunidadesPageProps = {
  searchParams: Promise<QueryOportunidades>;
};

const campoSelect =
  "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100";

export default async function OportunidadesPage({
  searchParams,
}: OportunidadesPageProps) {
  const params = lerContexto(await searchParams);
  const [oportunidades, perfis] = await Promise.all([
    listarOportunidades(params),
    listarPerfis(),
  ]);
  const perfil = selecionarPerfil(perfis, params.perfilId);
  const contexto = {
    ...params,
    perfilId: perfil?.id ?? "",
    aderencia: perfil ? params.aderencia : undefined,
    ordenacao: resolverOrdenacao(params.ordenacao, Boolean(perfil)),
  };
  const resultados = prepararListagem(
    oportunidades,
    perfil,
    contexto.aderencia,
    contexto.ordenacao,
  );
  const destino = montarDestino(contexto);

  return (
    <div className="grid gap-6">
      <section className="grid gap-6">
        <div>
          <h2 className="text-2xl font-semibold text-slate-950">
            Oportunidades
          </h2>
          <p className="mt-1 text-slate-600">
            Busque oportunidades nacionais e calcule a aderência ao perfil da
            sua empresa.
          </p>
        </div>
        <form action="/oportunidades" className="grid gap-5">
          <label className="grid w-full gap-2 text-sm font-medium text-slate-700 lg:max-w-2xl">
            <span>Perfil da empresa</span>
            <select
              name="perfilId"
              className={campoSelect}
              defaultValue={perfil?.id ?? ""}
            >
              <option value="">Selecione um perfil</option>
              {perfis.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nomeEmpresa}
                  {item.status === "inativo" ? " (inativo)" : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-12 lg:items-end">
            <div className="sm:col-span-2 lg:col-span-4">
              <Input
                label="Buscar oportunidade"
                name="busca"
                defaultValue={params.busca ?? ""}
                placeholder="Software, engenharia, licenças..."
              />
            </div>
            <label className="grid gap-2 text-sm font-medium text-slate-700 lg:col-span-2">
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
            {perfil ? (
              <label className="grid gap-2 text-sm font-medium text-slate-700 lg:col-span-2">
                <span>Aderência</span>
                <select
                  name="aderencia"
                  className={campoSelect}
                  defaultValue={contexto.aderencia ?? ""}
                >
                  <option value="">Todas</option>
                  <option value="alta">Alta (70–100)</option>
                  <option value="media">Média (40–69)</option>
                  <option value="baixa">Baixa (0–39)</option>
                </select>
              </label>
            ) : null}
            <div className="lg:col-span-1">
              <Input
                label="UF"
                name="uf"
                defaultValue={params.uf ?? ""}
                placeholder="SP"
                maxLength={2}
              />
            </div>
            <label className="grid gap-2 text-sm font-medium text-slate-700 lg:col-span-3">
              <span>Ordenar por</span>
              <select
                name="ordenacao"
                className={campoSelect}
                defaultValue={contexto.ordenacao}
              >
                {Object.entries(ORDENACOES)
                  .filter(([valor]) => perfil || valor !== "maior_aderencia")
                  .map(([valor, label]) => (
                    <option key={valor} value={valor}>
                      {label}
                    </option>
                  ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-12">
              <Button type="submit">Filtrar</Button>
              <Link
                href={destinoLimparFiltros(contexto)}
                className={buttonClassName({ variant: "secondary" })}
              >
                Limpar filtros
              </Link>
            </div>
          </div>
        </form>
      </section>

      <section className="grid gap-4">
        {perfil ? (
          <p className="text-sm text-slate-600">
            Perfil: <strong>{perfil.nomeEmpresa}</strong> · Ordenação:{" "}
            {ORDENACOES[contexto.ordenacao]}.
          </p>
        ) : (
          <p className="text-sm text-slate-600">
            {perfis.length ? (
              "Selecione um perfil para calcular aderência."
            ) : (
              <Link
                href="/perfis/novo"
                className="font-semibold text-cyan-800 underline"
              >
                Criar perfil de empresa para calcular aderência
              </Link>
            )}
          </p>
        )}
        {params.erro ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">
            {params.erro}
          </div>
        ) : null}

        {resultados.length === 0 ? (
          <Card>
            <CardContent className="pt-5">
              <p className="text-sm text-slate-600">
                Nenhuma oportunidade encontrada para os filtros informados.
              </p>
            </CardContent>
          </Card>
        ) : null}

        {resultados.map(({ oportunidade, match }) => (
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
                {match ? <BadgeAderencia match={match} /> : null}
              </div>
            </CardHeader>
            <CardContent className="grid gap-4">
              {match ? <MotivosAderencia match={match} compacto /> : null}
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
                    href={montarDestino(
                      contexto,
                      `/oportunidades/${oportunidade.id}`,
                    )}
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
