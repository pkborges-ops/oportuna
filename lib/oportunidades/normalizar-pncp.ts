import { classificarPncp } from "@/lib/oportunidades/classificar-pncp";
import { aceitarContratacaoPncp } from "@/lib/oportunidades/filtrar-pncp";
import type { ContratacaoPncp } from "@/services/pncp-service";
type StatusOportunidade =
  | "aberta"
  | "em_analise"
  | "encerrada";



function extrairData(valor?: string) {
  if (!valor) {
    return undefined;
  }

  return valor.slice(0, 10);
}

function obterValor(valor?: number) {
  const numero = Number(valor ?? 0);

  return Number.isFinite(numero) ? numero : 0;
}

function obterStatus(
  contratacao: ContratacaoPncp,
): StatusOportunidade {
  const situacao =
    contratacao.situacaoCompraNome?.toLowerCase() ?? "";

  const situacoesEncerradas = [
    "encerr",
    "homolog",
    "adjudic",
    "revog",
    "anul",
    "desert",
    "fracass",
    "cancel",
  ];

  if (
    situacoesEncerradas.some((termo) =>
      situacao.includes(termo),
    )
  ) {
    return "encerrada";
  }

  const encerramento = contratacao.dataEncerramentoProposta;

  if (encerramento) {
    const dataEncerramento = new Date(encerramento);

    if (
      !Number.isNaN(dataEncerramento.getTime()) &&
      dataEncerramento.getTime() < Date.now()
    ) {
      return "encerrada";
    }
  }

  return "aberta";
}

function criarTitulo(contratacao: ContratacaoPncp) {
  const modalidade =
    contratacao.modalidadeNome ?? "Contratação";

  const numero = contratacao.numeroCompra
    ? String(contratacao.numeroCompra)
    : undefined;

  const ano = contratacao.anoCompra;

  if (numero && ano) {
    return `${modalidade} ${numero}/${ano}`;
  }

  if (numero) {
    return `${modalidade} ${numero}`;
  }

  return modalidade;
}

export function transformarContratacao(
  contratacao: ContratacaoPncp,
) {
  if (!aceitarContratacaoPncp(contratacao)) return null;
  const tipo = classificarPncp(contratacao);
  if (tipo === "OUTRO") return null;
  const codigo = contratacao.numeroControlePNCP?.trim();

  const dataPublicacao = extrairData(
    contratacao.dataPublicacaoPncp,
  );

  if (!codigo || !dataPublicacao) {
    return null;
  }

  const dataAbertura =
    extrairData(contratacao.dataAberturaProposta) ??
    dataPublicacao;

  const uf =
    contratacao.unidadeOrgao?.ufSigla
      ?.trim()
      .toUpperCase() || "NI";

  const modalidade =
    contratacao.modalidadeNome ??
    "Modalidade não informada";

  return {
    codigo,
    origem: "PNCP" as const,
    tipo,

    titulo: criarTitulo(contratacao),

    orgao:
      contratacao.orgaoEntidade?.razaoSocial ??
      contratacao.unidadeOrgao?.nomeUnidade ??
      "Órgão não informado",

    modalidade,

    uf: uf.slice(0, 2),

    cidade:
      contratacao.unidadeOrgao?.municipioNome ??
      "Não informada",

    objeto:
      contratacao.objetoCompra ??
      "Objeto não informado",

    valor_estimado: obterValor(
      contratacao.valorTotalEstimado,
    ),

    data_publicacao: dataPublicacao,

    data_abertura: dataAbertura,

    status: obterStatus(contratacao),

    tags: [modalidade],

    participacao_portal: "PNCP",
    participacao_url: contratacao.linkSistemaOrigem?.trim() || null,

    participacao_prazo_limite:
      contratacao.dataEncerramentoProposta ?? null,

    participacao_observacoes:
      contratacao.processo
        ? `Processo ${contratacao.processo}`
        : null,
  };
}
