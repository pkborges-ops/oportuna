import { NextResponse, type NextRequest } from "next/server";

import { obterDestinoSeguro } from "@/lib/auth/redirect";
import { criarClienteSupabaseServer } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const destino = obterDestinoSeguro(requestUrl.searchParams.get("next"));

  if (code) {
    const supabase = await criarClienteSupabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(new URL(destino, request.url));
    }
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set(
    "erro",
    "Não foi possível entrar com Google. Tente novamente.",
  );

  return NextResponse.redirect(loginUrl);
}
