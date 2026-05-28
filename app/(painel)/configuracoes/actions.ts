"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  executarTesteAlerta,
  salvarConfiguracaoAlerta,
} from "@/services/alertas-service";
import type { AlertFrequency } from "@/types";

function redirecionarComMensagem(tipo: "erro" | "mensagem", mensagem: string): never {
  redirect(`/configuracoes?${tipo}=${encodeURIComponent(mensagem)}`);
}

function obterTexto(formData: FormData, campo: string, rotulo: string) {
  const valor = formData.get(campo);

  if (typeof valor !== "string" || !valor.trim()) {
    redirecionarComMensagem("erro", `Informe ${rotulo}.`);
  }

  return valor.trim();
}

function obterFrequencia(valor: string): AlertFrequency {
  return valor === "semanal" ? "semanal" : "diaria";
}

function obterScoreMinimo(valor: string) {
  const score = Number(valor);

  if (!Number.isFinite(score)) {
    redirecionarComMensagem("erro", "Informe um score minimo valido.");
  }

  return Math.min(100, Math.max(0, Math.round(score)));
}

export async function salvarAlertaPerfil(formData: FormData) {
  const perfilId = obterTexto(formData, "perfilId", "o perfil");
  const emailDestino = obterTexto(formData, "emailDestino", "o e-mail de alerta");

  if (!emailDestino.includes("@")) {
    redirecionarComMensagem("erro", "Informe um e-mail de alerta valido.");
  }

  try {
    await salvarConfiguracaoAlerta({
      perfilId,
      emailDestino,
      frequencia: obterFrequencia(obterTexto(formData, "frequencia", "a frequencia")),
      scoreMinimo: obterScoreMinimo(
        obterTexto(formData, "scoreMinimo", "o score minimo"),
      ),
      ativo: formData.get("ativo") === "on",
    });
  } catch (error) {
    const mensagem =
      error instanceof Error ? error.message : "Nao foi possivel salvar o alerta.";
    redirecionarComMensagem("erro", mensagem);
  }

  revalidatePath("/configuracoes");
  redirecionarComMensagem("mensagem", "Configuracao de alerta salva.");
}

export async function dispararTesteAlerta(formData: FormData) {
  const perfilId = obterTexto(formData, "perfilId", "o perfil");
  let mensagem: string;

  try {
    const resultado = await executarTesteAlerta(perfilId);

    mensagem = `Teste concluido: ${resultado.enviadas} oportunidade(s) no alerta, ${resultado.consideradas} considerada(s).`;
  } catch (error) {
    const mensagemErro =
      error instanceof Error ? error.message : "Nao foi possivel disparar o teste.";
    redirecionarComMensagem("erro", mensagemErro);
  }

  revalidatePath("/configuracoes");
  redirecionarComMensagem("mensagem", mensagem);
}
