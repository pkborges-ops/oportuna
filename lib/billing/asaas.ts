import "server-only";

import { configAsaas, urlAsaas } from "@/lib/billing/ambiente";

export function obterConfigAsaas() {
  return configAsaas(process.env);
}

export async function chamarAsaas<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { apiKey, environment } = obterConfigAsaas();
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("content-type", "application/json");
  headers.set("user-agent", `Oportuna/1.0 (${environment})`);
  headers.set("access_token", apiKey);
  const response = await fetch(urlAsaas(path, environment), {
    ...init,
    redirect: "error",
    headers,
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!response.ok) {
    // Nao incluir corpo nem headers: alguns erros de provedor podem refletir PII.
    throw new Error(`Asaas retornou HTTP ${response.status}.`);
  }
  return response.json() as Promise<T>;
}
