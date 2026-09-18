import type { ContratacaoPncp } from "@/services/pncp-service";

function nomeConfere(nome: string | null | undefined, esperado: string) {
  return !nome?.trim() || nome.trim().toLocaleLowerCase("pt-BR") === esperado.toLocaleLowerCase("pt-BR");
}

// Domínios ativos e conformidade consultados na API oficial em 2026-09-18.
export function ehDispensaEletronicaComDisputa(c: ContratacaoPncp) {
  return c.modalidadeId === 8 && c.tipoInstrumentoConvocatorioId === 2 &&
    c.modoDisputaId === 4 &&
    nomeConfere(c.tipoInstrumentoConvocatorioNome, "Aviso de Contratação Direta") &&
    nomeConfere(c.modoDisputaNome, "Dispensa Com Disputa");
}

export function aceitarContratacaoPncp(c: ContratacaoPncp) {
  return c.modalidadeId === 6 || c.modalidadeId === 4 ||
    c.modalidadeId === 12 || ehDispensaEletronicaComDisputa(c);
}
