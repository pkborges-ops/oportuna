import "server-only";

import type { PaidPlanCode } from "@/lib/planos/catalogo";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Somente identidade autenticada e configuração do servidor. Não recebe Request/FormData.
// Desabilitar ou omitir o canário fecha novos checkouts produtivos; não libera o público.
export function checkoutPermitido(
  usuarioId: string | null | undefined, planCode: PaidPlanCode,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!usuarioId || (planCode !== "PRO" && planCode !== "BUSINESS")) return false;
  if (env.ASAAS_ENVIRONMENT === "sandbox") return env.VERCEL_ENV !== "production";
  if (env.ASAAS_ENVIRONMENT !== "production" || env.BILLING_CANARY_ENABLED !== "true") return false;
  const canaryId = env.BILLING_CANARY_USER_ID;
  return planCode === "PRO" && Boolean(canaryId?.length === 36 && usuarioId.length === 36 &&
    UUID.test(canaryId) && UUID.test(usuarioId) &&
    canaryId.toLowerCase() === usuarioId.toLowerCase());
}
