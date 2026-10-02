export type PlanCode = "FREE" | "PRO";

export type Entitlements = Readonly<{
  maxProfiles: number;
  maxFavorites: number | null;
  dailyMatchViews: number | null;
  aiAnalysisLimit: number | null;
  alertsEnabled: boolean;
  historyDays: number | null;
  maxUsers: number;
}>;

const ENTITLEMENTS: Record<PlanCode, Entitlements> = {
  FREE: {
    maxProfiles: 1,
    maxFavorites: 5,
    dailyMatchViews: 3,
    aiAnalysisLimit: 1,
    alertsEnabled: false,
    historyDays: 30,
    maxUsers: 1,
  },
  PRO: {
    maxProfiles: 3,
    maxFavorites: null,
    dailyMatchViews: null,
    // Configurado na assinatura. Até lá, não presumimos uma franquia comercial.
    aiAnalysisLimit: null,
    alertsEnabled: true,
    historyDays: null,
    maxUsers: 1,
  },
};

export function resolvePlanCode(value: unknown): PlanCode {
  return value === "PRO" ? "PRO" : "FREE";
}

export function resolveEffectivePlan(subscription?: {
  plano: string;
  status: string;
  fim_em: string | null;
} | null, now = new Date()): PlanCode {
  return subscription?.plano === "PRO" &&
    (subscription.status === "active" || subscription.status === "trial") &&
    (!subscription.fim_em || new Date(subscription.fim_em).getTime() > now.getTime())
    ? "PRO"
    : "FREE";
}

export function getPlanEntitlements(plan: unknown): Entitlements {
  return ENTITLEMENTS[resolvePlanCode(plan)];
}

export function canReceiveAutomaticAlert(plan: unknown, active: boolean): boolean {
  return active && getPlanEntitlements(plan).alertsEnabled;
}
