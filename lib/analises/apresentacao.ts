// Comparação visual conservadora. Não altera hashes persistidos nem o contrato de geração.
export function snapshotsEquivalentes(a: unknown, b: unknown): boolean {
  function normalizar(value: unknown): unknown {
    if (typeof value === "string") return value.trim().replace(/\s+/g, " ");
    if (Array.isArray(value)) return value.map(normalizar);
    if (value && typeof value === "object") return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, normalizar(v)]));
    return value;
  }
  return a != null && b != null && JSON.stringify(normalizar(a)) === JSON.stringify(normalizar(b));
}
export function nomeHistorico(snapshot: unknown): string | undefined {
  if (!snapshot || typeof snapshot !== "object" || !("perfil" in snapshot)) return;
  const perfil = snapshot.perfil;
  if (perfil && typeof perfil === "object" && "nomeEmpresa" in perfil && typeof perfil.nomeEmpresa === "string") {
    return perfil.nomeEmpresa;
  }
}
export const mensagensIA: Record<string, string> = {
  LIMITE_ATINGIDO: "Limite de análises por IA atingido.",
  CICLO_NAO_AUTORIZADO: "O ciclo da assinatura ainda não está disponível para análises. Consulte a situação da assinatura e tente novamente mais tarde.",
  EM_ANDAMENTO: "Estamos analisando os dados disponíveis.",
  INCERTA: "Estamos verificando o resultado desta análise. Não inicie outra geração. A reserva permanece retida até a verificação.",
  FALHOU: "Não foi possível concluir a análise. Nenhuma unidade foi consumida. Você pode tentar novamente.",
  TEMPORARIO: "Não foi possível consultar ou preparar a análise agora. Consulte o estado antes de tentar novamente.",
  CONCLUIDA: "Análise concluída e salva.",
  EXISTENTE: "Análise existente reutilizada, sem novo consumo.",
};
