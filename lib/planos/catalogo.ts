import { precoEmCentavos } from "@/lib/billing/validacao";

export type PaidPlanCode = "PRO" | "BUSINESS";
export type PlanCode = "FREE" | PaidPlanCode;

export const PLAN_CATALOG = {
  FREE: { code: "FREE", name: "Free", cycle: null, gateway: null, active: true,
    priceEnv: null, aiQuotaEnv: null },
  PRO: { code: "PRO", name: "Pro", cycle: "MONTHLY", gateway: "ASAAS", active: true,
    priceEnv: "PRO_MONTHLY_PRICE", aiQuotaEnv: "PRO_MONTHLY_AI_LIMIT" },
  BUSINESS: { code: "BUSINESS", name: "Business", cycle: "MONTHLY", gateway: "ASAAS", active: true,
    priceEnv: "BUSINESS_MONTHLY_PRICE", aiQuotaEnv: "BUSINESS_MONTHLY_AI_LIMIT" },
} as const;

function quota(value: string | undefined): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function paidPlanCode(value: unknown): PaidPlanCode | null {
  return value === "PRO" || value === "BUSINESS" ? value : null;
}

export function paidOffer(code: PaidPlanCode, prices: Record<string, string | undefined> = process.env) {
  const plan = PLAN_CATALOG[code];
  const priceCents = precoEmCentavos(prices[plan.priceEnv]);
  if (!plan.active || priceCents === null) return null;
  const aiQuota = quota(prices[plan.aiQuotaEnv]);
  if (code === "BUSINESS") {
    const proQuota = quota(prices[PLAN_CATALOG.PRO.aiQuotaEnv]);
    if (aiQuota === null || proQuota === null || aiQuota <= proQuota) return null;
  }
  return { code: plan.code, name: plan.name, cycle: plan.cycle,
    gateway: plan.gateway, priceCents, aiQuota };
}
