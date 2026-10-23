import "server-only";
import { criarClienteSupabaseServer } from "@/lib/supabase/server";

export type FranquiaIA = {
  codigo: "OK" | "CICLO_NAO_AUTORIZADO";
  plano: "FREE" | "PRO" | "BUSINESS";
  ciclo_id?: string;
  limite: number | null;
  consumidas: number;
  reservadas: number;
  disponiveis: number;
  inicio: string | null;
  fim: string | null;
  // Limite do período vigente; não é promessa de pagamento/renovação.
  renovacao: string | null;
};

export async function consultarFranquiaIA(): Promise<FranquiaIA> {
  const supabase = await criarClienteSupabaseServer();
  const { data, error } = await supabase.rpc("ia_consultar_franquia_v1");
  if (error || !data) throw new Error("Não foi possível consultar a franquia de IA.");
  return data as FranquiaIA;
}
