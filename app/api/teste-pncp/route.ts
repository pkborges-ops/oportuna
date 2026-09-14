import { NextResponse } from "next/server";

import { criarClienteSupabaseServer } from "@/lib/supabase/server";
import { sincronizarOportunidadesPncp } from "@/services/sincronizacao-pncp-service";

function formatarData(data: Date) {
  const ano = data.getUTCFullYear();
  const mes = String(data.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(data.getUTCDate()).padStart(2, "0");

  return `${ano}${mes}${dia}`;
}

export async function GET() {
  const supabase = await criarClienteSupabaseServer();

  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return NextResponse.json(
      { erro: "Faça login no Oportuna antes de executar o teste." },
      { status: 401 },
    );
  }

  const dataFinal = new Date();

  try {
    const resultado =
      await sincronizarOportunidadesPncp({
        dataFinal: formatarData(dataFinal),

        // 6 = Pregão - Eletrônico
        codigoModalidadeContratacao: 6,

        // Somente para nosso primeiro teste
        uf: "SC",

        maxPaginas: 2,
      });

    return NextResponse.json({
      ok: true,
      periodo: {
        fim: formatarData(dataFinal),
      },
      modalidade: "Pregão - Eletrônico",
      uf: "SC",
      resultado,
    });
  } catch (error) {
    const mensagem =
      error instanceof Error
        ? error.message
        : "Erro desconhecido.";

    return NextResponse.json(
      {
        ok: false,
        erro: mensagem,
      },
      { status: 500 },
    );
  }
}
