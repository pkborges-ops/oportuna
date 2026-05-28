"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { appConfig } from "@/lib/app-config";
import { cn } from "@/lib/utils";

const navegacao = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/perfis", label: "Perfis" },
  { href: "/oportunidades", label: "Oportunidades" },
  { href: "/favoritos", label: "Favoritos" },
  { href: "/configuracoes", label: "Configurações" },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="border-b border-slate-200 bg-white lg:min-h-screen lg:border-b-0 lg:border-r">
      <div className="flex h-full flex-col gap-6 p-4 lg:p-5">
        <Link href="/dashboard" className="grid gap-1">
          <span className="text-lg font-semibold text-slate-950">
            {appConfig.name}
          </span>
          <span className="text-xs font-medium text-slate-500">
            {appConfig.description}
          </span>
        </Link>

        <nav className="flex gap-2 overflow-x-auto lg:grid lg:overflow-visible">
          {navegacao.map((item) => {
            const ativo =
              pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition",
                  ativo
                    ? "bg-slate-950 text-white"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto hidden rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 lg:block">
          <p className="font-semibold text-slate-950">Alertas ativos</p>
          <p className="mt-2 leading-6">
            12 buscas monitoradas com notificações por e-mail para novas
            oportunidades aderentes.
          </p>
        </div>
      </div>
    </aside>
  );
}
