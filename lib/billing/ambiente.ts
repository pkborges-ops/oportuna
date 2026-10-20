import { paidOffer } from "@/lib/planos/catalogo";

export type AsaasEnvironment = "sandbox" | "production";

export const ASAAS_ENVIRONMENTS = {
  sandbox: { api: "https://api-sandbox.asaas.com/v3", checkoutHost: "sandbox.asaas.com",
    keyPrefix: "$aact_hmlg_", checkoutPath: /^\/(?:000\/)?checkoutSession\// },
  production: { api: "https://api.asaas.com/v3", checkoutHost: "asaas.com",
    keyPrefix: "$aact_prod_", checkoutPath: /^\/checkoutSession\// },
} as const;
export const HOMOLOG_SUPABASE_URL = "https://uzmgxxhiedevsxedgqij.supabase.co";

export function asaasEnvironment(value: unknown): AsaasEnvironment {
  if (value !== "sandbox" && value !== "production") throw new Error("Ambiente Asaas invalido.");
  return value;
}

export function configAsaas(env: Record<string, string | undefined>) {
  const environment = asaasEnvironment(env.ASAAS_ENVIRONMENT);
  const definition = ASAAS_ENVIRONMENTS[environment];
  const { ASAAS_API_KEY: apiKey, ASAAS_WEBHOOK_TOKEN: webhookToken, APP_BASE_URL: appUrl } = env;
  if (!apiKey?.startsWith(definition.keyPrefix) || apiKey.length < definition.keyPrefix.length + 10 || /\s/.test(apiKey) ||
    !webhookToken || webhookToken.length < 32 || webhookToken.length > 255 ||
    /\s/.test(webhookToken) || webhookToken === apiKey || !appUrl) {
    throw new Error("Configuracao Asaas incompleta ou incompativel.");
  }
  if (environment === "sandbox") {
    if (env.NEXT_PUBLIC_SUPABASE_URL !== HOMOLOG_SUPABASE_URL || env.VERCEL_ENV === "production") {
      throw new Error("Sandbox permitido somente em homologacao.");
    }
  } else {
    const pinnedUrl = env.ASAAS_PRODUCTION_SUPABASE_URL;
    if (env.ASAAS_PRODUCTION_ENABLED !== "true" ||
      !pinnedUrl || !/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(pinnedUrl) ||
      pinnedUrl === HOMOLOG_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL !== pinnedUrl ||
      (env.VERCEL_ENV !== undefined && env.VERCEL_ENV !== "production")) {
      throw new Error("Billing de producao nao habilitado ou incompativel.");
    }
    if (!paidOffer("PRO", env)?.aiQuota || !paidOffer("BUSINESS", env)) {
      throw new Error("Precos e franquias de producao nao configurados.");
    }
  }
  const origin = new URL(appUrl);
  const local = ["localhost", "127.0.0.1"].includes(origin.hostname);
  if (origin.username || origin.password || origin.port && !local || origin.search || origin.hash ||
    origin.pathname !== "/" || (origin.protocol !== "https:" &&
      !(environment === "sandbox" && local && origin.protocol === "http:")) ||
    environment === "production" && local) {
    throw new Error("APP_BASE_URL invalida para o ambiente.");
  }
  return { environment, apiUrl: definition.api, apiKey, webhookToken, baseUrl: origin.origin };
}

export function urlAsaas(path: string, environment: AsaasEnvironment): string {
  if (typeof path !== "string" || !/^\/(?!\/)/.test(path) || /[\\\s#]/.test(path)) {
    throw new Error("Caminho Asaas invalido.");
  }
  const base = ASAAS_ENVIRONMENTS[asaasEnvironment(environment)].api;
  const url = new URL(base + path);
  if (url.origin !== new URL(base).origin || !url.pathname.startsWith("/v3/")) {
    throw new Error("Caminho Asaas invalido.");
  }
  return url.toString();
}
