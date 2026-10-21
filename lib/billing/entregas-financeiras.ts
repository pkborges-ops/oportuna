import "server-only";

import { criarClienteSupabaseAdmin } from "@/lib/supabase/admin";
import type { ResultadoEntregaFinanceira } from "@/lib/billing/contrato-concessao";

type ClienteFinanceiro = {
  rpc: (nome: string, argumentos: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Chamavel por worker de servico, sem webhook novo e sem credencial/chamada Asaas.
// Nao e Server Action nem rota publica; agendamento operacional fica para a integracao IA.
export async function recuperarEntregasFinanceiras(limite = 20, cliente?: ClienteFinanceiro) {
  const ambiente = process.env.ASAAS_ENVIRONMENT;
  if ((ambiente !== "sandbox" && ambiente !== "production") ||
    !Number.isInteger(limite) || limite < 1 || limite > 100) {
    throw new Error("Configuracao de recuperacao financeira invalida.");
  }
  const banco = cliente ?? criarClienteSupabaseAdmin();
  const { data, error } = await banco.rpc("billing_concessoes_reservar_entregas_v1", {
    p_ambiente: ambiente, p_limite: limite,
  });
  if (error || !Array.isArray(data) || data.some(item =>
    !item || typeof item.entrega_id !== "string" || !UUID.test(item.entrega_id) ||
    typeof item.token !== "string" || !UUID.test(item.token))) {
    throw new Error("Nao foi possivel reservar entregas financeiras.");
  }
  const resumo = { reservadas: data.length, entregues: 0, duplicadas: 0, pendentes: 0, obsoletas: 0, falhas: 0 };
  for (const item of data) {
    try {
      const result = await banco.rpc("billing_concessoes_entregar_v1", {
        p_ambiente: ambiente, p_entrega: item.entrega_id, p_token: item.token,
      });
      if (result.error) { resumo.falhas++; continue; }
      const estado = result.data as ResultadoEntregaFinanceira;
      if (estado === "delivered") resumo.entregues++;
      else if (estado === "duplicate") resumo.duplicadas++;
      else if (estado === "pending") resumo.pendentes++;
      else if (["stale", "lease_lost", "not_found"].includes(estado)) resumo.obsoletas++;
      else { resumo.falhas++; }
    } catch {
      // Resultado incerto: nao confirmar entrega; o lease expira e permite recuperar.
      resumo.falhas++;
    }
  }
  return resumo;
}
