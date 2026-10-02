import type { SupabaseClient } from "@supabase/supabase-js";

export type EventoPlano = "atingiu_limite_perfil" | "atingiu_limite_favoritos" |
  "atingiu_limite_score" | "atingiu_limite_ia" | "tentou_ativar_alerta" |
  "clicou_upgrade" | "viu_planos";

export async function registrarEventoPlano(
  supabase: SupabaseClient, usuarioId: string, evento: EventoPlano,
) {
  // Métrica de produto: nunca impede a operação principal se indisponível.
  try {
    await supabase.from("eventos_plano").insert({ usuario_id: usuarioId, evento });
  } catch {
    // Telemetria indisponível não bloqueia a ação solicitada pelo usuário.
  }
}
