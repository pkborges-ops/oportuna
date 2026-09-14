import { NextResponse, type NextRequest } from "next/server";

import { sincronizarOportunidadesPncp } from "@/services/sincronizacao-pncp-service";

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
      codigoModalidadeContratacao: 6,
      uf: "SC",
      maxPaginas: 2,
    });

    return NextResponse.json({
      ok: true,
      dataExecucao,
      modalidade: "Pregão - Eletrônico",
      uf: "SC",
      resultado,
    });
  } catch {
    // Não expor mensagens de dependências, credenciais ou headers.
    console.error("[pncp-cron] Falha ao sincronizar oportunidades.", {
      dataExecucao,
      modalidade: 6,
      uf: "SC",
    });

    return NextResponse.json(
      { ok: false, erro: "Não foi possível sincronizar oportunidades do PNCP." },
      { status: 500 },
    );
  }
}
