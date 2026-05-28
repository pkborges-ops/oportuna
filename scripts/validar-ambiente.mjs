import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const env = { ...process.env };
const envLocalPath = join(process.cwd(), ".env.local");

if (existsSync(envLocalPath)) {
  const linhas = readFileSync(envLocalPath, "utf8").split(/\r?\n/);

  for (const linha of linhas) {
    const limpa = linha.trim();

    if (!limpa || limpa.startsWith("#") || !limpa.includes("=")) {
      continue;
    }

    const [chave, ...partesValor] = limpa.split("=");
    env[chave] ??= partesValor.join("=").replace(/^["']|["']$/g, "");
  }
}

const obrigatorias = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
];
const faltando = obrigatorias.filter((chave) => !env[chave]);

if (faltando.length > 0) {
  console.error(
    `Variáveis obrigatórias ausentes: ${faltando.join(", ")}. Configure no .env.local ou nas Environment Variables da Vercel.`,
  );
  process.exit(1);
}

try {
  new URL(env.NEXT_PUBLIC_SUPABASE_URL);
} catch {
  console.error("NEXT_PUBLIC_SUPABASE_URL deve ser uma URL válida.");
  process.exit(1);
}

if (!env.OPENAI_API_KEY) {
  console.warn(
    "OPENAI_API_KEY ausente: análises novas por IA não serão geradas, mas alertas usam análises persistidas.",
  );
}

if (
  !env.EMAIL_ALERTS_PROVIDER ||
  !env.EMAIL_ALERTS_API_KEY ||
  !env.EMAIL_ALERTS_FROM
) {
  console.warn(
    "Serviço de e-mail não configurado: alertas continuarão em modo simulação.",
  );
}

if (env.NODE_ENV === "production" && !env.CRON_SECRET) {
  console.warn(
    "CRON_SECRET ausente: configure esta variável na Vercel para proteger o endpoint de alertas.",
  );
}
