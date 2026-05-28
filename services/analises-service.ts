import { redirect } from "next/navigation";

import { criarClienteSupabaseServer } from "@/lib/supabase/server";
import type { OpportunityAIAnalysis } from "@/types";

type AnaliseRow = {
  id: string;
  oportunidade_id: string;
  perfil_id: string;
  score: number;
  justificativa: string;
  resumo: string;
  pontos_atencao: string[] | null;
  criado_em: string;
};

function mapearAnalise(row: AnaliseRow): OpportunityAIAnalysis {
  return {
    id: row.id,
    oportunidadeId: row.oportunidade_id,
    perfilId: row.perfil_id,
    score: row.score,
    justificativa: row.justificativa,
    resumo: row.resumo,
    pontosAtencao: row.pontos_atencao ?? [],
    criadoEm: row.criado_em,
  };
}

async function obterContextoAutenticado() {
  const supabase = await criarClienteSupabaseServer();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    redirect("/login");
  }

  return {
    supabase,
    usuarioId: data.user.id,
  };
}

export async function buscarAnalisePorPerfil(
  oportunidadeId: string,
  perfilId: string,
) {
  const { supabase, usuarioId } = await obterContextoAutenticado();
  const { data, error } = await supabase
    .from("analises_oportunidades")
    .select(
      "id, oportunidade_id, perfil_id, score, justificativa, resumo, pontos_atencao, criado_em",
    )
    .eq("usuario_id", usuarioId)
    .eq("oportunidade_id", oportunidadeId)
    .eq("perfil_id", perfilId)
    .maybeSingle();

  if (error) {
    throw new Error("Nao foi possivel buscar a analise da oportunidade.");
  }

  return data ? mapearAnalise(data as AnaliseRow) : undefined;
}
