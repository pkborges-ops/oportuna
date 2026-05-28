import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { obterConfigSupabaseOpcional } from "@/lib/supabase/env";

const rotasAutenticadas = [
  "/dashboard",
  "/perfis",
  "/oportunidades",
  "/favoritos",
  "/configuracoes",
];

const rotasPublicasDeAuth = ["/login", "/cadastro"];

function ehRotaAutenticada(pathname: string) {
  return rotasAutenticadas.some(
    (rota) => pathname === rota || pathname.startsWith(`${rota}/`),
  );
}

function ehRotaPublicaDeAuth(pathname: string) {
  return rotasPublicasDeAuth.includes(pathname);
}

export async function atualizarSessao(request: NextRequest) {
  let response = NextResponse.next({
    request,
  });

  const config = obterConfigSupabaseOpcional();

  if (!config) {
    if (ehRotaAutenticada(request.nextUrl.pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set(
        "erro",
        "Configure as variáveis do Supabase para acessar o painel.",
      );
      return NextResponse.redirect(url);
    }

    return response;
  }

  const { supabaseUrl, supabaseKey } = config;

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );

        response = NextResponse.next({
          request,
        });

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });

        Object.entries(headers).forEach(([key, value]) => {
          response.headers.set(key, value);
        });
      },
    },
  });

  const { pathname } = request.nextUrl;
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (!claims && ehRotaAutenticada(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectedFrom", pathname);
    return NextResponse.redirect(url);
  }

  if (claims && ehRotaPublicaDeAuth(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
