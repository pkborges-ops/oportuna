import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { criarClienteSupabaseServer } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const redirectTo = request.nextUrl.clone();

  redirectTo.pathname = "/dashboard";
  redirectTo.search = "";

  if (tokenHash && type) {
    const supabase = await criarClienteSupabaseServer();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });

    if (!error) {
      return NextResponse.redirect(redirectTo);
    }
  }

  redirectTo.pathname = "/login";
  redirectTo.searchParams.set(
    "erro",
    "Não foi possível confirmar seu e-mail. Solicite um novo link.",
  );

  return NextResponse.redirect(redirectTo);
}
