import { NextResponse, type NextRequest } from "next/server";

import { executarAlertasAutomaticos } from "@/services/alertas-service";

function requisicaoAutorizada(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;

  if (!segredo) {
    return process.env.NODE_ENV !== "production";
  }

  return request.headers.get("authorization") === `Bearer ${segredo}`;
}

export async function GET(request: NextRequest) {
  if (!requisicaoAutorizada(request)) {
    console.warn("[alertas-cron] Tentativa nao autorizada.");
    return NextResponse.json({ erro: "Nao autorizado." }, { status: 401 });
  }

  try {
    const forcar = request.nextUrl.searchParams.get("forcar") === "true";
    const resultado = await executarAlertasAutomaticos({ forcar });

    return NextResponse.json({
      ok: true,
      ...resultado,
    });
  } catch (error) {
    const mensagem =
      error instanceof Error ? error.message : "Erro ao executar alertas.";
    console.error("[alertas-cron] Falha na rota agendada.", { mensagem });

    return NextResponse.json({ ok: false, erro: mensagem }, { status: 500 });
  }
}
