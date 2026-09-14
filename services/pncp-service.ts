const PNCP_BASE_URL = "https://pncp.gov.br/api/consulta";

export type ContratacaoPncp = {
  numeroControlePNCP?: string;
  numeroCompra?: string;
  anoCompra?: number;
  processo?: string;
  objetoCompra?: string;
  valorTotalEstimado?: number;
  modalidadeId?: number;
  modalidadeNome?: string;
  dataPublicacaoPncp?: string;
  dataAberturaProposta?: string;
  dataEncerramentoProposta?: string;
  situacaoCompraNome?: string;

  orgaoEntidade?: {
    cnpj?: string;
    razaoSocial?: string;
  };

  unidadeOrgao?: {
    nomeUnidade?: string;
    municipioNome?: string;
    ufSigla?: string;
    codigoIbge?: string;
  };
};

type RespostaPncp = {
  data?: ContratacaoPncp[];
  totalPaginas?: number;
  totalRegistros?: number;
  numeroPagina?: number;
  paginasRestantes?: number;
};

export type FiltrosPncp = {
  dataInicial: Date | string;
  dataFinal: Date | string;
  codigoModalidadeContratacao: number;
  pagina?: number;
  uf?: string;
};

function formatarDataPncp(data: Date | string) {
  if (data instanceof Date) {
    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, "0");
    const dia = String(data.getDate()).padStart(2, "0");

    return `${ano}${mes}${dia}`;
  }

  const somenteNumeros = data.replace(/\D/g, "");

  if (somenteNumeros.length !== 8) {
    throw new Error("Data do PNCP deve estar no formato AAAAMMDD.");
  }

  return somenteNumeros;
}

export async function listarContratacoesPncp({
  dataInicial,
  dataFinal,
  codigoModalidadeContratacao,
  pagina = 1,
  uf,
}: FiltrosPncp) {
  const url = new URL(
    `${PNCP_BASE_URL}/v1/contratacoes/publicacao`,
  );

  url.searchParams.set(
    "dataInicial",
    formatarDataPncp(dataInicial),
  );

  url.searchParams.set(
    "dataFinal",
    formatarDataPncp(dataFinal),
  );

  url.searchParams.set(
    "codigoModalidadeContratacao",
    String(codigoModalidadeContratacao),
  );

  url.searchParams.set(
    "pagina",
    String(pagina),
  );

  if (uf?.trim()) {
    url.searchParams.set(
      "uf",
      uf.trim().toUpperCase(),
    );
  }

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Erro ao consultar PNCP: HTTP ${response.status}`,
    );
  }

  const dados = (await response.json()) as RespostaPncp;

  return {
    contratacoes: dados.data ?? [],
    pagina: dados.numeroPagina ?? pagina,
    totalPaginas: dados.totalPaginas ?? 1,
    totalRegistros: dados.totalRegistros ?? 0,
    paginasRestantes: dados.paginasRestantes ?? 0,
  };
}