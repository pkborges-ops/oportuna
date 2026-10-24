import { paidPlanCode, type PlanCode } from "@/lib/planos/catalogo";

export type Entitlements = Readonly<{
  maxProfiles: number | null;
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
  BUSINESS: {
    // Limite comercial ainda pendente: sem teto provisório no banco.
    maxProfiles: null,
    maxFavorites: null,
    dailyMatchViews: null,
    // Franquia efetiva continua configurada por assinatura em franquia_ia.
    aiAnalysisLimit: null,
    alertsEnabled: true,
    historyDays: null,
    // Equipes não estão implementadas; nenhuma vaga extra é liberada agora.
    maxUsers: 1,
  },
};

export function resolvePlanCode(value: unknown): PlanCode {
  return paidPlanCode(value) ?? "FREE";
}

export function resolveEffectivePlan(subscription?: {
  plano: string;
  status: string;
  fim_em: string | null;
} | null, now = new Date()): PlanCode {
  return subscription && paidPlanCode(subscription.plano) &&
    (subscription.status === "active" || subscription.status === "trial") &&
    (!subscription.fim_em || new Date(subscription.fim_em).getTime() > now.getTime())
    ? paidPlanCode(subscription.plano) ?? "FREE"
    : "FREE";
}

export function getPlanEntitlements(plan: unknown): Entitlements {
  return ENTITLEMENTS[resolvePlanCode(plan)];
}

export function canReceiveAutomaticAlert(plan: unknown, active: boolean): boolean {
  return active && getPlanEntitlements(plan).alertsEnabled;
}
