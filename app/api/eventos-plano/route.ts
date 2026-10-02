import { criarClienteSupabaseServer } from "@/lib/supabase/server";

const eventos = new Set([
  "atingiu_limite_perfil", "atingiu_limite_favoritos", "atingiu_limite_score",
  "atingiu_limite_ia", "tentou_ativar_alerta", "clicou_upgrade", "viu_planos",
]);

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return new Response(null, { status: 403 });
  }
  let evento: unknown;
  try {
    ({ evento } = await request.json());
  } catch {
    return new Response(null, { status: 400 });
  }
  if (typeof evento !== "string" || !eventos.has(evento)) {
    return new Response(null, { status: 400 });
  }
  const supabase = await criarClienteSupabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return new Response(null, { status: 401 });
  const resultado = await supabase.from("eventos_plano").insert({
    usuario_id: data.user.id, evento,
  });
  return new Response(null, { status: resultado.error ? 503 : 204 });
}
