import { NextResponse, type NextRequest } from "next/server";

import { sincronizarOportunidadesPncp } from "@/services/sincronizacao-pncp-service";

export const maxDuration = 60;

function requisicaoAutorizada(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;

  return Boolean(
    segredo && request.headers.get("authorization") === `Bearer ${segredo}`,
  );
}

export async function GET(request: NextRequest) {
  if (!requisicaoAutorizada(request)) {
    console.warn("[pncp-cron] Tentativa não autorizada.");
    return NextResponse.json(
      { ok: false, erro: "Não autorizado." },
      { status: 401 },
    );
  }

  const dataExecucao = new Date().toISOString();
  const dataFinal = dataExecucao.slice(0, 10).replaceAll("-", "");

  try {
    const resultado = await sincronizarOportunidadesPncp({
      dataFinal,
    });

    return NextResponse.json({
      ok: true,
      dataExecucao,
      modalidade: resultado.modalidade?.nome ?? null,
      resultado,
    });
  } catch {
    // Não expor mensagens de dependências, credenciais ou headers.
    console.error("[pncp-cron] Falha ao sincronizar oportunidades.", {
      dataExecucao,
    });

    return NextResponse.json(
      { ok: false, erro: "Não foi possível sincronizar oportunidades do PNCP." },
      { status: 500 },
    );
  }
}
