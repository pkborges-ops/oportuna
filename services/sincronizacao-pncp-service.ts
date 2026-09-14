import { criarClienteSupabaseAdmin } from "@/lib/supabase/admin";
import {
  listarContratacoesPncp,
  type ContratacaoPncp,
  type FiltrosPncp,
} from "@/services/pncp-service";

type StatusOportunidade =
  | "aberta"
  | "em_analise"
  | "encerrada";

type ParametrosSincronizacao = Omit<FiltrosPncp, "pagina"> & {
  maxPaginas?: number;
};

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
  const encerramento = contratacao.dataEncerramentoProposta;

  if (encerramento) {
    const dataEncerramento = new Date(encerramento);

    if (
      !Number.isNaN(dataEncerramento.getTime()) &&
      dataEncerramento.getTime() < Date.now()
    ) {
      return "encerrada";
    }

    return "aberta";
  }

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
  ];

  if (
    situacoesEncerradas.some((termo) =>
      situacao.includes(termo),
    )
  ) {
    return "encerrada";
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

function transformarContratacao(
  contratacao: ContratacaoPncp,
) {
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

    participacao_prazo_limite:
      contratacao.dataEncerramentoProposta ?? null,

    participacao_observacoes:
      contratacao.processo
        ? `Processo ${contratacao.processo}`
        : null,
  };
}

export async function sincronizarOportunidadesPncp({
  dataFinal,
  codigoModalidadeContratacao,
  uf,
  maxPaginas = 20,
}: ParametrosSincronizacao) {
  const supabase = criarClienteSupabaseAdmin();

  let pagina = 1;
  let consultadas = 0;
  let gravadas = 0;
  let ignoradas = 0;
  let paginasProcessadas = 0;

  while (pagina <= maxPaginas) {
    const resultado = await listarContratacoesPncp({
      dataFinal,
      codigoModalidadeContratacao,
      uf,
      pagina,
    });

    paginasProcessadas += 1;
    consultadas += resultado.contratacoes.length;

    const oportunidades = resultado.contratacoes
      .map(transformarContratacao)
      .filter(
        (
          oportunidade,
        ): oportunidade is NonNullable<
          ReturnType<typeof transformarContratacao>
        > => Boolean(oportunidade),
      );

    ignoradas +=
      resultado.contratacoes.length -
      oportunidades.length;

    if (oportunidades.length > 0) {
      const { error } = await supabase
        .from("oportunidades_editais")
        .upsert(oportunidades, {
          onConflict: "codigo",
        });

      if (error) {
        throw new Error(
          `Erro ao salvar oportunidades do PNCP: ${error.message}`,
        );
      }

      gravadas += oportunidades.length;
    }

    const totalPaginas = resultado.totalPaginas ?? pagina;

    if (
      pagina >= totalPaginas ||
      resultado.contratacoes.length === 0
    ) {
      break;
    }

    pagina += 1;
  }

  return {
    consultadas,
    gravadas,
    ignoradas,
    paginasProcessadas,
  };
}
