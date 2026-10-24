import { ErroGeracaoAnalise, validarResultadoAnalise, type ResultadoAnalise } from "@/lib/analises/contrato";

type RespostaRPC = { data: unknown; error: unknown };
type RPC = (nome: string, args: Record<string, unknown>) => PromiseLike<RespostaRPC>;
type Retorno = { codigo: string; execucao_id?: string };

// Dependências explícitas: testes nunca precisam de credenciais ou rede.
export async function executarAnaliseSegura({ rpc, gerar, usuarioId, perfilId, oportunidadeId, dados }: {
  rpc: RPC;
  gerar: () => Promise<ResultadoAnalise & { metadados?: Record<string, unknown> }>;
  usuarioId: string; perfilId: string; oportunidadeId: string;
  dados: { hash: string; versao: string; snapshot: object };
}): Promise<Retorno> {
  const reserva = await rpc("ia_reservar_v1", {
    p_usuario: usuarioId, p_perfil: perfilId, p_oportunidade: oportunidadeId,
    p_hash: dados.hash, p_versao: dados.versao, p_snapshot: dados.snapshot,
  });
  if (reserva.error || !reserva.data) return { codigo: "RESERVA_INDISPONIVEL" };
  const r = reserva.data as Retorno;
  if (r.codigo !== "RESERVADA" || !r.execucao_id) return r;
  const ids = { p_usuario: usuarioId, p_execucao: r.execucao_id };
  // Uma falha de transporte aqui é incerta: nunca chamar o provedor sem o token confirmado.
  let inicio: RespostaRPC;
  try { inicio = await rpc("ia_iniciar_v1", ids); }
  catch { return { codigo: "INCERTA", execucao_id: r.execucao_id }; }
  const i = inicio.data as { codigo?: string; token?: string } | null;
  if (inicio.error || i?.codigo !== "INICIADA" || !i.token) return { codigo: "NAO_INICIADA", execucao_id: r.execucao_id };
  const execucao = { ...ids, p_token: i.token };
  let gerada = false;
  let metadados: Record<string, unknown> = { versao: dados.versao };
  try {
    const { metadados: dadosProvedor, ...conteudo } = await gerar();
    metadados = { ...dadosProvedor, versao: dados.versao };
    const resultado = validarResultadoAnalise(conteudo);
    gerada = true;
    const fim = await rpc("ia_finalizar_v1", {
      ...execucao, p_resultado: resultado,
      p_metadados: metadados,
    });
    if (fim.error || (fim.data as Retorno | null)?.codigo !== "CONCLUIDA") throw new Error("FINALIZACAO_INCERTA");
    return { codigo: "CONCLUIDA", execucao_id: r.execucao_id };
  } catch (error) {
    if (error instanceof ErroGeracaoAnalise) metadados = { ...metadados, ...error.metadados };
    const incerta = gerada || !(error instanceof ErroGeracaoAnalise) || error.incerta;
    try {
      const falha = await rpc("ia_falhar_v1", { ...execucao, p_incerta: incerta,
        p_codigo: error instanceof ErroGeracaoAnalise ? error.codigo : "FINALIZACAO_INCERTA",
        p_metadados: metadados });
      // Se o commit já ocorreu e apenas a resposta se perdeu, não sobrescrever conclusão.
      if (!falha.error && falha.data === "completed") return { codigo: "CONCLUIDA", execucao_id: r.execucao_id };
      if (falha.error || falha.data === "uncertain") return { codigo: "INCERTA", execucao_id: r.execucao_id };
    } catch { return { codigo: "INCERTA", execucao_id: r.execucao_id }; }
    return { codigo: incerta ? "INCERTA" : "FALHOU", execucao_id: r.execucao_id };
  }
}
