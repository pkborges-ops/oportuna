"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { criarClienteSupabaseServer } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

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

function redirecionarComErro(rota: string, mensagem: string): never {
  redirect(`${rota}?erro=${encodeURIComponent(mensagem)}`);
}

function obterDestinoSeguro(destino: FormDataEntryValue | null) {
  if (typeof destino !== "string" || !destino.startsWith("/")) {
    return "/dashboard";
  }

  if (destino.startsWith("//") || destino.startsWith("/login")) {
    return "/dashboard";
  }

  return destino;
}

async function criarClienteAuth(rotaErro: string): Promise<SupabaseClient> {
  try {
    return await criarClienteSupabaseServer();
  } catch {
    redirecionarComErro(
      rotaErro,
      "Configure as variáveis do Supabase antes de autenticar.",
    );
  }
}

export async function entrar(formData: FormData) {
  const email = obterCampoObrigatorio(formData, "email", "/login", "o e-mail");
  const password = obterCampoObrigatorio(
    formData,
    "senha",
    "/login",
    "a senha",
  );
  const destino = obterDestinoSeguro(formData.get("redirectTo"));
  const supabase = await criarClienteAuth("/login");

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    redirecionarComErro("/login", "E-mail ou senha inválidos.");
  }

  revalidatePath("/", "layout");
  redirect(destino);
}

export async function cadastrar(formData: FormData) {
  const nome = obterCampoObrigatorio(
    formData,
    "nome",
    "/cadastro",
    "o nome",
  );
  const empresa = obterCampoObrigatorio(
    formData,
    "empresa",
    "/cadastro",
    "a empresa",
  );
  const email = obterCampoObrigatorio(
    formData,
    "email",
    "/cadastro",
    "o e-mail",
  );
  const password = obterCampoObrigatorio(
    formData,
    "senha",
    "/cadastro",
    "a senha",
  );
  const supabase = await criarClienteAuth("/cadastro");

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        nome,
        empresa,
      },
    },
  });

  if (error) {
    redirecionarComErro("/cadastro", "Não foi possível criar sua conta.");
  }

  revalidatePath("/", "layout");

  if (data.session) {
    redirect("/dashboard");
  }

  redirect(
    "/login?mensagem=" +
      encodeURIComponent("Cadastro criado. Confirme seu e-mail para entrar."),
  );
}

export async function sair() {
  const supabase = await criarClienteAuth("/login");

  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
