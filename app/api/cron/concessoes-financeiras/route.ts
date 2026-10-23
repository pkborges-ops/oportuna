import { timingSafeEqual } from "node:crypto";
import { recuperarConcessoesPendentes } from "@/lib/analises/recuperacao-financeira";
import { criarClienteSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function autorizado(request: Request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo?.trim()) return false; // Nunca permitir acesso anônimo, nem em desenvolvimento.
  const recebido = Buffer.from(request.headers.get("authorization") ?? "");
  const esperado = Buffer.from(`Bearer ${segredo}`);
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}
const resposta = (data: object, status: number) => Response.json(data, {
  status, headers: { "Cache-Control": "no-store" },
});

export async function GET(request: Request) {
  if (!autorizado(request)) return resposta({ ok: false, codigo: "NAO_AUTORIZADO" }, 401);
  if (process.env.FINANCEIRO_WORKER_ENABLED !== "true") {
    return resposta({ ok: false, codigo: "WORKER_DESABILITADO" }, 503);
  }
  const ambiente = process.env.ASAAS_ENVIRONMENT;
  if (!["sandbox", "production"].includes(ambiente ?? "") ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || !process.env.SUPABASE_SECRET_KEY?.trim()) {
    console.error("[concessoes-worker]", { codigo: "CONFIGURACAO_INVALIDA" });
    return resposta({ ok: false, codigo: "CONFIGURACAO_INVALIDA" }, 503);
  }
  const inicio = Date.now();
  try {
    const admin = criarClienteSupabaseAdmin();
    const resultado = await recuperarConcessoesPendentes({
      ambiente: ambiente!,
      banco: { rpc: (nome, args, signal) => admin.rpc(nome, args).abortSignal(signal) },
    });
    const ok = resultado.codigo === "OK";
    // Allowlist de contadores: não registrar resposta bruta, IDs, token ou erro RPC.
    const log = { ambiente, duracao_ms: Date.now() - inicio, ...resultado };
    if (ok) console.info("[concessoes-worker]", log);
    else console.warn("[concessoes-worker]", log);
    return resposta({ ok, ...resultado }, ok ? 200 : 503);
  } catch {
    console.error("[concessoes-worker]", { codigo: "EXECUCAO_INDISPONIVEL" });
    return resposta({ ok: false, codigo: "EXECUCAO_INDISPONIVEL" }, 503);
  }
}
