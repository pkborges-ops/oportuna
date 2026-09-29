import { redirect } from "next/navigation";

import { criarClienteSupabaseServer } from "@/lib/supabase/server";
import type { Opportunity, OpportunityStatus } from "@/types";
import { normalizarPagina, type ContextoOportunidades } from "@/lib/matching/contexto";
import type { OpportunityMatch } from "@/lib/matching/calcular-match";

export type FiltrosOportunidades = {
  busca?: string;
  status?: OpportunityStatus | "";
  uf?: string;
};

type OportunidadeRow = {
  id: string;
  codigo: string;
  origem: Opportunity["origem"];
  tipo: Opportunity["tipo"];
  titulo: string;
  orgao: string;
  modalidade: string;
  uf: string;
  cidade: string;
  objeto: string;
  valor_estimado: number | string;
  data_publicacao: string;
  data_abertura: string;
  status: OpportunityStatus;
  tags: string[] | null;
  score: number | null;
  analise_resumo: string | null;
  analise_pontos_fortes: string[] | null;
  analise_riscos: string[] | null;
  analise_recomendacao: string | null;
  participacao_portal: string | null;
  participacao_url: string | null;
  participacao_forma: string | null;
  participacao_prazo_limite: string | null;
  participacao_observacoes: string | null;
};

const camposOportunidade = `
  id,
  codigo,
  origem,
  tipo,
  titulo,
  orgao,
  modalidade,
  uf,
  cidade,
  objeto,
  valor_estimado,
  data_publicacao,
  data_abertura,
  status,
  tags,
  score,
  analise_resumo,
  analise_pontos_fortes,
  analise_riscos,
  analise_recomendacao,
  participacao_portal,
  participacao_url,
  participacao_forma,
  participacao_prazo_limite,
  participacao_observacoes
`;

function mapearOportunidade(
  row: OportunidadeRow,
  favoritos: Set<string>,
): Opportunity {
  return {
    id: row.id,
    codigo: row.codigo,
    origem: row.origem,
    tipo: row.tipo,
    titulo: row.titulo,
    orgao: row.orgao,
    modalidade: row.modalidade,
    uf: row.uf,
    cidade: row.cidade,
    objeto: row.objeto,
    valorEstimado: Number(row.valor_estimado),
    dataPublicacao: row.data_publicacao,
    dataAbertura: row.data_abertura,
    status: row.status,
    tags: row.tags ?? [],
    favorito: favoritos.has(row.id),
    participacao: {
      portal: row.participacao_portal ?? undefined,
      url: row.participacao_url ?? undefined,
      forma: row.participacao_forma ?? undefined,
      prazoLimite: row.participacao_prazo_limite ?? undefined,
      observacoes: row.participacao_observacoes ?? undefined,
    },
    analise:
      row.score === null
        ? undefined
        : {
            opportunityId: row.id,
            profileId: "",
            score: row.score,
            resumo: row.analise_resumo ?? "",
            pontosFortes: row.analise_pontos_fortes ?? [],
            riscos: row.analise_riscos ?? [],
            recomendacao: row.analise_recomendacao ?? "",
          },
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

async function listarIdsFavoritos(usuarioId: string) {
  const supabase = await criarClienteSupabaseServer();
  const { data, error } = await supabase
    .from("oportunidades_favoritos")
    .select("oportunidade_id")
    .eq("usuario_id", usuarioId);

  if (error) {
    throw new Error("Nao foi possivel listar os favoritos.");
  }

  return new Set((data ?? []).map((item) => String(item.oportunidade_id)));
}

export async function listarOportunidades(filtros: FiltrosOportunidades = {}) {
  const { supabase, usuarioId } = await obterContextoAutenticado();
  const favoritos = await listarIdsFavoritos(usuarioId);
  let query = supabase
    .from("oportunidades_editais")
    .select(camposOportunidade)
    .order("data_abertura", { ascending: true });

  if (filtros.status) {
    query = query.eq("status", filtros.status);
  }

  if (filtros.uf?.trim()) {
    query = query.eq("uf", filtros.uf.trim().toUpperCase());
  }

  if (filtros.busca?.trim()) {
    const busca = filtros.busca.trim().replaceAll(",", " ");
    query = query.or(
      [
        `titulo.ilike.%${busca}%`,
        `orgao.ilike.%${busca}%`,
        `modalidade.ilike.%${busca}%`,
        `cidade.ilike.%${busca}%`,
        `objeto.ilike.%${busca}%`,
      ].join(","),
    );
  }

  const { data, error } = await query;

  if (error) {
    throw new Error("Nao foi possivel listar as oportunidades.");
  }

  return (data ?? []).map((row) =>
    mapearOportunidade(row as OportunidadeRow, favoritos),
  );
}

export async function listarFavoritos() {
  const { supabase, usuarioId } = await obterContextoAutenticado();
  const favoritos = await listarIdsFavoritos(usuarioId);

  if (favoritos.size === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("oportunidades_editais")
    .select(camposOportunidade)
    .in("id", Array.from(favoritos))
    .order("data_abertura", { ascending: true });

  if (error) {
    throw new Error("Nao foi possivel listar os favoritos.");
  }

  return (data ?? []).map((row) =>
    mapearOportunidade(row as OportunidadeRow, favoritos),
  );
}

export async function buscarOportunidadePorId(id: string) {
  const { supabase, usuarioId } = await obterContextoAutenticado();
  const favoritos = await listarIdsFavoritos(usuarioId);
  const { data, error } = await supabase
    .from("oportunidades_editais")
    .select(camposOportunidade)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error("Nao foi possivel buscar a oportunidade.");
  }

  return data ? mapearOportunidade(data as OportunidadeRow, favoritos) : undefined;
}

export type ItemOportunidadePaginada = {
  oportunidade: Opportunity;
  match?: OpportunityMatch;
  favorito: boolean;
};

type OportunidadePaginadaRow = {
  oportunidade: Omit<Opportunity, "favorito" | "dataPublicacao" | "dataAbertura"> & {
    dataPublicacao: string | null;
    dataAbertura: string | null;
  };
  match: OpportunityMatch | null;
  favorito: boolean;
};

export async function listarOportunidadesPaginadas(filtros: ContextoOportunidades = {}) {
  const { supabase } = await obterContextoAutenticado();
  const pagina = normalizarPagina(filtros.pagina);
  const { data, error } = await supabase.rpc("listar_oportunidades_paginadas_v1", {
    p_perfil_id: filtros.perfilId || null,
    p_busca: filtros.busca?.trim() || null,
    p_status: filtros.status || null,
    p_uf: filtros.uf?.trim().toUpperCase() || null,
    p_aderencia: filtros.perfilId ? filtros.aderencia || null : null,
    p_ordenacao: filtros.ordenacao || "recomendadas",
    p_pagina: pagina,
  });
  if (error) throw new Error("Não foi possível listar as oportunidades.");
  const linhas = (data ?? []) as OportunidadePaginadaRow[];
  const itens: ItemOportunidadePaginada[] = linhas.slice(0, 20).map((row) => ({
    oportunidade: { ...row.oportunidade, favorito: row.favorito,
      dataPublicacao: row.oportunidade.dataPublicacao ?? "",
      dataAbertura: row.oportunidade.dataAbertura ?? "" },
    match: row.match ?? undefined,
    favorito: row.favorito,
  }));
  return { itens, pagina, tamanhoPagina: 20 as const, temAnterior: pagina > 1, temProxima: linhas.length > 20 };
}

export async function calcularMatchOportunidade(perfilId: string, oportunidadeId: string) {
  const { supabase } = await obterContextoAutenticado();
  const { data, error } = await supabase.rpc("calcular_match_oportunidade_v1", {
    p_perfil_id: perfilId,
    p_oportunidade_id: oportunidadeId,
  });
  if (error) throw new Error("Não foi possível calcular a aderência.");
  return (data as OpportunityMatch | null) ?? undefined;
}

// O contador não depende da página nem do limite de linhas da Data API.
export async function obterResumoOportunidades() {
  const { supabase } = await obterContextoAutenticado();
  const [contagem, primeira] = await Promise.all([
    supabase.from("oportunidades_editais").select("id", { count: "exact", head: true }),
    supabase.from("oportunidades_editais")
      .select("id, titulo, orgao, cidade, uf, objeto, valor_estimado, data_abertura")
      .order("data_abertura", { ascending: true }).order("id", { ascending: true })
      .limit(1).maybeSingle(),
  ]);
  if (contagem.error || primeira.error) throw new Error("Não foi possível carregar o resumo.");
  const row = primeira.data;
  return {
    total: contagem.count ?? 0,
    proxima: row ? { id: String(row.id), titulo: String(row.titulo), orgao: String(row.orgao),
      cidade: String(row.cidade), uf: String(row.uf), objeto: String(row.objeto),
      valorEstimado: Number(row.valor_estimado), dataAbertura: String(row.data_abertura) } : undefined,
  };
}
