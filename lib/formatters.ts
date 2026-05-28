export function formatarMoeda(valor: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(valor);
}

export function formatarData(data: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${data}T00:00:00`));
}

export function formatarStatus(status: string) {
  const statusMap: Record<string, string> = {
    aberta: "Aberta",
    em_analise: "Em análise",
    encerrada: "Encerrada",
    ativo: "Ativo",
    inativo: "Inativo",
  };

  return statusMap[status] ?? status;
}
