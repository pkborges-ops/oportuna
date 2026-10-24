"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { gerarAnaliseOportunidade } from "@/lib/openai/analise-oportunidade";
import { consultarInterfaceIA } from "@/services/interface-ia-service";
import { mensagensIA } from "@/lib/analises/apresentacao";
import { prepararDadosAnalise } from "@/lib/analises/contrato";
import { executarAnaliseSegura } from "@/lib/analises/executar";
import { criarClienteSupabaseAdmin } from "@/lib/supabase/admin";
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

  if (analiseExistente && formData.get("atualizar") !== "true") {
    redirect(`${redirectTo}&mensagem=Analise existente reutilizada.`);
  }

  let codigo: string;
  try {
    const [oportunidade, perfil] = await Promise.all([
      buscarOportunidadePorId(oportunidadeId),
      buscarPerfilPorId(perfilId),
    ]);
    if (!oportunidade || !perfil) throw new Error("Perfil ou oportunidade invalida.");
    const interfaceIA = await consultarInterfaceIA(oportunidade, perfil);
    if (interfaceIA.atual) {
      codigo = "EXISTENTE";
    } else if (interfaceIA.estado && interfaceIA.estado !== "failed") {
      codigo = interfaceIA.estado === "uncertain" ? "INCERTA" : "EM_ANDAMENTO";
    } else {
      // Identidade vem de getUser; hash, versão e snapshot nunca vêm do formulário.
      const admin = criarClienteSupabaseAdmin();
      const resultado = await executarAnaliseSegura({
        // Reserva leva o JWT real: auth.uid() é conferido dentro da transação SQL.
        // Token e operações de execução continuam exclusivos do backend.
        rpc: (nome, args) => nome === "ia_reservar_v1"
          ? supabase.rpc(nome, args)
          : admin.rpc(nome, args),
        gerar: () => gerarAnaliseOportunidade({ oportunidade, perfil }),
        usuarioId, perfilId, oportunidadeId,
        dados: prepararDadosAnalise(oportunidade, perfil),
      });
      codigo = resultado.codigo;
      if (codigo === "INCERTA") {
        console.warn("ia_execucao_requer_reconciliacao", {
          usuarioId, execucaoId: resultado.execucao_id, codigo,
        });
      }
    }
  } catch {
    redirect(`${redirectTo}&ia=TEMPORARIO&erro=Falha%20temporaria`);
  }
  if (codigo === "LIMITE_ATINGIDO") {
    await registrarEventoPlano(supabase, usuarioId, "atingiu_limite_ia");
  }
  if (codigo !== "CONCLUIDA" && codigo !== "EXISTENTE") {
    const seguro = Object.hasOwn(mensagensIA, codigo) ? codigo : "TEMPORARIO";
    redirect(`${redirectTo}&ia=${seguro}`);
  }

  revalidatePath(`/oportunidades/${oportunidadeId}`);
  redirect(`${redirectTo}&ia=${codigo}&mensagem=${codigo === "EXISTENTE" ? "Analise existente reutilizada." : "Analise gerada com sucesso."}`);
}
