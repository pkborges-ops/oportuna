import "server-only";
import { criarClienteSupabaseServer } from "@/lib/supabase/server";
import { prepararDadosAnalise } from "@/lib/analises/contrato";
import { snapshotsEquivalentes } from "@/lib/analises/apresentacao";
import type { Opportunity, Profile } from "@/types";

export type InterfaceIA = {
  estado: "pending" | "processing" | "uncertain" | "failed" | null;
  resultado: { id: string; hash: string; versao: string; snapshot: unknown } | null;
};
export async function consultarInterfaceIA(oportunidade: Opportunity, perfil: Profile) {
  const dados = prepararDadosAnalise(oportunidade, perfil);
  const supabase = await criarClienteSupabaseServer();
  const { data, error } = await supabase.rpc("ia_consultar_interface_v1", {
    p_perfil: perfil.id, p_oportunidade: oportunidade.id, p_hash: dados.hash, p_versao: dados.versao,
  });
  if (error || !data) throw new Error("Consulta de análise indisponível.");
  const interfaceIA = data as InterfaceIA;
  const resultado = interfaceIA.resultado;
  const snapshot = resultado?.snapshot;
  const comparavel = Boolean(snapshot && typeof snapshot === "object" &&
    "perfil" in snapshot && snapshot.perfil && typeof snapshot.perfil === "object" &&
    "oportunidade" in snapshot && snapshot.oportunidade && typeof snapshot.oportunidade === "object");
  const atual = Boolean(resultado && (resultado.hash === dados.hash ||
    (comparavel && snapshotsEquivalentes(resultado.snapshot, dados.snapshot))));
  return { ...interfaceIA, atual, comparavel };
}
