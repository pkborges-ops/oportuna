import "server-only";
import type { Opportunity, Profile } from "@/types";
import { ErroGeracaoAnalise, prepararDadosAnalise, validarResultadoAnalise, SCHEMA_ANALISE, VERSAO_ANALISE } from "@/lib/analises/contrato";
import { INSTRUCOES_ANALISE } from "@/lib/openai/prompt-analise";

export const TIMEOUT_ANALISE_MS = 90_000;
export const MAX_OUTPUT_TOKENS = 2500;

export async function gerarAnaliseOportunidade({ oportunidade, perfil }: { oportunidade: Opportunity; perfil: Profile }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new ErroGeracaoAnalise("PROVEDOR_NAO_CONFIGURADO");
  const dados = prepararDadosAnalise(oportunidade, perfil);
  const inicio = Date.now();
  let metadados: Record<string, unknown> = { versao_prompt: VERSAO_ANALISE };
  const falha = (codigo: string, incerta = false) => new ErroGeracaoAnalise(codigo, incerta,
    { ...metadados, duracao_ms: Date.now() - inicio, resultado_tentativa: codigo });
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", signal: AbortSignal.timeout(TIMEOUT_ANALISE_MS),
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-5.1", store: false,
        instructions: INSTRUCOES_ANALISE, input: JSON.stringify(dados.snapshot),
        max_output_tokens: MAX_OUTPUT_TOKENS,
        text: { format: { type: "json_schema", name: "analise_oportunidade_v2", strict: true, schema: SCHEMA_ANALISE } },
      }),
    });
  } catch (error) {
    throw falha(error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
      ? "PROVEDOR_TIMEOUT" : "PROVEDOR_RESULTADO_DESCONHECIDO", true);
  }
  if (!response.ok) throw falha(`PROVEDOR_HTTP_${response.status}`, response.status >= 500 || response.status === 408);
  try {
    const data = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) throw falha("RESPOSTA_INVALIDA");
    const identificador = (v: unknown) => typeof v === "string" && v.length <= 200 ? v : null;
    const tokens = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0 ? v : null;
    metadados = { ...metadados, modelo: identificador(data.model), resposta_id: identificador(data.id),
      input_tokens: tokens(data.usage?.input_tokens), output_tokens: tokens(data.usage?.output_tokens) };
    if (data.status !== "completed" || data.incomplete_details || data.error) {
      throw falha("RESPOSTA_INCOMPLETA", !["incomplete", "failed", "cancelled", "completed"].includes(data.status));
    }
    if (!Array.isArray(data.output)) throw falha("RESPOSTA_INVALIDA");
    const mensagens = data.output.filter((v: { type?: string }) => v?.type === "message");
    if (data.output.some((v: { content?: { type?: string }[] }) =>
      Array.isArray(v?.content) && v.content.some(c => c?.type === "refusal"))) throw falha("RESPOSTA_RECUSADA");
    if (mensagens.length !== 1 || data.output.some((v: { type?: string }) => !["message", "reasoning"].includes(v?.type ?? ""))) throw falha("RESPOSTA_INVALIDA");
    const m = mensagens[0];
    if (m.role !== "assistant" || m.status !== "completed" || !Array.isArray(m.content) ||
      m.content.length !== 1 || m.content[0]?.type !== "output_text" || typeof m.content[0].text !== "string" ||
      m.content[0].text.length > 20000) throw falha("RESPOSTA_INVALIDA");
    const resultado = validarResultadoAnalise(JSON.parse(m.content[0].text));
    return { ...resultado, metadados: { ...metadados, duracao_ms: Date.now() - inicio, resultado_tentativa: "VALIDA" } };
  } catch (error) {
    if (error instanceof ErroGeracaoAnalise) throw falha(error.codigo, error.incerta);
    throw falha("RESPOSTA_INVALIDA", !(error instanceof SyntaxError));
  }
}
