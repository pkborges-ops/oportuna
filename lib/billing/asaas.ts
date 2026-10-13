import "server-only";

const SANDBOX_API = "https://api-sandbox.asaas.com/v3";

export function obterConfigAsaas() {
  if (process.env.ASAAS_ENVIRONMENT !== "sandbox") {
    throw new Error("A integracao Asaas desta branch aceita somente Sandbox.");
  }
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !==
      "https://uzmgxxhiedevsxedgqij.supabase.co") {
    throw new Error("Billing Sandbox permitido somente no Supabase de homologacao.");
  }
  const apiKey = process.env.ASAAS_API_KEY;
  const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN;
  const baseUrl = process.env.APP_BASE_URL;
  if (!apiKey?.startsWith("$aact_hmlg_") || !webhookToken || !baseUrl ||
    webhookToken.length < 32 || webhookToken.length > 255 ||
    /\s/.test(webhookToken) || webhookToken === apiKey) {
    throw new Error("Configuracao Asaas Sandbox incompleta.");
  }
  const origin = new URL(baseUrl);
  if (!(["https:", "http:"].includes(origin.protocol)) ||
    (origin.protocol === "http:" && !["localhost", "127.0.0.1"].includes(origin.hostname))) {
    throw new Error("APP_BASE_URL precisa usar HTTPS fora de localhost.");
  }
  return { apiKey, webhookToken, baseUrl: origin.origin };
}

export async function chamarAsaas<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { apiKey } = obterConfigAsaas();
  const response = await fetch(`${SANDBOX_API}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "Oportuna/1.0 (Sandbox)",
      access_token: apiKey,
      ...init.headers,
    },
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!response.ok) {
    // Nao incluir corpo nem headers: alguns erros de provedor podem refletir PII.
    throw new Error(`Asaas Sandbox retornou HTTP ${response.status}.`);
  }
  return response.json() as Promise<T>;
}
