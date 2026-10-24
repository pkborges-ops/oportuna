"use client";
import { useFormStatus } from "react-dom";
import { useRef } from "react";
import { Button } from "@/components/ui/button";

function Enviar({ atualizar, disabled }: { atualizar: boolean; disabled: boolean }) {
  const { pending } = useFormStatus();
  return <div className="grid gap-3" aria-busy={pending}>
    <Button type="submit" disabled={disabled || pending} className="h-auto min-h-10 w-full whitespace-normal py-2 sm:w-fit">
      {pending ? <span aria-hidden="true" className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-slate-950 border-t-transparent motion-reduce:animate-none" /> : null}
      {pending ? "Análise em processamento" : atualizar ? "Gerar análise atualizada" : "Analisar oportunidade"}
    </Button>
    <p role="status" aria-live="polite" className="text-sm text-slate-700">
      {pending ? "Estamos analisando os dados disponíveis" : "Uma unidade será consumida somente após a análise ser concluída e salva"}
    </p>
  </div>;
}
export function FormularioIA({ action, oportunidadeId, perfilId, atualizar, disabled }: {
  action: (data: FormData) => Promise<void>; oportunidadeId: string; perfilId: string;
  atualizar: boolean; disabled: boolean;
}) {
  const enviando = useRef(false);
  return <form action={async data => {
    try { await action(data); } finally { enviando.current = false; }
  }} onSubmit={event => {
    if (disabled || enviando.current) event.preventDefault();
    else enviando.current = true;
  }}>
    <input type="hidden" name="oportunidadeId" value={oportunidadeId} />
    <input type="hidden" name="perfilId" value={perfilId} />
    <input type="hidden" name="atualizar" value={String(atualizar)} />
    <Enviar atualizar={atualizar} disabled={disabled} />
  </form>;
}
