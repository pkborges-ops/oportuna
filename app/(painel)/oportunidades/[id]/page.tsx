import Link from "next/link";
import { notFound } from "next/navigation";

import {
  alternarFavorito,
  analisarOportunidade,
} from "@/app/(painel)/oportunidades/actions";
import { Button, buttonClassName } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatarData, formatarMoeda, formatarStatus } from "@/lib/formatters";
import { obterApresentacaoOrigem } from "@/lib/oportunidades/apresentacao-origem";
import { buscarAnalisePorPerfil } from "@/services/analises-service";
import { buscarOportunidadePorId } from "@/services/oportunidades-service";
import { listarPerfis } from "@/services/perfis-service";
import { calcularMatch } from "@/lib/matching/calcular-match";
import {
  lerContexto,
  montarDestino,
  selecionarPerfil,
  type QueryOportunidades,
} from "@/lib/matching/contexto";
import {
  BadgeAderencia,
  MotivosAderencia,
} from "@/components/oportunidades/aderencia";
import type { OpportunityParticipation } from "@/types";

const mensagemParticipacaoNaoIdentificada =
  "Local de participação não identificado automaticamente. Consulte o edital e os anexos para confirmar onde enviar a proposta ou realizar o credenciamento.";

function formatarDataHora(data?: string) {
  if (!data) {
    return "";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(data));
}

function obterStatusPrazo(data?: string) {
  if (!data) {
    return null;
  }

  const prazo = new Date(data).getTime();
  const agora = Date.now();
  const dias = Math.ceil((prazo - agora) / (1000 * 60 * 60 * 24));

  if (dias < 0) {
    return {
      label: "Prazo encerrado",
      className: "bg-red-100 text-red-800",
    };
  }

  if (dias <= 3) {
    return {
      label: "Prazo próximo",
      className: "bg-amber-100 text-amber-800",
    };
  }

  return {
    label: "Prazo aberto",
    className: "bg-emerald-100 text-emerald-800",
  };
}

function temDadosParticipacao(participacao?: OpportunityParticipation) {
  return Boolean(
    participacao?.portal ||
    participacao?.url ||
    participacao?.forma ||
    participacao?.prazoLimite ||
    participacao?.observacoes,
  );
}

function ComoParticipar({
  participacao,
}: {
  participacao?: OpportunityParticipation;
}) {
  const temDados = temDadosParticipacao(participacao);
  const statusPrazo = obterStatusPrazo(participacao?.prazoLimite);

  return (
    <Card className="border-cyan-200 bg-cyan-50/60">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Como participar</CardTitle>
            <CardDescription>
              Próximo passo prático para enviar a proposta ou fazer o
              credenciamento.
            </CardDescription>
          </div>
          {statusPrazo ? (
            <span
              className={`w-fit rounded-md px-3 py-1 text-sm font-bold ${statusPrazo.className}`}
            >
              {statusPrazo.label}
            </span>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-5">
        {temDados ? (
          <>
            <div className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <p className="text-slate-500">Portal</p>
                <p className="font-semibold text-slate-950">
                  {participacao?.portal ?? "Não informado"}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Forma de participação</p>
                <p className="font-semibold text-slate-950">
                  {participacao?.forma ?? "Não informado"}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Prazo limite</p>
                <p className="font-semibold text-slate-950">
                  {participacao?.prazoLimite
                    ? formatarDataHora(participacao.prazoLimite)
                    : "Não informado"}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Link para participação</p>
                <p className="break-all font-semibold text-slate-950">
                  {participacao?.url ?? "Não informado"}
                </p>
              </div>
            </div>
            {participacao?.observacoes ? (
              <div className="rounded-md bg-white/80 p-4 text-sm leading-6 text-slate-700">
                <p className="font-semibold text-slate-950">Observações</p>
                <p className="mt-2">{participacao.observacoes}</p>
              </div>
            ) : null}
            {participacao?.url ? (
              <a
                href={participacao.url}
                target="_blank"
                rel="noreferrer"
                className={buttonClassName({
                  size: "lg",
                  className: "w-full shadow-md shadow-cyan-950/20 sm:w-fit",
                })}
              >
                Acessar participação
              </a>
            ) : null}
          </>
        ) : (
          <div className="rounded-md border border-cyan-200 bg-white p-4 text-sm font-medium leading-6 text-slate-700">
            {mensagemParticipacaoNaoIdentificada}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default async function DetalheOportunidadePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<QueryOportunidades>;
}) {
  const [{ id }, rawQuery] = await Promise.all([params, searchParams]);
  const query = lerContexto(rawQuery);
  const oportunidade = await buscarOportunidadePorId(id);

  if (!oportunidade) {
    notFound();
  }

  const origem = obterApresentacaoOrigem(oportunidade);
  const perfis = await listarPerfis();
  const perfilSelecionado = selecionarPerfil(perfis, query.perfilId);
  const contexto = {
    ...query,
    perfilId: perfilSelecionado?.id ?? "",
    aderencia: perfilSelecionado ? query.aderencia : undefined,
  };
  const destino = montarDestino(contexto, `/oportunidades/${oportunidade.id}`);
  const match = perfilSelecionado
    ? calcularMatch({ perfil: perfilSelecionado, oportunidade })
    : undefined;
  const analise = perfilSelecionado
    ? await buscarAnalisePorPerfil(oportunidade.id, perfilSelecionado.id)
    : undefined;

  return (
    <div className="grid gap-6">
      <section className="grid gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-md bg-slate-200 px-3 py-1 text-sm font-semibold text-slate-700">
              {formatarStatus(oportunidade.status)}
            </span>
            {oportunidade.favorito ? (
              <span className="rounded-md bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-800">
                Favorito
              </span>
            ) : null}
          </div>
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
        </div>
        <h2 className="text-2xl font-semibold text-slate-950">
          {oportunidade.titulo}
        </h2>
        <p className="max-w-4xl leading-7 text-slate-600">
          {oportunidade.objeto}
        </p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Aderência ao perfil</CardTitle>
          <CardDescription>
            Cálculo determinístico por perfil. A análise por IA é opcional e
            manual.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {perfis.length > 0 ? (
            <form
              action={`/oportunidades/${oportunidade.id}`}
              className="grid gap-3 sm:grid-cols-[1fr_auto]"
            >
              {(["busca", "status", "uf", "aderencia"] as const).map((chave) => (
                <input
                  key={chave}
                  type="hidden"
                  name={chave}
                  value={contexto[chave] ?? ""}
                />
              ))}
              <label className="grid gap-2 text-sm font-medium text-slate-700">
                <span>Perfil da empresa</span>
                <select
                  name="perfilId"
                  defaultValue={perfilSelecionado?.id ?? ""}
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950"
                >
                  <option value="">Selecione um perfil</option>
                  {perfis.map((perfil) => (
                    <option key={perfil.id} value={perfil.id}>
                      {perfil.nomeEmpresa}
                      {perfil.status === "inativo" ? " (inativo)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" variant="secondary" className="self-end">
                Usar perfil
              </Button>
            </form>
          ) : (
            <Link
              href="/perfis/novo"
              className="text-sm font-semibold text-cyan-800 underline"
            >
              Criar perfil de empresa
            </Link>
          )}
          {match ? (
            <>
              <BadgeAderencia match={match} />
              <MotivosAderencia match={match} />
              <p className="text-sm text-slate-600">
                Termos do segmento encontrados:{" "}
                {match.termosSegmentoEncontrados.join(", ") || "Nenhum"}.
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-600">
              Selecione um perfil para calcular aderência.
            </p>
          )}
          <Link
            href={montarDestino(contexto)}
            className="text-sm font-semibold text-cyan-800 underline"
          >
            Voltar às oportunidades
          </Link>
        </CardContent>
      </Card>

      <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Dados da oportunidade</CardTitle>
              <CardDescription>
                Informacoes principais para qualificacao comercial.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-slate-500">Orgao</p>
                  <p className="font-medium text-slate-950">
                    {oportunidade.orgao}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Local</p>
                  <p className="font-medium text-slate-950">
                    {oportunidade.cidade}/{oportunidade.uf}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Modalidade</p>
                  <p className="font-medium text-slate-950">
                    {oportunidade.modalidade}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Valor estimado</p>
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
                {origem?.campos.map((campo) => (
                  <div key={campo.label}>
                    <p className="text-slate-500">{campo.label}</p>
                    <p className="break-all font-medium text-slate-950">
                      {campo.valor}
                    </p>
                  </div>
                ))}
              </div>
              {origem ? (
                <a
                  href={origem.link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonClassName({ className: "w-full sm:w-fit" })}
                >
                  {origem.link.label}
                </a>
              ) : null}
              <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
                {oportunidade.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>

          <ComoParticipar participacao={oportunidade.participacao} />
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>Analise por IA</CardTitle>
                <CardDescription>
                  Análise aprofundada, gerada manualmente para o perfil
                  selecionado.
                </CardDescription>
              </div>
              {analise ? (
                <span className="w-fit rounded-md bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-800">
                  {analise.score}% · análise por IA
                </span>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="grid gap-5">
            {query.erro ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">
                {query.erro}
              </div>
            ) : null}
            {query.mensagem ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">
                {query.mensagem}
              </div>
            ) : null}

            {perfilSelecionado ? (
              <form action={analisarOportunidade}>
                <input
                  type="hidden"
                  name="oportunidadeId"
                  value={oportunidade.id}
                />
                <input
                  type="hidden"
                  name="perfilId"
                  value={perfilSelecionado.id}
                />
                <Button type="submit" disabled={Boolean(analise)}>
                  {analise ? "Análise já gerada" : "Analisar oportunidade"}
                </Button>
              </form>
            ) : null}

            {analise ? (
              <>
                <div className="rounded-lg bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                  <p className="font-semibold text-slate-950">Resumo</p>
                  <p className="mt-2">{analise.resumo}</p>
                </div>
                <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-4 text-sm leading-6 text-cyan-950">
                  <span className="font-semibold">Justificativa: </span>
                  {analise.justificativa}
                </div>
                <div>
                  <h3 className="font-semibold text-slate-950">
                    Pontos de atenção
                  </h3>
                  <ul className="mt-3 grid gap-2 text-sm text-slate-600">
                    {analise.pontosAtencao.map((item) => (
                      <li key={item} className="rounded-md bg-amber-50 p-3">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="text-sm text-slate-500">
                  Perfil usado na análise:{" "}
                  <span className="font-semibold text-slate-950">
                    {perfilSelecionado?.nomeEmpresa}
                  </span>
                </p>
              </>
            ) : perfilSelecionado ? (
              <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
                Nenhuma análise gerada para este perfil ainda.
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
