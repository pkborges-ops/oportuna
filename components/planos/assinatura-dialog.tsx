"use client";

import { useRef, useState } from "react";

type Props = {
  planCode: "PRO" | "BUSINESS"; planName: string; priceLabel: string;
  nomeInicial: string; emailInicial: string; reutilizar: boolean;
};

export function AssinaturaDialog({ planCode, planName, priceLabel,
  nomeInicial, emailInicial, reutilizar }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const enviando = useRef(false);
  const [submetendo, setSubmetendo] = useState(false);
  const prefixo = `pagador-${planCode.toLowerCase()}`;
  const campo = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-950 focus:border-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-100";
  return <>
    <button type="button" onClick={() => dialog.current?.showModal()}
      className="w-full rounded-lg bg-cyan-700 px-4 py-3 font-semibold text-white hover:bg-cyan-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-700">
      {reutilizar ? "Continuar pagamento" : `Assinar ${planName}`}
    </button>
    <dialog ref={dialog} aria-labelledby={`${prefixo}-titulo`} aria-describedby={`${prefixo}-seguro`}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl backdrop:bg-slate-950/50"
      onCancel={(event) => { if (enviando.current) event.preventDefault(); }}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id={`${prefixo}-titulo`} className="text-xl font-semibold text-slate-950">Assinar {planName}</h2>
          <p className="mt-1 font-medium text-cyan-800">{priceLabel} / mês</p>
        </div>
        <button type="button" aria-label="Fechar dados do pagador" disabled={submetendo}
          onClick={() => dialog.current?.close()}
          className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 disabled:opacity-50">✕</button>
      </div>
      <form action="/api/billing/checkout" method="post" className="mt-5 grid gap-4"
        onSubmit={(event) => {
          if (enviando.current) { event.preventDefault(); return; }
          enviando.current = true;
          setSubmetendo(true);
        }}>
        <input type="hidden" name="plan" value={planCode} />
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">Nome do pagador
          <input name="nomePagador" required minLength={3} maxLength={120} defaultValue={nomeInicial}
            className={campo} autoComplete="name" autoFocus />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">CPF/CNPJ
          <input name="documentoPagador" required maxLength={18} inputMode="numeric" className={campo} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">E-mail
            <input name="emailPagador" type="email" required maxLength={254} defaultValue={emailInicial}
              className={campo} autoComplete="email" />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">Celular
            <input name="celularPagador" type="tel" required maxLength={20} className={campo}
              autoComplete="tel" placeholder="(11) 99999-9999" />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">CEP
            <input name="cepPagador" required maxLength={9} inputMode="numeric" className={campo}
              autoComplete="postal-code" placeholder="00000-000" />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">Número
            <input name="numeroPagador" required maxLength={20} className={campo} placeholder="Número ou s/n" />
          </label>
        </div>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">Complemento <span className="font-normal text-slate-500">Opcional</span>
          <input name="complementoPagador" maxLength={255} className={campo} autoComplete="address-line2" />
        </label>
        <button type="submit" disabled={submetendo}
          className="rounded-lg bg-cyan-700 px-4 py-3 font-semibold text-white hover:bg-cyan-800 disabled:opacity-60">
          {submetendo ? "Preparando pagamento…" : "Continuar para pagamento"}
        </button>
        <p id={`${prefixo}-seguro`} className="text-center text-xs leading-5 text-slate-500">
          Checkout seguro pelo Asaas. Os dados do cartão são informados somente no checkout hospedado.
        </p>
      </form>
    </dialog>
  </>;
}
