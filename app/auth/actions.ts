"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { obterDestinoSeguro } from "@/lib/auth/redirect";
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

function obterRotaErroAuth(rota: FormDataEntryValue | null) {
  return rota === "/cadastro" ? "/cadastro" : "/login";
}

async function obterOrigemRequisicao(rotaErro: string) {
  const headersList = await headers();
  const origin = headersList.get("origin");

  if (origin) {
    return origin;
  }

  const host = headersList.get("x-forwarded-host") ?? headersList.get("host");

  if (!host) {
    redirecionarComErro(
      rotaErro,
      "Não foi possível iniciar o login com Google.",
    );
  }

  const protocol = headersList.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
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

export async function entrarComGoogle(formData: FormData) {
  const rotaErro = obterRotaErroAuth(formData.get("rotaErro"));
  const destino = obterDestinoSeguro(formData.get("redirectTo"));
  const origem = await obterOrigemRequisicao(rotaErro);
  const supabase = await criarClienteAuth(rotaErro);
  const callbackUrl = new URL("/auth/callback", origem);

  callbackUrl.searchParams.set("next", destino);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callbackUrl.toString(),
    },
  });

  if (error || !data.url) {
    redirecionarComErro(
      rotaErro,
      "Não foi possível iniciar o login com Google.",
    );
  }

  redirect(data.url);
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
