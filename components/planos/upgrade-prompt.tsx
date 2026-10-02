"use client";

import Link from "next/link";
import { useEffect } from "react";

import { buttonClassName } from "@/components/ui/button";

function registrar(evento: "clicou_upgrade" | "viu_planos") {
  const body = JSON.stringify({ evento });
  if (!navigator.sendBeacon?.("/api/eventos-plano", new Blob([body], { type: "application/json" }))) {
    void fetch("/api/eventos-plano", {
      method: "POST", headers: { "content-type": "application/json" }, body,
      keepalive: true,
    });
  }
}

export function UpgradePrompt({ titulo, descricao, recurso }: {
  titulo: string;
  descricao: string;
  recurso: string;
}) {
  return (
    <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-4 text-sm text-cyan-950">
      <p className="font-semibold">{titulo}</p>
      <p className="mt-1">{descricao}</p>
      <Link href={`/planos?recurso=${encodeURIComponent(recurso)}`}
        onClick={() => registrar("clicou_upgrade")}
        className={buttonClassName({ variant: "secondary", className: "mt-3" })}>
        Conhecer o Pro
      </Link>
    </div>
  );
}

export function PlanViewEvent() {
  useEffect(() => registrar("viu_planos"), []);
  return null;
}
