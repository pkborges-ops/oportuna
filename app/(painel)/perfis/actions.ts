"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { criarClienteSupabaseServer } from "@/lib/supabase/server";
import type { CompanySize, ProfileStatus } from "@/types";

const portesPermitidos: CompanySize[] = ["MEI", "ME", "EPP", "Media", "Grande"];
const statusPermitidos: ProfileStatus[] = ["ativo", "inativo"];

function redirecionarComErro(rota: string, mensagem: string): never {
  redirect(`${rota}?erro=${encodeURIComponent(mensagem)}`);
}

function obterCampoObrigatorio(
  formData: FormData,
  campo: string,
  rotaErro: string,
  rotulo: string,
) {
  const valor = formData.get(campo);

  if (typeof valor !== "string" || !valor.trim()) {
    redirecionarComErro(rotaErro, `Informe ${rotulo}.`);
  }

  return valor.trim();
}

function obterPorte(formData: FormData, rotaErro: string) {
  const porte = obterCampoObrigatorio(formData, "porte", rotaErro, "o porte");

  if (!portesPermitidos.includes(porte as CompanySize)) {
    redirecionarComErro(rotaErro, "Informe um porte valido.");
  }

  return porte as CompanySize;
}

function obterStatus(formData: FormData, rotaErro: string) {
  const status = obterCampoObrigatorio(formData, "status", rotaErro, "o status");

  if (!statusPermitidos.includes(status as ProfileStatus)) {
    redirecionarComErro(rotaErro, "Informe um status valido.");
  }

  return status as ProfileStatus;
}

function obterPalavrasChave(formData: FormData) {
  const valor = formData.get("palavrasChave");

  if (typeof valor !== "string") {
    return [];
  }

  return Array.from(
    new Set(
      valor
        .split(/[,\n]/)
        .map((palavra) => palavra.trim())
        .filter(Boolean),
    ),
  );
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

export async function criarPerfil(formData: FormData) {
  const rotaErro = "/perfis/novo";
  const { supabase, usuarioId } = await obterContextoAutenticado();

  const { error } = await supabase.from("perfis_empresa").insert({
    usuario_id: usuarioId,
    nome_empresa: obterCampoObrigatorio(
      formData,
      "nomeEmpresa",
      rotaErro,
      "o nome da empresa",
    ),
    cnpj: obterCampoObrigatorio(formData, "cnpj", rotaErro, "o CNPJ"),
    segmento: obterCampoObrigatorio(formData, "segmento", rotaErro, "o segmento"),
    porte: obterPorte(formData, rotaErro),
    uf: obterCampoObrigatorio(formData, "uf", rotaErro, "a UF").toUpperCase(),
    palavras_chave: obterPalavrasChave(formData),
    status: "ativo",
  });

  if (error) {
    redirecionarComErro(rotaErro, "Nao foi possivel salvar o perfil.");
  }

  revalidatePath("/perfis");
  revalidatePath("/dashboard");
  redirect("/perfis?mensagem=Perfil criado com sucesso.");
}

export async function editarPerfil(formData: FormData) {
  const id = obterCampoObrigatorio(formData, "id", "/perfis", "o perfil");
  const rotaErro = `/perfis/${id}`;
  const { supabase, usuarioId } = await obterContextoAutenticado();

  const { data, error } = await supabase
    .from("perfis_empresa")
    .update({
      nome_empresa: obterCampoObrigatorio(
        formData,
        "nomeEmpresa",
        rotaErro,
        "o nome da empresa",
      ),
      cnpj: obterCampoObrigatorio(formData, "cnpj", rotaErro, "o CNPJ"),
      segmento: obterCampoObrigatorio(
        formData,
        "segmento",
        rotaErro,
        "o segmento",
      ),
      porte: obterPorte(formData, rotaErro),
      uf: obterCampoObrigatorio(formData, "uf", rotaErro, "a UF").toUpperCase(),
      palavras_chave: obterPalavrasChave(formData),
      status: obterStatus(formData, rotaErro),
      atualizado_em: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("usuario_id", usuarioId)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    redirecionarComErro(rotaErro, "Nao foi possivel atualizar o perfil.");
  }

  revalidatePath("/perfis");
  revalidatePath("/dashboard");
  redirect("/perfis?mensagem=Perfil atualizado com sucesso.");
}

export async function excluirPerfil(formData: FormData) {
  const id = obterCampoObrigatorio(formData, "id", "/perfis", "o perfil");
  const { supabase, usuarioId } = await obterContextoAutenticado();

  const { data, error } = await supabase
    .from("perfis_empresa")
    .delete()
    .eq("id", id)
    .eq("usuario_id", usuarioId)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    redirecionarComErro("/perfis", "Nao foi possivel excluir o perfil.");
  }

  revalidatePath("/perfis");
  revalidatePath("/dashboard");
  redirect("/perfis?mensagem=Perfil excluido com sucesso.");
}
