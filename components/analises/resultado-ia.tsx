import type { OpportunityAIAnalysis } from "@/types";

export function ResultadoIA({ analise, nomePerfil }: { analise: OpportunityAIAnalysis; nomePerfil?: string }) {
  return <article className="min-w-0 space-y-5 break-words text-sm leading-7 text-slate-700" aria-label="Resultado da análise">
    <div className="border-b border-slate-200 pb-3 text-sm text-slate-600">
      <p>Concluída em <time dateTime={analise.criadoEm}>{new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo",
      }).format(new Date(analise.criadoEm))}</time> (horário de Brasília)</p>
      <p>{nomePerfil ? `Perfil na data da análise: ${nomePerfil}` : "Nome do perfil na data da análise não registrado."}</p>
      {analise.versaoSchema === 1 ? <p>Resultado histórico: preservado no formato original.</p> : null}
    </div>
    <section className="rounded-lg bg-slate-50 p-4">
      <h3 className="font-semibold text-slate-950">Resumo</h3><p className="mt-2 whitespace-pre-line">{analise.resumo}</p>
    </section>
    <section className="rounded-lg border border-cyan-200 bg-cyan-50 p-4 text-cyan-950">
      <h3 className="font-semibold">{analise.versaoSchema === 2 ? "Compatibilidade com a empresa" : "Justificativa histórica"}</h3>
      <p className="mt-2 whitespace-pre-line">{analise.versaoSchema === 2 ? analise.conteudo.compatibilidade_empresa : analise.justificativa}</p>
    </section>
    <section>
      <h3 className="font-semibold text-slate-950">Pontos de atenção</h3>
      <ul className="mt-3 grid gap-3">
        {analise.versaoSchema === 2 ? analise.conteudo.pontos_atencao.map((item, index) => <li key={index} className="rounded-lg border border-slate-200 p-4">
          <span className={`inline-block rounded px-2 py-1 text-xs font-semibold ${item.classificacao === "fato_identificado" ? "bg-slate-100 text-slate-800" : "bg-amber-50 text-amber-900"}`}>
            {item.classificacao === "fato_identificado" ? "Fato identificado" : "Informação a confirmar"}</span>
          <h4 className="mt-2 font-semibold text-slate-950">{item.titulo}</h4>
          <p>{item.explicacao}</p><p className="mt-2"><strong>Ação recomendada:</strong> {item.acao_recomendada}</p>
        </li>) : analise.pontosAtencao.map((item, index) => <li key={index} className="rounded-lg bg-amber-50 p-4 text-amber-950">{item}</li>)}
      </ul>
      {(analise.versaoSchema === 2 ? analise.conteudo.pontos_atencao : analise.pontosAtencao).length === 0 ? <p>Nenhum ponto adicional registrado.</p> : null}
    </section>
    {analise.versaoSchema === 2 ? <>
      <section><h3 className="font-semibold text-slate-950">Informações não verificadas</h3>
        <ul className="mt-2 list-disc space-y-2 pl-5">{analise.conteudo.informacoes_nao_verificadas.map((item, index) => <li key={index}>{item}</li>)}</ul>
        {!analise.conteudo.informacoes_nao_verificadas.length ? <p>Nenhuma lacuna adicional destacada nesta análise.</p> : null}
      </section>
      <section className="rounded-lg bg-cyan-50 p-4 text-cyan-950"><h3 className="font-semibold">Próximo passo recomendado</h3><p className="mt-2">{analise.conteudo.proximo_passo}</p></section>
    </> : null}
    <p className="border-t border-slate-200 pt-4">O edital completo e os anexos não foram analisados. Esta análise não comprova habilitação nem capacidade de execução.</p>
  </article>;
}
