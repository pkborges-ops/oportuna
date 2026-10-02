"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { gerarAnaliseOportunidade } from "@/lib/openai/analise-oportunidade";
import { criarClienteSupabaseServer } from "@/lib/supabase/server";
import { registrarEventoPlano } from "@/lib/planos/eventos";
import { buscarOportunidadePorId } from "@/services/oportunidades-service";
import { buscarPerfilPorId } from "@/services/perfis-service";

function obterCampoObrigatorio(formData: FormData, campo: string) {
  const valor = formData.get(campo);

  if (typeof valor !== "string" || !valor.trim()) {
    redirecionarComErro("/oportunidades", "Oportunidade invalida.");
  }

  return valor.trim();
}

function obterDestinoSeguro(valor: FormDataEntryValue | null) {
  if (typeof valor !== "string" || !valor.startsWith("/")) {
    return "/oportunidades";
  }

  if (valor.startsWith("//") || valor.startsWith("/login")) {
    return "/oportunidades";
  }

  return valor;
}

function redirecionarComErro(destino: string, mensagem: string): never {
  const [pathname, queryString] = destino.split("?");
  const params = new URLSearchParams(queryString);
  params.set("erro", mensagem);

  redirect(`${pathname}?${params.toString()}`);
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

export async function alternarFavorito(formData: FormData) {
  const oportunidadeId = obterCampoObrigatorio(formData, "oportunidadeId");
  const favoritoAtual = formData.get("favoritoAtual") === "true";
  const redirectTo = obterDestinoSeguro(formData.get("redirectTo"));
  const { supabase, usuarioId } = await obterContextoAutenticado();

  const { error } = favoritoAtual
    ? await supabase
        .from("oportunidades_favoritos")
        .delete()
        .eq("usuario_id", usuarioId)
        .eq("oportunidade_id", oportunidadeId)
    : await supabase.from("oportunidades_favoritos").upsert(
        {
          usuario_id: usuarioId,
          oportunidade_id: oportunidadeId,
        },
        { onConflict: "usuario_id,oportunidade_id", ignoreDuplicates: true },
  );

  if (error) {
    if (error.message.includes("Limite de favoritos")) {
      await registrarEventoPlano(supabase, usuarioId, "atingiu_limite_favoritos");
      redirecionarComErro(redirectTo, "Você atingiu o limite de 5 favoritos do plano Free.");
    }
    redirecionarComErro(redirectTo, "Nao foi possivel atualizar o favorito.");
  }

  revalidatePath("/dashboard");
  revalidatePath("/favoritos");
  revalidatePath("/oportunidades");
  revalidatePath(`/oportunidades/${oportunidadeId}`);
  redirect(redirectTo);
}

export async function desbloquearScore(formData: FormData) {
  const oportunidadeId = obterCampoObrigatorio(formData, "oportunidadeId");
  const perfilId = obterCampoObrigatorio(formData, "perfilId");
  const redirectTo = obterDestinoSeguro(formData.get("redirectTo"));
  const { supabase, usuarioId } = await obterContextoAutenticado();
  const { data, error } = await supabase.rpc("desbloquear_score_v1", {
    p_perfil_id: perfilId, p_oportunidade_id: oportunidadeId,
  });
  if (error) redirecionarComErro(redirectTo, "Não foi possível desbloquear o score.");
  if (!data) {
    await registrarEventoPlano(supabase, usuarioId, "atingiu_limite_score");
    redirecionarComErro(redirectTo, "Limite de 3 novos scores por dia atingido no plano Free.");
  }
  revalidatePath("/oportunidades");
  revalidatePath(`/oportunidades/${oportunidadeId}`);
  redirect(redirectTo);
}

export async function analisarOportunidade(formData: FormData) {
  const oportunidadeId = obterCampoObrigatorio(formData, "oportunidadeId");
  const perfilId = obterCampoObrigatorio(formData, "perfilId");
  const redirectTo = `/oportunidades/${oportunidadeId}?perfilId=${encodeURIComponent(
    perfilId,
  )}`;
  const { supabase, usuarioId } = await obterContextoAutenticado();

  const { data: analiseExistente, error: erroBusca } = await supabase
    .from("analises_oportunidades")
    .select("id")
    .eq("usuario_id", usuarioId)
    .eq("oportunidade_id", oportunidadeId)
    .eq("perfil_id", perfilId)
    .maybeSingle();

  if (erroBusca) {
    redirecionarComErro(redirectTo, "Nao foi possivel buscar a analise.");
  }

  if (analiseExistente) {
    redirect(`${redirectTo}&mensagem=Analise existente reutilizada.`);
  }

  const { data: reserva, error: erroReserva } = await supabase.rpc("reservar_analise_ia_v1", {
    p_perfil_id: perfilId, p_oportunidade_id: oportunidadeId,
  });
  if (erroReserva) redirecionarComErro(redirectTo, "Não foi possível reservar a análise.");
  if (!reserva) {
    await registrarEventoPlano(supabase, usuarioId, "atingiu_limite_ia");
    redirecionarComErro(redirectTo, "Limite de análises por IA atingido ou análise em andamento.");
  }

  try {
    const [oportunidade, perfil] = await Promise.all([
      buscarOportunidadePorId(oportunidadeId),
      buscarPerfilPorId(perfilId),
    ]);
    if (!oportunidade || !perfil) throw new Error("Perfil ou oportunidade invalida.");
    const analise = await gerarAnaliseOportunidade({ oportunidade, perfil });

    const { error } = await supabase.from("analises_oportunidades").insert({
      usuario_id: usuarioId,
      oportunidade_id: oportunidadeId,
      perfil_id: perfilId,
      score: analise.score,
      justificativa: analise.justificativa,
      resumo: analise.resumo,
      pontos_atencao: analise.pontos_atencao,
    });

    if (error) throw new Error("Nao foi possivel salvar a analise.");
  } catch (error) {
    const mensagem =
      error instanceof Error
        ? error.message
        : "Nao foi possivel gerar a analise por IA.";
    redirecionarComErro(redirectTo, mensagem);
  } finally {
    await supabase.rpc("liberar_reserva_ia_v1", { p_reserva_id: reserva });
  }

  revalidatePath(`/oportunidades/${oportunidadeId}`);
  redirect(`${redirectTo}&mensagem=Analise gerada com sucesso.`);
}
