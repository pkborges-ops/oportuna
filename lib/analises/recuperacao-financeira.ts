import "server-only";

export const LIMITE_ENTREGAS = 10;
export const ORCAMENTO_WORKER_MS = 40_000;
export const TIMEOUT_RPC_MS = 5_000;

type Banco = {
  rpc: (nome: string, args: Record<string, unknown>, signal: AbortSignal) =>
    PromiseLike<{ data: unknown; error: unknown }>;
};
export type ResumoRecuperacao = {
  reservadas: number; entregues: number; duplicadas: number;
  pendentes: number; obsoletas: number; falhas: number; adiadas: number;
  codigo: "OK" | "PARCIAL" | "RESERVA_INDISPONIVEL";
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Adaptador operacional das RPCs oficiais. Não interpreta concessões/pagamentos,
// não confirma ACK no cliente e não altera leases/tokens/revisões.
export async function recuperarConcessoesPendentes({
  banco, ambiente, agora = Date.now,
}: { banco: Banco; ambiente: string; agora?: () => number }): Promise<ResumoRecuperacao> {
  if (!["sandbox", "production"].includes(ambiente)) throw new Error("AMBIENTE_INVALIDO");
  const fim = agora() + ORCAMENTO_WORKER_MS;
  const sinal = () => AbortSignal.timeout(Math.max(1, Math.min(TIMEOUT_RPC_MS, fim - agora())));
  const resumo: ResumoRecuperacao = {
    reservadas: 0, entregues: 0, duplicadas: 0, pendentes: 0,
    obsoletas: 0, falhas: 0, adiadas: 0, codigo: "OK",
  };
  let lote: { entrega_id: string; token: string }[];
  try {
    const { data, error } = await banco.rpc("billing_concessoes_reservar_entregas_v1",
      { p_ambiente: ambiente, p_limite: LIMITE_ENTREGAS }, sinal());
    if (error || !Array.isArray(data) || data.length > LIMITE_ENTREGAS ||
      data.some(v => !v || typeof v.entrega_id !== "string" || !UUID.test(v.entrega_id) ||
        typeof v.token !== "string" || !UUID.test(v.token)) ||
      new Set(data.map(v => v.entrega_id)).size !== data.length) throw new Error("LOTE_INVALIDO");
    lote = data;
  } catch {
    // A reserva pode ter sido commitada: não repetir na mesma execução.
    return { ...resumo, falhas: 1, codigo: "RESERVA_INDISPONIVEL" };
  }
  resumo.reservadas = lote.length;
  for (const item of lote) {
    if (agora() >= fim) { resumo.adiadas++; continue; }
    try {
      const { data, error } = await banco.rpc("billing_concessoes_entregar_v1", {
        p_ambiente: ambiente, p_entrega: item.entrega_id, p_token: item.token,
      }, sinal());
      if (error) { resumo.falhas++; continue; }
      switch (data) {
        case "delivered": resumo.entregues++; break;
        case "duplicate": resumo.duplicadas++; break;
        case "pending": resumo.pendentes++; break;
        case "stale": case "lease_lost": case "not_found": resumo.obsoletas++; break;
        default: resumo.falhas++;
      }
    } catch {
      // Perda de resposta não significa rollback. SQL/lease decidirá na próxima rodada.
      resumo.falhas++;
    }
  }
  resumo.codigo = resumo.falhas || resumo.pendentes || resumo.adiadas ? "PARCIAL" : "OK";
  return resumo;
}
