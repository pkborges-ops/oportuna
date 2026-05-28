import type { Opportunity, Profile } from "@/types";

type AnaliseGerada = {
  score: number;
  justificativa: string;
  resumo: string;
  pontos_atencao: string[];
};

function obterTextoResposta(response: unknown) {
  if (
    response &&
    typeof response === "object" &&
    "output_text" in response &&
    typeof response.output_text === "string"
  ) {
    return response.output_text;
  }

  const output = (response as { output?: unknown[] }).output;

  if (!Array.isArray(output)) {
    return "";
  }

  return output
    .flatMap((item) =>
      Array.isArray((item as { content?: unknown[] }).content)
        ? ((item as { content: unknown[] }).content ?? [])
        : [],
    )
    .map((content) =>
      typeof (content as { text?: unknown }).text === "string"
        ? (content as { text: string }).text
        : "",
    )
    .join("");
}

function validarAnalise(valor: unknown): AnaliseGerada {
  const analise = valor as Partial<AnaliseGerada>;

  return {
    score: Math.min(100, Math.max(0, Number(analise.score ?? 0))),
    justificativa: String(analise.justificativa ?? "").slice(0, 500),
    resumo: String(analise.resumo ?? "").slice(0, 800),
    pontos_atencao: Array.isArray(analise.pontos_atencao)
      ? analise.pontos_atencao.map(String).slice(0, 5)
      : [],
  };
}

async function obterMensagemErro(response: Response) {
  const texto = await response.text();

  try {
    const data = JSON.parse(texto) as {
      error?: {
        code?: string;
        message?: string;
        type?: string;
      };
    };
    const erro = data.error;

    if (erro?.code === "insufficient_quota") {
      return "A conta OpenAI esta sem cota ou credito disponivel.";
    }

    if (response.status === 401) {
      return "A chave OPENAI_API_KEY nao foi aceita pela OpenAI.";
    }

    if (response.status === 404) {
      return "O modelo configurado em OPENAI_MODEL nao esta disponivel.";
    }

    return erro?.message ?? "Nao foi possivel gerar a analise por IA.";
  } catch {
    return "Nao foi possivel gerar a analise por IA.";
  }
}

export async function gerarAnaliseOportunidade({
  oportunidade,
  perfil,
}: {
  oportunidade: Opportunity;
  perfil: Profile;
}) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("Configure OPENAI_API_KEY no ambiente.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-5.1",
      instructions:
        "Voce analisa aderencia entre empresas brasileiras e oportunidades de editais. Responda apenas com JSON valido no schema solicitado.",
      input: JSON.stringify({
        perfil: {
          nomeEmpresa: perfil.nomeEmpresa,
          cnpj: perfil.cnpj,
          segmento: perfil.segmento,
          porte: perfil.porte,
          uf: perfil.uf,
          palavrasChave: perfil.palavrasChave,
        },
        oportunidade: {
          titulo: oportunidade.titulo,
          orgao: oportunidade.orgao,
          modalidade: oportunidade.modalidade,
          uf: oportunidade.uf,
          cidade: oportunidade.cidade,
          objeto: oportunidade.objeto,
          valorEstimado: oportunidade.valorEstimado,
          dataPublicacao: oportunidade.dataPublicacao,
          dataAbertura: oportunidade.dataAbertura,
          status: oportunidade.status,
          tags: oportunidade.tags,
        },
        tarefa:
          "Gere um score de 0 a 100, uma justificativa curta, um resumo objetivo da oportunidade e pontos de atencao comerciais/tecnicos.",
      }),
      max_output_tokens: 700,
      text: {
        format: {
          type: "json_schema",
          name: "analise_oportunidade",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["score", "justificativa", "resumo", "pontos_atencao"],
            properties: {
              score: {
                type: "integer",
                minimum: 0,
                maximum: 100,
              },
              justificativa: {
                type: "string",
              },
              resumo: {
                type: "string",
              },
              pontos_atencao: {
                type: "array",
                items: {
                  type: "string",
                },
                minItems: 1,
                maxItems: 5,
              },
            },
          },
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(await obterMensagemErro(response));
  }

  const data = await response.json();
  const texto = obterTextoResposta(data);

  return validarAnalise(JSON.parse(texto));
}
