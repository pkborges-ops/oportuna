import type { SituacaoOperacional } from "@/lib/oportunidades/ciclo-vida";

export function BadgeSituacao({ situacao }: { situacao: SituacaoOperacional }) {
  const texto = situacao === "ativa" ? "ATIVA"
    : situacao === "encerrada" ? "ENCERRADA" : "PRAZO A CONFIRMAR";
  const cor = situacao === "ativa" ? "bg-emerald-50 text-emerald-800"
    : situacao === "encerrada" ? "bg-slate-100 text-slate-700" : "bg-amber-50 text-amber-800";
  return <span className={`rounded-md px-3 py-1 text-xs font-semibold ${cor}`}>{texto}</span>;
}
