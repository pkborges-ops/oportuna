import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormularioIA } from "@/components/analises/formulario-ia";
import { ResultadoIA } from "@/components/analises/resultado-ia";
import { mensagensIA, nomeHistorico } from "@/lib/analises/apresentacao";
import type { FranquiaIA } from "@/services/franquia-ia-service";
import type { InterfaceIA } from "@/services/interface-ia-service";
import type { OpportunityAIAnalysis } from "@/types";

export function PainelIA({ franquia, interfaceIA, analise, indisponivel, perfilId, oportunidadeId, destino, feedback, action }: {
  franquia?: FranquiaIA; interfaceIA?: InterfaceIA & { atual: boolean; comparavel: boolean }; analise?: OpportunityAIAnalysis;
  indisponivel: boolean; perfilId?: string; oportunidadeId: string; destino: string; feedback?: string;
  action: (data: FormData) => Promise<void>;
}) {
  const estado = interfaceIA?.estado;
  const atual = interfaceIA?.atual;
  const desatualizada = Boolean(analise && interfaceIA?.comparavel && !atual);
  const semSnapshot = Boolean(analise && !interfaceIA?.comparavel && !atual);
  const bloqueio = indisponivel || !franquia || franquia.codigo !== "OK" || franquia.disponiveis <= 0 || Boolean(estado && estado !== "failed");
  const codigo = estado === "uncertain" ? "INCERTA" : estado && estado !== "failed" ? "EM_ANDAMENTO" :
    indisponivel ? "TEMPORARIO" : franquia?.codigo === "CICLO_NAO_AUTORIZADO" ? "CICLO_NAO_AUTORIZADO" :
    franquia && franquia.disponiveis <= 0 ? "LIMITE_ATINGIDO" : estado === "failed" ? "FALHOU" : feedback;
  const mensagem = codigo && Object.hasOwn(mensagensIA, codigo) ? mensagensIA[codigo] : undefined;
  const plano = franquia ? { FREE: "Free", PRO: "Pro", BUSINESS: "Business" }[franquia.plano] : undefined;
  return <Card className="min-w-0 self-start" >
    <CardHeader><CardTitle>Análise comercial com IA</CardTitle><CardDescription>
      Entenda a compatibilidade com sua empresa e o que conferir antes de preparar uma proposta.
      A avaliação usa os dados disponíveis; edital completo e anexos não foram analisados.
    </CardDescription></CardHeader>
    <CardContent className="grid min-w-0 gap-5">
      {franquia ? <section aria-label="Franquia de análises" className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="font-semibold text-slate-950">Plano {plano}</p>
        {franquia.codigo === "OK" ? <dl className="mt-3 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          {[["Limite", franquia.limite ?? "Não informado"], ["Consumidas", franquia.consumidas],
            ["Reservadas", franquia.reservadas], ["Disponíveis", franquia.disponiveis]].map(([label, value]) => <div key={label}>
            <dt className="text-slate-600">{label}</dt><dd className="mt-1 text-lg font-semibold text-slate-950">{value}</dd>
          </div>)}
        </dl> : <p className="mt-2 text-sm text-slate-700">Saldo indisponível enquanto o ciclo não estiver autorizado.</p>}
        {franquia.reservadas > 0 ? <p className="mt-3 text-sm text-slate-700">Reservas incluem análises em andamento ou aguardando verificação.</p> : null}
        {franquia.plano === "FREE" ? <p className="mt-3 text-sm text-slate-700">Uma análise de demonstração vitalícia, sem renovação mensal.</p> : null}
        {franquia.fim ? <p className="mt-3 text-sm text-slate-700">Fim do ciclo: {new Intl.DateTimeFormat("pt-BR", {
          dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo",
        }).format(new Date(franquia.fim))} (Brasília). Uma nova franquia depende da autorização do próximo período.</p> : null}
      </section> : <p className="text-sm text-slate-700">Franquia temporariamente indisponível.</p>}
      {mensagem ? <div role="status" aria-live="polite" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
        {estado && estado !== "uncertain" && estado !== "failed" ? <span aria-hidden="true" className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-amber-900 border-t-transparent motion-reduce:animate-none" /> : null}
        {mensagem}
      </div> : null}
      <a href={destino} className="w-fit rounded text-sm font-semibold text-cyan-800 underline focus-visible:outline-2 focus-visible:outline-offset-2">Consultar estado e saldo</a>
      {franquia?.plano === "FREE" && franquia.codigo === "OK" && franquia.disponiveis <= 0 ?
        <Link href="/planos" className="text-sm font-semibold text-cyan-800 underline">Conhecer os planos pagos</Link> : null}
      {!perfilId ? <p className="text-sm text-slate-700">Selecione um perfil acima ou <Link href="/perfis/novo" className="font-semibold text-cyan-800 underline">crie um perfil de empresa</Link> para analisar.</p> : <>
        {!analise ? <p className="text-sm text-slate-700">Nenhuma análise salva para este perfil. A geração é iniciada somente por você.</p> : null}
        {desatualizada ? <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-950">Esta análise foi gerada com informações anteriores. O resultado salvo continua disponível abaixo. Gerar uma análise atualizada consome uma unidade após conclusão e salvamento.</p> : null}
        {semSnapshot ? <p className="text-sm text-slate-600">Este histórico não possui snapshot suficiente para confirmar se os dados mudaram. A consulta é gratuita. Uma nova análise, se solicitada, consome uma unidade após conclusão e salvamento.</p> : null}
        {atual && analise ? <p className="text-sm text-emerald-800">Análise salva para estes dados. Reconsulta gratuita, sem nova geração.</p> :
          <FormularioIA key={`${analise?.id ?? "nova"}-${codigo ?? "pronta"}`} action={action} oportunidadeId={oportunidadeId} perfilId={perfilId} atualizar={Boolean(analise)} disabled={bloqueio} />}
      </>}
      {analise ? <ResultadoIA analise={analise} nomePerfil={nomeHistorico(interfaceIA?.resultado?.snapshot)} /> : null}
    </CardContent>
  </Card>;
}
