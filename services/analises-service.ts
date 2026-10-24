import { validarResultadoAnalise } from "@/lib/analises/contrato";
import { redirect } from "next/navigation";

import { criarClienteSupabaseServer } from "@/lib/supabase/server";
import type { OpportunityAIAnalysis } from "@/types";

type AnaliseRow = {
  versao_schema?: number;
  conteudo?: unknown;
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
  if (row.versao_schema === 2) {
    const conteudo = validarResultadoAnalise(row.conteudo);
    return { versaoSchema: 2, id: row.id, oportunidadeId: row.oportunidade_id, perfilId: row.perfil_id,
      resumo: conteudo.resumo, criadoEm: row.criado_em, conteudo };
  }
  if (row.versao_schema != null && row.versao_schema !== 1) throw new Error("Versão de análise não suportada.");
  return {
    versaoSchema: 1,
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
  execucaoId?: string,
) {
  const { supabase, usuarioId } = await obterContextoAutenticado();
  let consulta = supabase
    .from("ia_resultados_v1")
    .select("versao_schema, conteudo, execucao_id, oportunidade_id, perfil_id, score, justificativa, resumo, pontos_atencao, criado_em")
    .eq("usuario_id", usuarioId)
    .eq("oportunidade_id", oportunidadeId)
    .eq("perfil_id", perfilId)
    .order("criado_em", { ascending: false })
    .limit(1);
  if (execucaoId) consulta = consulta.eq("execucao_id", execucaoId);
  const { data: versao, error: erroVersao } = await consulta.maybeSingle();
  if (execucaoId && !versao && !erroVersao) throw new Error("Resultado salvo indisponível.");
  if (erroVersao) throw new Error("Nao foi possivel buscar a versao da analise.");
  if (versao) return mapearAnalise({ ...versao, id: versao.execucao_id } as AnaliseRow);
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
