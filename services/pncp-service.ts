const PNCP_BASE_URL = "https://pncp.gov.br/api/consulta";
const MAX_TENTATIVAS = 3;
const TIMEOUT_TENTATIVA_MS = 6_000;

async function consultarPncp(url: URL): Promise<{ status: number; corpo: string }> {
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa += 1) {
    let response: Response | undefined;
    let falhaTransporte = false;
    let timeout = false;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      timeout = true;
      controller.abort();
    }, TIMEOUT_TENTATIVA_MS);

    try {
      response = await fetch(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });

      if (response.ok) {
        // Manter o timeout ativo também durante a leitura do corpo.
        const corpo = response.status === 204 ? "" : await response.text();
        return { status: response.status, corpo };
      }
    } catch {
      // Não registrar o erro bruto: ele pode conter dados da requisição.
      falhaTransporte = true;
    } finally {
      clearTimeout(timer);
      // Liberar a conexão, inclusive em falhas durante a leitura do corpo.
      if (falhaTransporte || (response && !response.ok)) {
        controller.abort();
      }
    }

    const motivo = falhaTransporte
      ? timeout
        ? "timeout da chamada"
        : "erro de rede"
      : `HTTP ${response?.status}`;
    const podeRepetir =
      falhaTransporte || response?.status === 429 || (response?.status ?? 0) >= 500;
    const repetir = podeRepetir && tentativa < MAX_TENTATIVAS;
    const esperaMs = repetir ? 500 * tentativa : 0;

    console.warn("[pncp] Falha na consulta.", {
      pagina: url.searchParams.get("pagina"),
      tentativa,
      maxTentativas: MAX_TENTATIVAS,
      motivo,
      repetir,
      esperaMs,
    });

    if (!repetir) {
      throw new Error(`Erro ao consultar PNCP: ${motivo}`);
    }

    await new Promise((resolve) => setTimeout(resolve, esperaMs));
  }

  throw new Error("Erro ao consultar PNCP: tentativas esgotadas.");
}

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
  /** @deprecated O endpoint de propostas utiliza apenas dataFinal. */
  dataInicial?: Date | string;
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
  dataFinal,
  codigoModalidadeContratacao,
  pagina = 1,
  uf,
}: FiltrosPncp) {
  const url = new URL(
    `${PNCP_BASE_URL}/v1/contratacoes/proposta`,
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

  const response = await consultarPncp(url);

  if (response.status === 204) {
    return {
      contratacoes: [],
      pagina,
      totalPaginas: 0,
      totalRegistros: 0,
      paginasRestantes: 0,
    };
  }

  const dados = JSON.parse(response.corpo) as RespostaPncp;

  return {
    contratacoes: dados.data ?? [],
    pagina: dados.numeroPagina ?? pagina,
    totalPaginas: dados.totalPaginas ?? 1,
    totalRegistros: dados.totalRegistros ?? 0,
    paginasRestantes: dados.paginasRestantes ?? 0,
  };
}
