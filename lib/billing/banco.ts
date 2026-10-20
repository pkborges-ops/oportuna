import "server-only";
import type { AsaasEnvironment } from "@/lib/billing/ambiente";
import { criarClienteSupabaseAdmin } from "@/lib/supabase/admin";

export async function criarClienteBilling(environment: AsaasEnvironment) {
  const admin = criarClienteSupabaseAdmin();
  const { data, error } = await admin.rpc("billing_verificar_ambiente_v1", { p_ambiente: environment });
  if (error || data !== true) throw new Error("Ambiente de billing incompativel com o banco.");
  return {
    rpc: (name: string, args: Record<string, unknown>) => admin.rpc("billing_executar_v1", {
      p_ambiente: environment, p_operacao: name, p_argumentos: args,
    }),
  };
}
