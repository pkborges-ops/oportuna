type OportunidadeParaEmail = {
  titulo: string;
  orgao: string;
  score: number;
  resumo: string;
  participacao?: {
    portal?: string;
    url?: string;
    forma?: string;
    prazoLimite?: string;
    observacoes?: string;
  };
};

type EnviarAlertaParams = {
  destinatario: string;
  nomePerfil: string;
  oportunidades: OportunidadeParaEmail[];
};

type ResendSendResponse = {
  id?: string;
  message?: string;
  name?: string;
};

const mensagemParticipacaoNaoIdentificada =
  "Local de participação não identificado automaticamente. Consulte o edital e os anexos para confirmar onde enviar a proposta ou realizar o credenciamento.";

function formatarDataHora(data?: string) {
  if (!data) {
    return "";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(data));
}

function montarSecaoComoParticipar(oportunidade: OportunidadeParaEmail) {
  const { participacao } = oportunidade;
  const temDados = Boolean(
    participacao?.portal ||
      participacao?.url ||
      participacao?.forma ||
      participacao?.prazoLimite ||
      participacao?.observacoes,
  );

  if (!temDados) {
    return [`Como participar: ${mensagemParticipacaoNaoIdentificada}`];
  }

  return [
    "Como participar:",
    `Portal: ${participacao?.portal ?? "Não informado"}`,
    `Link para participação: ${participacao?.url ?? "Não informado"}`,
    `Forma de participação: ${participacao?.forma ?? "Não informado"}`,
    `Prazo limite: ${
      participacao?.prazoLimite
        ? formatarDataHora(participacao.prazoLimite)
        : "Não informado"
    }`,
    `Observações: ${participacao?.observacoes ?? "Não informado"}`,
  ];
}

function montarConteudoTexto({
  nomePerfil,
  oportunidades,
}: {
  nomePerfil: string;
  oportunidades: OportunidadeParaEmail[];
}) {
  return [
    `Alertas Oportuna para ${nomePerfil}`,
    "",
    ...oportunidades.flatMap((oportunidade, index) => [
      `${index + 1}. ${oportunidade.titulo}`,
      `Órgão: ${oportunidade.orgao}`,
      `Score: ${oportunidade.score}%`,
      `Resumo: ${oportunidade.resumo}`,
      ...montarSecaoComoParticipar(oportunidade),
      "",
    ]),
  ].join("\n");
}

function escaparHtml(valor: string) {
  return valor
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function montarSecaoComoParticiparHtml(oportunidade: OportunidadeParaEmail) {
  const { participacao } = oportunidade;
  const temDados = Boolean(
    participacao?.portal ||
      participacao?.url ||
      participacao?.forma ||
      participacao?.prazoLimite ||
      participacao?.observacoes,
  );

  if (!temDados) {
    return `<p style="margin:8px 0;color:#334155;">${escaparHtml(
      mensagemParticipacaoNaoIdentificada,
    )}</p>`;
  }

  const prazo = participacao?.prazoLimite
    ? formatarDataHora(participacao.prazoLimite)
    : "Não informado";
  const link = participacao?.url
    ? `<p style="margin:16px 0 0;"><a href="${escaparHtml(
        participacao.url,
      )}" style="display:inline-block;background:#22d3ee;color:#0f172a;padding:12px 16px;border-radius:6px;font-weight:700;text-decoration:none;">Acessar participação</a></p>`
    : "";

  return `
    <dl style="display:grid;gap:8px;margin:8px 0;color:#334155;">
      <div><dt style="font-weight:700;">Portal</dt><dd style="margin:0;">${escaparHtml(participacao?.portal ?? "Não informado")}</dd></div>
      <div><dt style="font-weight:700;">Link para participação</dt><dd style="margin:0;">${escaparHtml(participacao?.url ?? "Não informado")}</dd></div>
      <div><dt style="font-weight:700;">Forma de participação</dt><dd style="margin:0;">${escaparHtml(participacao?.forma ?? "Não informado")}</dd></div>
      <div><dt style="font-weight:700;">Prazo limite</dt><dd style="margin:0;">${escaparHtml(prazo)}</dd></div>
      <div><dt style="font-weight:700;">Observações</dt><dd style="margin:0;">${escaparHtml(participacao?.observacoes ?? "Não informado")}</dd></div>
    </dl>
    ${link}
  `;
}

function montarConteudoHtml({
  nomePerfil,
  oportunidades,
}: {
  nomePerfil: string;
  oportunidades: OportunidadeParaEmail[];
}) {
  return `
    <div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.5;">
      <h1 style="font-size:20px;margin:0 0 16px;">Alertas Oportuna para ${escaparHtml(nomePerfil)}</h1>
      ${oportunidades
        .map(
          (oportunidade) => `
            <section style="border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:0 0 16px;">
              <h2 style="font-size:18px;margin:0 0 8px;">${escaparHtml(oportunidade.titulo)}</h2>
              <p style="margin:0 0 4px;color:#475569;">Órgão: ${escaparHtml(oportunidade.orgao)}</p>
              <p style="margin:0 0 8px;font-weight:700;color:#155e75;">${oportunidade.score}% match</p>
              <p style="margin:0 0 16px;color:#334155;">${escaparHtml(oportunidade.resumo)}</p>
              <div style="background:#ecfeff;border:1px solid #a5f3fc;border-radius:8px;padding:14px;">
                <h3 style="font-size:16px;margin:0 0 8px;">Como participar</h3>
                ${montarSecaoComoParticiparHtml(oportunidade)}
              </div>
            </section>
          `,
        )
        .join("")}
    </div>
  `;
}

async function enviarComResend({
  apiKey,
  remetente,
  destinatario,
  assunto,
  conteudoHtml,
  conteudoTexto,
}: {
  apiKey: string;
  remetente: string;
  destinatario: string;
  assunto: string;
  conteudoHtml: string;
  conteudoTexto: string;
}) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: remetente,
      to: [destinatario],
      subject: assunto,
      html: conteudoHtml,
      text: conteudoTexto,
    }),
  });
  const data = (await response.json().catch(() => ({}))) as ResendSendResponse;

  if (!response.ok) {
    const mensagem =
      data.message ?? `Resend retornou HTTP ${response.status}.`;
    console.error("[alertas-email] Erro ao enviar via Resend.", {
      status: response.status,
      mensagem,
      destinatario,
    });
    throw new Error(`Nao foi possivel enviar o alerta por e-mail: ${mensagem}`);
  }

  console.info("[alertas-email] Alerta enviado via Resend.", {
    id: data.id,
    destinatario,
    remetente,
  });

  return data;
}

export async function enviarEmailAlerta({
  destinatario,
  nomePerfil,
  oportunidades,
}: EnviarAlertaParams) {
  const provider = process.env.EMAIL_ALERTS_PROVIDER?.toLowerCase();
  const apiKey = process.env.EMAIL_ALERTS_API_KEY;
  const remetente = process.env.EMAIL_ALERTS_FROM;
  const assunto = `Oportuna: ${oportunidades.length} oportunidade(s) para ${nomePerfil}`;
  const conteudoTexto = montarConteudoTexto({ nomePerfil, oportunidades });
  const conteudoHtml = montarConteudoHtml({ nomePerfil, oportunidades });

  if (!provider || !apiKey || !remetente) {
    console.info("[alertas-email] Serviço de e-mail não configurado.");
    console.info("[alertas-email] Simulando envio de alerta.", {
      destinatario,
      remetente: remetente ?? "não configurado",
      assunto,
      conteudoTexto,
      conteudoHtml,
    });

    return {
      status: "simulado" as const,
      assunto,
      detalhes:
        "Envio simulado; configure EMAIL_ALERTS_PROVIDER, EMAIL_ALERTS_API_KEY e EMAIL_ALERTS_FROM.",
    };
  }

  if (provider === "resend") {
    const data = await enviarComResend({
      apiKey,
      remetente,
      destinatario,
      assunto,
      conteudoHtml,
      conteudoTexto,
    });

    return {
      status: "enviado" as const,
      assunto,
      detalhes: data.id
        ? `Enviado via Resend. ID: ${data.id}`
        : "Enviado via Resend.",
    };
  }

  console.warn("[alertas-email] Provider de e-mail não suportado.", {
    provider,
  });
  console.info("[alertas-email] Simulando envio de alerta.", {
    destinatario,
    remetente,
    assunto,
  });

  return {
    status: "simulado" as const,
    assunto,
    detalhes: `Provider ${provider} não suportado; envio simulado.`,
  };
}
