import {
  ORDENACOES,
  resolverOrdenacao,
} from "@/lib/matching/ordenar-oportunidades";
import Link from "next/link";

import { alternarFavorito, desbloquearScore } from "@/app/(painel)/oportunidades/actions";
import { UpgradePrompt } from "@/components/planos/upgrade-prompt";
import { Button, buttonClassName } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { VISOES } from "@/lib/oportunidades/ciclo-vida";
import { BadgeSituacao } from "@/components/oportunidades/situacao";
import { formatarData, formatarMoeda, formatarStatus } from "@/lib/formatters";
import { listarOportunidadesPaginadas } from "@/services/oportunidades-service";
import { listarPerfis } from "@/services/perfis-service";
import { obterPlanoAtual } from "@/services/planos-service";
import {
  BadgeAderencia,
  MotivosAderencia,
} from "@/components/oportunidades/aderencia";
import {
  destinoLimparFiltros,
  lerContexto,
  montarDestino,
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
  const [perfis, plano] = await Promise.all([listarPerfis(), obterPlanoAtual()]);
  const perfil = selecionarPerfil(perfis, params.perfilId);
  const contexto = {
    ...params,
    perfilId: perfil?.id ?? "",
    aderencia: perfil ? params.aderencia : undefined,
    ordenacao: resolverOrdenacao(params.ordenacao ?? (params.visao === "historico" ? "mais_novas" : undefined), Boolean(perfil)),
  };
  const paginacao = await listarOportunidadesPaginadas(contexto);
  const resultados = paginacao.itens;
  const destino = montarDestino(contexto);

  return (
    <div className="grid gap-6">
      <section className="grid gap-6">
        <div>
          <h2 className="text-2xl font-semibold text-slate-950">
            {params.visao === "historico" ? "Histórico de oportunidades" : "Oportunidades"}
          </h2>
          <p className="mt-1 text-slate-600">
            {params.visao === "historico"
              ? "Processos com prazo de participação vencido ou status encerrado."
              : params.visao === "todas"
                ? "Base completa, incluindo oportunidades ativas e histórico."
                : "Oportunidades com prazo vigente ou a confirmar. Confira as condições no edital."}
          </p>
        </div>
        <nav aria-label="Visão das oportunidades" className="flex flex-wrap gap-2">
          {Object.entries(VISOES).map(([visao, titulo]) => (
            <Link key={visao} aria-current={params.visao === visao ? "page" : undefined}
              href={montarDestino({ ...contexto, visao: visao as keyof typeof VISOES, pagina: 1,
                ordenacao: params.ordenacao })}
              className={buttonClassName({ variant: params.visao === visao ? "primary" : "secondary" })}>
              {titulo}
            </Link>
          ))}
        </nav>
        {plano.codigo === "FREE" && params.visao !== "ativas" ? (
          <UpgradePrompt titulo="Histórico limitado no Free"
            descricao="Você pode consultar oportunidades históricas dos últimos 30 dias."
            recurso="historico" />
        ) : null}
        <form action="/oportunidades" className="grid gap-5">
          <input type="hidden" name="visao" value={params.visao} />
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
        {plano.codigo === "FREE" && params.erro?.includes("favoritos") ? (
          <UpgradePrompt titulo="Limite de favoritos" descricao="Seu plano Free permite 5 favoritos."
            recurso="favoritos" />
        ) : null}
        {plano.codigo === "FREE" && params.erro?.includes("scores") ? (
          <UpgradePrompt titulo="Limite diário de scores" descricao="Você pode desbloquear 3 novos scores por dia."
            recurso="matching" />
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
                <BadgeSituacao situacao={oportunidade.situacaoOperacional ?? "indeterminada"} />
                <span className="rounded-md bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
                  {formatarStatus(oportunidade.status)}
                </span>
                {match ? <BadgeAderencia match={match} /> : null}
              </div>
            </CardHeader>
            <CardContent className="grid gap-4">
              {match ? <MotivosAderencia match={match} compacto /> : null}
              {perfil && !match ? <form action={desbloquearScore} className="flex flex-wrap items-center gap-3">
                <input type="hidden" name="perfilId" value={perfil.id} />
                <input type="hidden" name="oportunidadeId" value={oportunidade.id} />
                <input type="hidden" name="redirectTo" value={destino} />
                <Button type="submit" variant="secondary">Desbloquear score</Button>
                <span className="text-xs text-slate-500">Até 3 novos scores por dia no Free.</span>
              </form> : null}
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
                    {oportunidade.dataPublicacao ? formatarData(oportunidade.dataPublicacao) : "Não informada"}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Abertura</p>
                  <p className="font-medium text-slate-950">
                    {oportunidade.dataAbertura ? formatarData(oportunidade.dataAbertura) : "Não informada"}
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
        <nav aria-label="Paginação de oportunidades" className="flex items-center justify-between gap-3">
          {paginacao.temAnterior ? (
            <Link href={montarDestino({ ...contexto, pagina: paginacao.pagina - 1 })}
              className={buttonClassName({ variant: "secondary" })}>Anterior</Link>
          ) : (
            <Button variant="secondary" disabled>Anterior</Button>
          )}
          <span className="text-sm text-slate-600">Página {paginacao.pagina}</span>
          {paginacao.temProxima ? (
            <Link href={montarDestino({ ...contexto, pagina: paginacao.pagina + 1 })}
              className={buttonClassName({ variant: "secondary" })}>Próxima</Link>
          ) : (
            <Button variant="secondary" disabled>Próxima</Button>
          )}
        </nav>
      </section>
    </div>
  );
}
