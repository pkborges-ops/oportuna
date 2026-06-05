import { redirect } from "next/navigation";

import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { criarClienteSupabaseServer } from "@/lib/supabase/server";

export default async function PainelLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await criarClienteSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (!claims) {
    redirect("/login");
  }

  const metadata =
    claims.user_metadata && typeof claims.user_metadata === "object"
      ? claims.user_metadata
      : {};
  const nomeUsuario =
    typeof metadata.nome === "string"
      ? metadata.nome
      : typeof metadata.name === "string"
        ? metadata.name
        : typeof metadata.full_name === "string"
          ? metadata.full_name
          : "Usuário autenticado";
  const emailUsuario =
    typeof claims.email === "string" ? claims.email : "Sessão ativa";

  return (
    <div className="min-h-screen bg-slate-50 lg:grid lg:grid-cols-[280px_1fr]">
      <AppSidebar />
      <div className="min-w-0">
        <AppHeader nomeUsuario={nomeUsuario} emailUsuario={emailUsuario} />
        <main className="mx-auto w-full max-w-7xl p-5 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
