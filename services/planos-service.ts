import { redirect } from "next/navigation";

import { getPlanEntitlements, resolvePlanCode } from "@/lib/planos/entitlements";
import { criarClienteSupabaseServer } from "@/lib/supabase/server";

export async function obterPlanoAtual() {
  const supabase = await criarClienteSupabaseServer();
  const { data: usuario, error: erroUsuario } = await supabase.auth.getUser();
  if (erroUsuario || !usuario.user) redirect("/login");

  const { data, error } = await supabase.rpc("plano_atual_v1");
  if (error) throw new Error("Não foi possível consultar o plano.");
  const codigo = resolvePlanCode(data);
  return { codigo, entitlements: getPlanEntitlements(codigo) };
}
