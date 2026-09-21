import type { OpportunityMatch } from "@/lib/matching/calcular-match";

const niveis = { alta: "Alta", media: "Média", baixa: "Baixa" };
const cores = {
  alta: "bg-emerald-100 text-emerald-900",
  media: "bg-amber-100 text-amber-900",
  baixa: "bg-slate-100 text-slate-700",
};

export function BadgeAderencia({ match }: { match: OpportunityMatch }) {
  return (
    <span
      className={`w-fit rounded-md px-3 py-1 text-sm font-bold ${cores[match.nivel]}`}
    >
      {match.score}% aderência · {niveis[match.nivel]}
    </span>
  );
}

export function MotivosAderencia({
  match,
  compacto = false,
}: {
  match: OpportunityMatch;
  compacto?: boolean;
}) {
  return (
    <ul
      className="grid gap-1 text-sm text-slate-600"
      aria-label="Motivos da aderência"
    >
      {(compacto ? match.motivos.slice(0, 2) : match.motivos).map((motivo) => (
        <li key={motivo}>{motivo}</li>
      ))}
    </ul>
  );
}
