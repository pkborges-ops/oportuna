import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import { enviarEmailAlerta } from "@/lib/email/alertas-email";
import { criarClienteSupabaseServer } from "@/lib/supabase/server";
import type {
  AlertFrequency,
  AlertHistory,
  AlertLastStatus,
  Profile,
  ProfileAlert,
} from "@/types";

type AlertaPerfilRow = {
  id: string;
  usuario_id?: string;
  perfil_id: string;
  email_destino: string;
  frequencia: AlertFrequency;
  score_minimo: number;
  ativo: boolean;
  ultima_execucao_em: string | null;
  ultima_quantidade_considerada: number | null;
  ultima_quantidade_enviada: number | null;
  ultimo_status: AlertLastStatus | null;
  ultimo_erro: string | null;
};

type PerfilRow = {
  id: string;
  nome_empresa: string;
  cnpj: string;
  segmento: string;
  porte: Profile["porte"];
  uf: string;
  palavras_chave: string[] | null;
  status: Profile["status"];
  criado_em: string;
};

type AnaliseRow = {
  id?: string;
  oportunidade_id: string;
  score: number;
  resumo: string;
};

type OportunidadeRow = {
  id: string;
  titulo: string;
  orgao: string;
  status: string;
  score: number | null;
  analise_resumo: string | null;
  participacao_portal: string | null;
  participacao_url: string | null;
  participacao_forma: string | null;
  participacao_prazo_limite: string | null;
  participacao_observacoes: string | null;
};

type CandidataAlerta = {
  analise: AnaliseRow;
  oportunidade: OportunidadeRow;
};

type HistoricoRow = {
  id: string;
  perfil_id: string;
  oportunidade_id: string;
  titulo_oportunidade: string;
  score: number;
  status: AlertHistory["status"];
  detalhes: string | null;
  enviado_em: string;
};

export type ConfiguracaoAlertaPerfil = {
  perfil: Profile;
  alerta: ProfileAlert;
};

export type ResultadoExecucaoAlerta = {
  consideradas: number;
  enviadas: number;
  ignoradasPorDuplicidade: number;
  status: AlertLastStatus;
};

export type ResultadoExecucaoAutomatica = ResultadoExecucaoAlerta & {
  alertaId: string;
  perfilId: string;
};

function mapearPerfil(row: PerfilRow): Profile {
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

function criarAlertaPadrao(perfilId: string, emailUsuario: string): ProfileAlert {
  return {
    perfilId,
    emailDestino: emailUsuario,
    frequencia: "diaria",
    scoreMinimo: 75,
    ativo: false,
    ultimaQuantidadeConsiderada: 0,
    ultimaQuantidadeEnviada: 0,
    ultimoStatus: "nunca_executado",
  };
}

function mapearAlerta(row: AlertaPerfilRow): ProfileAlert {
  return {
    id: row.id,
    perfilId: row.perfil_id,
    emailDestino: row.email_destino,
    frequencia: row.frequencia,
    scoreMinimo: row.score_minimo,
    ativo: row.ativo,
    ultimaExecucaoEm: row.ultima_execucao_em ?? undefined,
    ultimaQuantidadeConsiderada: row.ultima_quantidade_considerada ?? 0,
    ultimaQuantidadeEnviada: row.ultima_quantidade_enviada ?? 0,
    ultimoStatus: row.ultimo_status ?? "nunca_executado",
    ultimoErro: row.ultimo_erro ?? undefined,
  };
}

function mapearHistorico(row: HistoricoRow): AlertHistory {
  return {
    id: row.id,
    perfilId: row.perfil_id,
    oportunidadeId: row.oportunidade_id,
    tituloOportunidade: row.titulo_oportunidade,
    score: row.score,
    status: row.status,
    detalhes: row.detalhes ?? undefined,
    enviadoEm: row.enviado_em,
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
    usuario: data.user,
    usuarioId: data.user.id,
  };
}

export async function listarConfiguracoesAlertas() {
  const { supabase, usuario, usuarioId } = await obterContextoAutenticado();
  const emailUsuario =
    typeof usuario.email === "string" ? usuario.email : "alertas@empresa.com.br";

  const [perfisResult, alertasResult, historicoResult] = await Promise.all([
    supabase
      .from("perfis_empresa")
      .select(
        "id, nome_empresa, cnpj, segmento, porte, uf, palavras_chave, status, criado_em",
      )
      .eq("usuario_id", usuarioId)
      .order("criado_em", { ascending: false }),
    supabase
      .from("alertas_perfis")
      .select(
        "id, perfil_id, email_destino, frequencia, score_minimo, ativo, ultima_execucao_em, ultima_quantidade_considerada, ultima_quantidade_enviada, ultimo_status, ultimo_erro",
      )
      .eq("usuario_id", usuarioId),
    supabase
      .from("alertas_envios")
      .select(
        "id, perfil_id, oportunidade_id, titulo_oportunidade, score, status, detalhes, enviado_em",
      )
      .eq("usuario_id", usuarioId)
      .order("enviado_em", { ascending: false })
      .limit(8),
  ]);

  if (perfisResult.error) {
    throw new Error("Nao foi possivel listar os perfis para alertas.");
  }

  if (alertasResult.error) {
    throw new Error("Nao foi possivel listar as configuracoes de alertas.");
  }

  if (historicoResult.error) {
    throw new Error("Nao foi possivel listar o historico de alertas.");
  }

  const alertasPorPerfil = new Map(
    (alertasResult.data ?? []).map((row) => {
      const alerta = mapearAlerta(row as AlertaPerfilRow);
      return [alerta.perfilId, alerta];
    }),
  );

  return {
    emailUsuario,
    perfis: (perfisResult.data ?? []).map((row) => {
      const perfil = mapearPerfil(row as PerfilRow);

      return {
        perfil,
        alerta:
          alertasPorPerfil.get(perfil.id) ??
          criarAlertaPadrao(perfil.id, emailUsuario),
      };
    }),
    historico: (historicoResult.data ?? []).map((row) =>
      mapearHistorico(row as HistoricoRow),
    ),
  };
}

export async function salvarConfiguracaoAlerta({
  perfilId,
  emailDestino,
  frequencia,
  scoreMinimo,
  ativo,
}: {
  perfilId: string;
  emailDestino: string;
  frequencia: AlertFrequency;
  scoreMinimo: number;
  ativo: boolean;
}) {
  const { supabase, usuarioId } = await obterContextoAutenticado();
  const { data: perfil, error: erroPerfil } = await supabase
    .from("perfis_empresa")
    .select("id")
    .eq("id", perfilId)
    .eq("usuario_id", usuarioId)
    .maybeSingle();

  if (erroPerfil || !perfil) {
    throw new Error("Perfil invalido para configurar alerta.");
  }

  const { error } = await supabase.from("alertas_perfis").upsert(
    {
      usuario_id: usuarioId,
      perfil_id: perfilId,
      email_destino: emailDestino,
      frequencia,
      score_minimo: scoreMinimo,
      ativo,
    },
    { onConflict: "usuario_id,perfil_id" },
  );

  if (error) {
    throw new Error("Nao foi possivel salvar a configuracao do alerta.");
  }
}

export async function executarTesteAlerta(
  perfilId: string,
): Promise<ResultadoExecucaoAlerta> {
  const { supabase, usuarioId } = await obterContextoAutenticado();
  const { data: alerta, error: erroAlerta } = await supabase
    .from("alertas_perfis")
    .select("id, perfil_id, email_destino, frequencia, score_minimo, ativo")
    .eq("usuario_id", usuarioId)
    .eq("perfil_id", perfilId)
    .maybeSingle();

  if (erroAlerta || !alerta) {
    throw new Error("Configure e salve o alerta antes de disparar o teste.");
  }

  const { data: perfil, error: erroPerfil } = await supabase
    .from("perfis_empresa")
    .select("id, nome_empresa")
    .eq("usuario_id", usuarioId)
    .eq("id", perfilId)
    .maybeSingle();

  if (erroPerfil || !perfil) {
    throw new Error("Perfil invalido para disparar alerta.");
  }

  return executarAlertaConfigurado({
    supabase,
    usuarioId,
    alerta: alerta as AlertaPerfilRow,
    nomePerfil: String(perfil.nome_empresa),
  });
}

async function executarAlertaConfigurado({
  supabase,
  usuarioId,
  alerta,
  nomePerfil,
}: {
  supabase: SupabaseClient;
  usuarioId: string;
  alerta: AlertaPerfilRow;
  nomePerfil: string;
}): Promise<ResultadoExecucaoAlerta> {
  try {
    if (!process.env.OPENAI_API_KEY) {
      console.info(
        "[alertas] OPENAI_API_KEY ausente; usando apenas analises persistidas.",
      );
    }

    const { data: analisesPerfil, error: erroAnalises } = await supabase
      .from("analises_oportunidades")
      .select("id, oportunidade_id, score, resumo")
      .eq("usuario_id", usuarioId)
      .eq("perfil_id", alerta.perfil_id)
      .gte("score", Number(alerta.score_minimo))
      .order("score", { ascending: false });

    if (erroAnalises) {
      throw new Error("Nao foi possivel buscar analises para o alerta.");
    }

    const analisesPersistidas = (analisesPerfil ?? []) as AnaliseRow[];
    const oportunidadeIdsComAnaliseDePerfil = analisesPersistidas.map(
      (analise) => analise.oportunidade_id,
    );

    const { data: oportunidades, error: erroOportunidades } = await supabase
      .from("oportunidades_editais")
      .select(
        "id, titulo, orgao, status, score, analise_resumo, participacao_portal, participacao_url, participacao_forma, participacao_prazo_limite, participacao_observacoes",
      )
      .eq("status", "aberta")
      .or(
        [
          oportunidadeIdsComAnaliseDePerfil.length > 0
            ? `id.in.(${oportunidadeIdsComAnaliseDePerfil.join(",")})`
            : "",
          `score.gte.${Number(alerta.score_minimo)}`,
        ]
          .filter(Boolean)
          .join(","),
      );

    if (erroOportunidades) {
      throw new Error("Nao foi possivel buscar oportunidades para o alerta.");
    }

    const oportunidadesAbertas = new Map(
      ((oportunidades ?? []) as OportunidadeRow[]).map((oportunidade) => [
        oportunidade.id,
        oportunidade,
      ]),
    );
    const candidatasPorPerfil = analisesPersistidas
      .map((analise) => ({
        analise,
        oportunidade: oportunidadesAbertas.get(analise.oportunidade_id),
      }))
      .filter((item): item is CandidataAlerta => Boolean(item.oportunidade));
    const idsComAnaliseDePerfil = new Set(
      candidatasPorPerfil.map((item) => item.oportunidade.id),
    );
    const candidatasGerais = Array.from(oportunidadesAbertas.values())
      .filter(
        (oportunidade) =>
          !idsComAnaliseDePerfil.has(oportunidade.id) &&
          oportunidade.score !== null &&
          oportunidade.score >= Number(alerta.score_minimo),
      )
      .map((oportunidade): CandidataAlerta => ({
        analise: {
          oportunidade_id: oportunidade.id,
          score: Number(oportunidade.score),
          resumo: oportunidade.analise_resumo ?? "",
        },
        oportunidade,
      }));
    const candidatas = [...candidatasPorPerfil, ...candidatasGerais];
    const consideradas = candidatas.length;

    if (consideradas === 0) {
      await atualizarUltimaExecucao(alerta.id, 0, 0, "sem_oportunidades");
      return {
        consideradas: 0,
        enviadas: 0,
        ignoradasPorDuplicidade: 0,
        status: "sem_oportunidades",
      };
    }

    const { data: historicoExistente, error: erroHistorico } = await supabase
      .from("alertas_envios")
      .select("oportunidade_id")
      .eq("usuario_id", usuarioId)
      .eq("perfil_id", alerta.perfil_id)
      .in(
        "oportunidade_id",
        candidatas.map((item) => item.oportunidade.id),
      );

    if (erroHistorico) {
      throw new Error("Nao foi possivel verificar envios anteriores.");
    }

    const oportunidadesJaEnviadas = new Set(
      (historicoExistente ?? []).map((item) => String(item.oportunidade_id)),
    );
    const pendentes = candidatas.filter(
      (item) => !oportunidadesJaEnviadas.has(item.oportunidade.id),
    );

    if (pendentes.length === 0) {
      await atualizarUltimaExecucao(
        alerta.id,
        consideradas,
        0,
        "sem_oportunidades",
      );
      return {
        consideradas,
        enviadas: 0,
        ignoradasPorDuplicidade: consideradas,
        status: "sem_oportunidades",
      };
    }

    const envio = await enviarEmailAlerta({
      destinatario: String(alerta.email_destino),
      nomePerfil,
      oportunidades: pendentes.map((item) => ({
        titulo: item.oportunidade.titulo,
        orgao: item.oportunidade.orgao,
        score: item.analise.score,
        resumo: item.analise.resumo,
        participacao: {
          portal: item.oportunidade.participacao_portal ?? undefined,
          url: item.oportunidade.participacao_url ?? undefined,
          forma: item.oportunidade.participacao_forma ?? undefined,
          prazoLimite:
            item.oportunidade.participacao_prazo_limite ?? undefined,
          observacoes:
            item.oportunidade.participacao_observacoes ?? undefined,
        },
      })),
    });

    const { error: erroEnvios } = await supabase.from("alertas_envios").upsert(
      pendentes.map((item) => ({
        usuario_id: usuarioId,
        alerta_id: alerta.id,
        perfil_id: alerta.perfil_id,
        oportunidade_id: item.oportunidade.id,
        analise_id: item.analise.id ?? null,
        titulo_oportunidade: item.oportunidade.titulo,
        score: item.analise.score,
        status: envio.status,
        assunto: envio.assunto,
        detalhes: envio.detalhes,
      })),
      {
        onConflict: "usuario_id,perfil_id,oportunidade_id",
        ignoreDuplicates: true,
      },
    );

    if (erroEnvios) {
      throw new Error("Nao foi possivel registrar o historico de alertas.");
    }

    await atualizarUltimaExecucao(
      alerta.id,
      consideradas,
      pendentes.length,
      envio.status,
    );

    return {
      consideradas,
      enviadas: pendentes.length,
      ignoradasPorDuplicidade: consideradas - pendentes.length,
      status: envio.status,
    };
  } catch (error) {
    const mensagem =
      error instanceof Error ? error.message : "Erro ao executar alerta.";
    await atualizarUltimaExecucao(alerta.id, 0, 0, "erro", mensagem);
    throw error;
  }

  async function atualizarUltimaExecucao(
    alertaId: string,
    quantidadeConsiderada: number,
    quantidadeEnviada: number,
    status: AlertLastStatus,
    erro?: string,
  ) {
    const { error } = await supabase
      .from("alertas_perfis")
      .update({
        ultima_execucao_em: new Date().toISOString(),
        ultima_quantidade_considerada: quantidadeConsiderada,
        ultima_quantidade_enviada: quantidadeEnviada,
        ultimo_status: status,
        ultimo_erro: erro ?? null,
      })
      .eq("id", alertaId)
      .eq("usuario_id", usuarioId);

    if (error) {
      throw new Error("Nao foi possivel atualizar o status do alerta.");
    }
  }
}

function deveExecutarAlerta(alerta: AlertaPerfilRow, agora: Date) {
  if (!alerta.ativo) {
    return false;
  }

  if (!alerta.ultima_execucao_em) {
    return true;
  }

  const ultimaExecucao = new Date(alerta.ultima_execucao_em).getTime();
  const intervaloHoras = alerta.frequencia === "semanal" ? 24 * 7 : 24;
  const proximaExecucao = ultimaExecucao + intervaloHoras * 60 * 60 * 1000;

  return agora.getTime() >= proximaExecucao;
}

export async function executarAlertasAutomaticos({
  forcar = false,
}: {
  forcar?: boolean;
} = {}) {
  const supabase = await criarClienteSupabaseServer();
  const agora = new Date();
  console.info("[alertas-cron] Iniciando execucao automatica.", {
    forcar,
    data: agora.toISOString(),
  });

  const { data: alertas, error } = await supabase
    .from("alertas_perfis")
    .select(
      "id, usuario_id, perfil_id, email_destino, frequencia, score_minimo, ativo, ultima_execucao_em, ultima_quantidade_considerada, ultima_quantidade_enviada, ultimo_status, ultimo_erro",
    )
    .eq("ativo", true);

  if (error) {
    console.error("[alertas-cron] Erro ao listar alertas ativos.", {
      mensagem: error.message,
    });
    throw new Error("Nao foi possivel listar alertas ativos.");
  }

  const alertasElegiveis = ((alertas ?? []) as AlertaPerfilRow[]).filter(
    (alerta) => forcar || deveExecutarAlerta(alerta, agora),
  );
  const resultados: ResultadoExecucaoAutomatica[] = [];
  let erros = 0;

  console.info("[alertas-cron] Alertas encontrados.", {
    ativos: alertas?.length ?? 0,
    elegiveis: alertasElegiveis.length,
  });

  for (const alerta of alertasElegiveis) {
    const usuarioId = alerta.usuario_id;

    if (!usuarioId) {
      erros += 1;
      console.error("[alertas-cron] Alerta sem usuario_id.", {
        alertaId: alerta.id,
      });
      continue;
    }

    try {
      const { data: perfil, error: erroPerfil } = await supabase
        .from("perfis_empresa")
        .select("id, nome_empresa")
        .eq("usuario_id", usuarioId)
        .eq("id", alerta.perfil_id)
        .maybeSingle();

      if (erroPerfil || !perfil) {
        throw new Error("Perfil do alerta nao encontrado.");
      }

      const resultado = await executarAlertaConfigurado({
        supabase,
        usuarioId,
        alerta,
        nomePerfil: String(perfil.nome_empresa),
      });

      resultados.push({
        ...resultado,
        alertaId: alerta.id,
        perfilId: alerta.perfil_id,
      });
      console.info("[alertas-cron] Alerta executado.", {
        alertaId: alerta.id,
        perfilId: alerta.perfil_id,
        status: resultado.status,
        consideradas: resultado.consideradas,
        enviadas: resultado.enviadas,
      });
    } catch (error) {
      erros += 1;
      const mensagem =
        error instanceof Error ? error.message : "Erro ao executar alerta.";
      console.error("[alertas-cron] Erro ao executar alerta.", {
        alertaId: alerta.id,
        perfilId: alerta.perfil_id,
        mensagem,
      });
    }
  }

  console.info("[alertas-cron] Execucao automatica concluida.", {
    executados: resultados.length,
    erros,
  });

  return {
    encontrados: alertas?.length ?? 0,
    elegiveis: alertasElegiveis.length,
    executados: resultados.length,
    erros,
    resultados,
  };
}
