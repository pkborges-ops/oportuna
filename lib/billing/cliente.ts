import type { DadosPagador } from "@/lib/billing/validacao";

export type Reservation = { state: string; id?: string; customer_id?: string; url?: string };
type CustomerPayload = {
  name: string; cpfCnpj: string; email: string; mobilePhone: string;
  postalCode: string; addressNumber: string; complement?: string; externalReference: string;
};
type Customer = { id: string } & Partial<CustomerPayload>;
export type ClienteDependencies = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<Reservation>;
  chamarAsaas: <T>(path: string, init?: RequestInit) => Promise<T>;
};

export function payloadCliente(usuarioId: string, pagador: DadosPagador): CustomerPayload {
  return { name: pagador.nome, cpfCnpj: pagador.documento, email: pagador.email,
    mobilePhone: pagador.celular, postalCode: pagador.cep, addressNumber: pagador.numero,
    ...(pagador.complemento ? { complement: pagador.complemento } : {}),
    externalReference: usuarioId };
}

async function atualizarCliente(cliente: Customer, payload: CustomerPayload,
  chamarAsaas: ClienteDependencies["chamarAsaas"]): Promise<string> {
  if (!cliente.id || cliente.externalReference !== payload.externalReference) {
    throw new Error("Cliente nao corresponde ao usuario.");
  }
  const alteracoes = Object.fromEntries(Object.entries(payload).filter(([key, value]) => {
    const atual = cliente[key as keyof CustomerPayload];
    return (key === "cpfCnpj" || key === "mobilePhone" || key === "postalCode")
      ? String(atual ?? "").replace(/\D/g, "") !== value
      : atual !== value;
  }));
  if (Object.keys(alteracoes).length) {
    const atualizado = await chamarAsaas<Customer>(`/customers/${encodeURIComponent(cliente.id)}`, {
      method: "PUT", body: JSON.stringify(alteracoes),
    });
    if (atualizado.id !== cliente.id || atualizado.externalReference !== payload.externalReference) {
      throw new Error("Resposta de cliente inconsistente.");
    }
  }
  return cliente.id;
}

export async function obterCliente(usuarioId: string, pagador: DadosPagador,
  { rpc, chamarAsaas }: ClienteDependencies): Promise<string> {
  const payload = payloadCliente(usuarioId, pagador);
  const reserva = await rpc("billing_reservar_cliente_v1", { p_usuario: usuarioId });
  if (reserva.state === "ready" && reserva.customer_id) {
    const cliente = await chamarAsaas<Customer>(`/customers/${encodeURIComponent(reserva.customer_id)}`);
    if (cliente.id !== reserva.customer_id) throw new Error("Resposta de cliente inconsistente.");
    return atualizarCliente(cliente, payload, chamarAsaas);
  }
  if (reserva.state === "busy") throw new Error("Cadastro em andamento. Aguarde e tente novamente.");
  if (!reserva.id || !["claim", "reconcile"].includes(reserva.state)) {
    throw new Error("Cadastro de pagamento indisponivel.");
  }
  try {
    const encontrados = await chamarAsaas<{ data: Customer[] }>(
      `/customers?externalReference=${encodeURIComponent(usuarioId)}&limit=2`);
    if (encontrados.data.length > 1) throw new Error("Cliente duplicado no Asaas: revisao necessaria.");
    if (encontrados.data.length === 1) {
      const id = await atualizarCliente(encontrados.data[0], payload, chamarAsaas);
      await rpc("billing_salvar_cliente_v1", { p_id: reserva.id, p_gateway_id: id });
      return id;
    }
    // Ausencia apos timeout nao prova que o POST anterior nao sera concluido.
    if (reserva.state === "reconcile") {
      throw new Error("Cadastro ainda em conciliacao. Nenhum novo cliente foi criado.");
    }
    const cliente = await chamarAsaas<Customer>("/customers", {
      method: "POST", body: JSON.stringify(payload),
    });
    if (!cliente.id || cliente.externalReference !== usuarioId) throw new Error("Resposta de cliente incompleta.");
    await rpc("billing_salvar_cliente_v1", { p_id: reserva.id, p_gateway_id: cliente.id });
    return cliente.id;
  } catch (error) {
    await rpc("billing_cliente_incerteza_v1", { p_id: reserva.id });
    throw error;
  }
}
