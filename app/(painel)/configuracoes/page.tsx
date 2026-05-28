import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  dispararTesteAlerta,
  salvarAlertaPerfil,
} from "@/app/(painel)/configuracoes/actions";
import { listarConfiguracoesAlertas } from "@/services/alertas-service";
import type { AlertLastStatus, ProfileAlert } from "@/types";

type ConfiguracoesPageProps = {
  searchParams: Promise<{
    erro?: string;
    mensagem?: string;
  }>;
};

const statusLabels: Record<AlertLastStatus, string> = {
  nunca_executado: "Nunca executado",
  simulado: "Simulado",
  enviado: "Enviado",
  sem_oportunidades: "Sem oportunidades novas",
  erro: "Erro",
};

function formatarDataHora(data?: string) {
  if (!data) {
    return "Nunca";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(data));
}

function formatarDataRelativa(data?: string) {
  if (!data) {
    return "Nunca executado";
  }

  const diferencaMs = new Date(data).getTime() - Date.now();
  const minutos = Math.round(diferencaMs / 60000);
  const absMinutos = Math.abs(minutos);
  const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

  if (absMinutos < 60) {
    return rtf.format(minutos, "minute");
  }

  const horas = Math.round(minutos / 60);
  const absHoras = Math.abs(horas);

  if (absHoras < 24) {
    return rtf.format(horas, "hour");
  }

  return rtf.format(Math.round(horas / 24), "day");
}

function calcularProximaExecucao(alerta: ProfileAlert) {
  if (!alerta.ativo) {
    return undefined;
  }

  if (!alerta.ultimaExecucaoEm) {
    return new Date().toISOString();
  }

  const ultima = new Date(alerta.ultimaExecucaoEm);
  const horas = alerta.frequencia === "semanal" ? 24 * 7 : 24;
  return new Date(ultima.getTime() + horas * 60 * 60 * 1000).toISOString();
}

function obterStatusVisual(alerta: ProfileAlert) {
  if (!alerta.ativo) {
    return {
      label: "Inativo",
      description: "Ative para entrar na próxima rotina de monitoramento.",
      className: "bg-slate-100 text-slate-700",
    };
  }

  if (alerta.ultimoStatus === "erro") {
    return {
      label: "Com erro",
      description: "A última execução falhou. Revise a mensagem abaixo.",
      className: "bg-red-100 text-red-800",
    };
  }

  if (!alerta.ultimaExecucaoEm) {
    return {
      label: "Aguardando primeira execução",
      description: "Será processado no próximo ciclo automático ou teste manual.",
      className: "bg-amber-100 text-amber-800",
    };
  }

  const ultima = new Date(alerta.ultimaExecucaoEm).getTime();
  const horasDesdeUltima = (Date.now() - ultima) / (1000 * 60 * 60);

  if (horasDesdeUltima <= 2) {
    return {
      label: "Executado recentemente",
      description: "Monitoramento atualizado há pouco.",
      className: "bg-emerald-100 text-emerald-800",
    };
  }

  return {
    label: "Aguardando próxima execução",
    description: "O alerta será processado conforme a frequência configurada.",
    className: "bg-cyan-100 text-cyan-900",
  };
}

function obterMensagemResultado(alerta: ProfileAlert) {
  if (alerta.ultimoStatus === "erro" && alerta.ultimoErro) {
    return alerta.ultimoErro;
  }

  if (!alerta.ultimaExecucaoEm) {
    return "Nenhum processamento realizado ainda.";
  }

  if (alerta.ultimaQuantidadeConsiderada === 0) {
    return "Nenhuma oportunidade elegível foi encontrada no último processamento.";
  }

  if (alerta.ultimaQuantidadeEnviada === 0) {
    return "As oportunidades encontradas já tinham sido enviadas anteriormente.";
  }

  return `${alerta.ultimaQuantidadeEnviada} alerta(s) enviado(s) no último processamento.`;
}

export default async function ConfiguracoesPage({
  searchParams,
}: ConfiguracoesPageProps) {
  const [{ erro, mensagem }, configuracoes] = await Promise.all([
    searchParams,
    listarConfiguracoesAlertas(),
  ]);

  return (
    <div className="grid gap-6">
      <section>
        <h2 className="text-2xl font-semibold text-slate-950">
          Configurações
        </h2>
        <p className="mt-1 text-slate-600">
          Ajustes iniciais de conta, alertas por e-mail e preferências de IA.
        </p>
      </section>

      {erro ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">
          {erro}
        </div>
      ) : null}
      {mensagem ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">
          {mensagem}
        </div>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Conta</CardTitle>
            <CardDescription>
              Dados do usuario responsavel pelo acompanhamento dos editais.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4">
              <Input label="Nome" name="nome" defaultValue="Marina Costa" />
              <Input
                label="E-mail"
                name="email"
                defaultValue={configuracoes.emailUsuario}
              />
              <Button type="submit">Salvar alteracoes</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Alertas</CardTitle>
            <CardDescription>
              Frequência e critério mínimo para notificações por e-mail.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            {configuracoes.perfis.length === 0 ? (
              <div className="rounded-md bg-slate-50 p-4 text-sm text-slate-600">
                Cadastre um perfil de empresa para configurar alertas.
              </div>
            ) : null}

            {configuracoes.perfis.map(({ perfil, alerta }) => {
              const statusVisual = obterStatusVisual(alerta);
              const proximaExecucao = calcularProximaExecucao(alerta);

              return (
                <form
                  key={perfil.id}
                  action={salvarAlertaPerfil}
                  className="grid gap-5 rounded-md border border-slate-200 p-4"
                >
                  <input type="hidden" name="perfilId" value={perfil.id} />
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="font-semibold text-slate-950">
                        {perfil.nomeEmpresa}
                      </h3>
                      <p className="mt-1 text-sm text-slate-500">
                        {perfil.segmento} - {perfil.uf}
                      </p>
                    </div>
                    <span
                      className={`w-fit rounded-md px-3 py-1 text-xs font-bold ${statusVisual.className}`}
                    >
                      {statusVisual.label}
                    </span>
                  </div>

                  <div className="rounded-md bg-slate-50 p-4">
                    <p className="text-sm font-medium text-slate-950">
                      {statusVisual.description}
                    </p>
                    <p className="mt-2 text-sm text-slate-600">
                      {obterMensagemResultado(alerta)}
                    </p>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input
                      label="E-mail de alerta"
                      name="emailDestino"
                      type="email"
                      defaultValue={alerta.emailDestino}
                      required
                    />
                    <Input
                      label="Score minimo"
                      name="scoreMinimo"
                      type="number"
                      min={0}
                      max={100}
                      defaultValue={alerta.scoreMinimo}
                      required
                    />
                    <label className="grid gap-2 text-sm font-medium text-slate-700">
                      <span>Frequência</span>
                      <select
                        name="frequencia"
                        defaultValue={alerta.frequencia}
                        className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                      >
                        <option value="diaria">Diária</option>
                        <option value="semanal">Semanal</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-2 pt-7 text-sm font-medium text-slate-700">
                      <input
                        type="checkbox"
                        name="ativo"
                        defaultChecked={alerta.ativo}
                        className="h-4 w-4 rounded border-slate-300 text-cyan-600"
                      />
                      Enviar alertas para este perfil
                    </label>
                  </div>

                  <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-md border border-slate-200 bg-white p-3">
                      <p className="text-slate-500">Última execução</p>
                      <p className="mt-1 font-semibold text-slate-950">
                        {formatarDataRelativa(alerta.ultimaExecucaoEm)}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {formatarDataHora(alerta.ultimaExecucaoEm)}
                      </p>
                    </div>
                    <div className="rounded-md border border-slate-200 bg-white p-3">
                      <p className="text-slate-500">Próxima execução</p>
                      <p className="mt-1 font-semibold text-slate-950">
                        {proximaExecucao
                          ? formatarDataRelativa(proximaExecucao)
                          : "Sem agendamento"}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {proximaExecucao
                          ? formatarDataHora(proximaExecucao)
                          : "Alerta inativo"}
                      </p>
                    </div>
                    <div className="rounded-md border border-slate-200 bg-white p-3">
                      <p className="text-slate-500">Consideradas</p>
                      <p className="mt-1 text-2xl font-semibold text-slate-950">
                        {alerta.ultimaQuantidadeConsiderada}
                      </p>
                    </div>
                    <div className="rounded-md border border-slate-200 bg-white p-3">
                      <p className="text-slate-500">Enviadas</p>
                      <p className="mt-1 text-2xl font-semibold text-cyan-900">
                        {alerta.ultimaQuantidadeEnviada}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Button type="submit">Atualizar alertas</Button>
                    <Button
                      type="submit"
                      variant="secondary"
                      formAction={dispararTesteAlerta}
                    >
                      Disparar teste
                    </Button>
                  </div>
                </form>
              );
            })}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Histórico de envios</CardTitle>
          <CardDescription>
            Últimas oportunidades registradas pelos alertas de e-mail.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {configuracoes.historico.length === 0 ? (
            <div className="rounded-md bg-slate-50 p-4 text-sm text-slate-600">
              Nenhum envio registrado ainda.
            </div>
          ) : (
            <div className="grid gap-3">
              {configuracoes.historico.map((envio) => (
                <div
                  key={envio.id}
                  className="grid gap-2 rounded-md border border-slate-200 p-3 text-sm sm:grid-cols-[1fr_auto_auto]"
                >
                  <div>
                    <p className="font-medium text-slate-950">
                      {envio.tituloOportunidade}
                    </p>
                    <p className="mt-1 text-slate-500">
                      {formatarDataHora(envio.enviadoEm)}
                    </p>
                    {envio.detalhes ? (
                      <p className="mt-1 text-xs text-slate-500">
                        {envio.detalhes}
                      </p>
                    ) : null}
                  </div>
                  <span className="font-semibold text-cyan-900">
                    {envio.score}% match
                  </span>
                  <span className="text-slate-600">
                    {statusLabels[envio.status]}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
