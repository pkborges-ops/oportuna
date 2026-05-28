import { redirect } from "next/navigation";

import { criarClienteSupabaseServer } from "@/lib/supabase/server";
import type { CompanySize, Profile, ProfileStatus } from "@/types";

type PerfilEmpresaRow = {
  id: string;
  nome_empresa: string;
  cnpj: string;
  segmento: string;
  porte: CompanySize;
  uf: string;
  palavras_chave: string[] | null;
  status: ProfileStatus;
  criado_em: string;
};

function mapearPerfil(row: PerfilEmpresaRow): Profile {
  return {
    id: row.id,
    nomeEmpresa: row.nome_empresa,
    cnpj: row.cnpj,
    segmento: row.segmento,
    porte: row.porte,
    uf: row.uf,
    palavrasChave: row.palavras_chave ?? [],
    status: row.status,
    criadoEm: row.criado_em.slice(0, 10),
  };
}

async function obterUsuarioId() {
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

export async function listarPerfis() {
  const { supabase, usuarioId } = await obterUsuarioId();
  const { data, error } = await supabase
    .from("perfis_empresa")
    .select(
      "id, nome_empresa, cnpj, segmento, porte, uf, palavras_chave, status, criado_em",
    )
    .eq("usuario_id", usuarioId)
    .order("criado_em", { ascending: false });

  if (error) {
    throw new Error("Nao foi possivel listar os perfis de empresa.");
  }

  return (data ?? []).map((row) => mapearPerfil(row as PerfilEmpresaRow));
}

export async function buscarPerfilPorId(id: string) {
  const { supabase, usuarioId } = await obterUsuarioId();
  const { data, error } = await supabase
    .from("perfis_empresa")
    .select(
      "id, nome_empresa, cnpj, segmento, porte, uf, palavras_chave, status, criado_em",
    )
    .eq("id", id)
    .eq("usuario_id", usuarioId)
    .maybeSingle();

  if (error) {
    throw new Error("Nao foi possivel buscar o perfil de empresa.");
  }

  return data ? mapearPerfil(data as PerfilEmpresaRow) : undefined;
}
