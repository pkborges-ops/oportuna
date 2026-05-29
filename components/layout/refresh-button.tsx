"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";

export function RefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function atualizar() {
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={atualizar}
      disabled={isPending}
      aria-label="Atualizar dados da tela"
      title="Atualizar dados da tela"
      className="gap-2"
    >
      <svg
        aria-hidden="true"
        className={isPending ? "h-4 w-4 animate-spin" : "h-4 w-4"}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 12a9 9 0 0 1-15.6 6.1" />
        <path d="M3 12A9 9 0 0 1 18.6 5.9" />
        <path d="M3 18v-6h6" />
        <path d="M21 6v6h-6" />
      </svg>
      <span className="hidden sm:inline">Atualizar</span>
    </Button>
  );
}
