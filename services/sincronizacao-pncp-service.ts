import { transformarContratacao } from "@/lib/oportunidades/normalizar-pncp";
import { listarContratacoesPncp } from "@/services/pncp-service";
import type { criarClienteSupabaseAdmin } from "@/lib/supabase/admin";

export type CheckpointPncp = {
  modalidade_id: number;
  modalidade_nome: string;
  pagina_proxima: number;
  data_final_ciclo: string;
  ciclo_concluido: boolean;
  reserva_token: string;
};

export type RepositorioPncp = {
  reservar: (dataFinal: string) => Promise<CheckpointPncp | null>;
  gravar: (dados: NonNullable<ReturnType<typeof transformarContratacao>>[]) => Promise<void>;
  concluir: (checkpoint: CheckpointPncp, proximaPagina: number, concluido: boolean) => Promise<void>;
};

// Uma página: PNCP <= 19,5s + três operações de banco <= 5s cada.
// A reserva expira sozinha; nenhuma gravação extra é necessária em caso de falha.
export async function processarLotePncp(
  dataFinal: string,
  repositorio: RepositorioPncp,
  consultar = listarContratacoesPncp,
) {
  const checkpoint = await repositorio.reservar(dataFinal);
  if (!checkpoint) return { modalidade: null, paginaInicial: null, paginaFinal: null,
    paginasProcessadas: 0, consultadas: 0, gravadas: 0, ignoradas: 0,
    proximaPagina: null, cicloConcluido: false, ocupado: true };

  const pagina = checkpoint.pagina_proxima;
  const resultado = await consultar({ dataFinal: checkpoint.data_final_ciclo,
    codigoModalidadeContratacao: checkpoint.modalidade_id, pagina });
  const normalizadas = resultado.contratacoes.map((c) =>
    c.modalidadeId === checkpoint.modalidade_id ? transformarContratacao(c) : null,
  ).filter((c): c is NonNullable<typeof c> => c !== null);
  // Evita erro de ON CONFLICT se o próprio PNCP repetir um código na mesma página.
  const oportunidades = [...new Map(normalizadas.map((c) => [c.codigo, c])).values()];
  if (oportunidades.length) await repositorio.gravar(oportunidades);
  const cicloConcluido = pagina >= resultado.totalPaginas;
  // Página vazia antes do fim não encerra o ciclo silenciosamente.
  if (!resultado.contratacoes.length && !cicloConcluido) {
    throw new Error("Página PNCP vazia antes do fim; preservar checkpoint.");
  }
  const proximaPagina = cicloConcluido ? 1 : pagina + 1;
  await repositorio.concluir(checkpoint, proximaPagina, cicloConcluido);
  return { modalidade: { id: checkpoint.modalidade_id, nome: checkpoint.modalidade_nome },
    paginaInicial: pagina, paginaFinal: pagina, paginasProcessadas: 1,
    consultadas: resultado.contratacoes.length, gravadas: oportunidades.length,
    ignoradas: resultado.contratacoes.length - oportunidades.length,
    proximaPagina, cicloConcluido, ocupado: false };
}

export function criarRepositorioPncp(
  supabase: ReturnType<typeof criarClienteSupabaseAdmin>,
): RepositorioPncp {
  const timeout = () => AbortSignal.timeout(5_000);
  return {
    async reservar(data) {
      const { data: linhas, error } = await supabase.rpc("reservar_lote_pncp", {
        nova_data_final: data,
      }).abortSignal(timeout());
      if (error) throw new Error("Falha ao reservar checkpoint PNCP.");
      return (linhas?.[0] as CheckpointPncp | undefined) ?? null;
    },
    async gravar(dados) {
      const { error } = await supabase.from("oportunidades_editais")
        .upsert(dados, { onConflict: "codigo" }).abortSignal(timeout());
      if (error) throw new Error("Falha ao salvar oportunidades PNCP.");
    },
    async concluir(checkpoint, pagina, concluido) {
      const { data, error } = await supabase.from("sincronizacao_pncp_checkpoints")
        .update({ pagina_proxima: pagina, ciclo_concluido: concluido,
          atualizado_em: new Date().toISOString(), reserva_token: null, reservado_ate: null })
        .eq("modalidade_id", checkpoint.modalidade_id)
        .eq("reserva_token", checkpoint.reserva_token)
        .select("modalidade_id").abortSignal(timeout());
      if (error || data?.length !== 1) throw new Error("Falha ao salvar checkpoint PNCP.");
    },
  };
}

export async function sincronizarOportunidadesPncp({ dataFinal }: { dataFinal: string }) {
  const { criarClienteSupabaseAdmin } = await import("@/lib/supabase/admin");
  return processarLotePncp(dataFinal, criarRepositorioPncp(criarClienteSupabaseAdmin()));
}
