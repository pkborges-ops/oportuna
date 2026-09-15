This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Alertas por e-mail

Execute `supabase/alertas_email.sql` no SQL Editor do Supabase para criar as regras de alerta e o historico de envios.
Execute `supabase/participacao_oportunidades.sql` para adicionar os campos opcionais da seção "Como participar".
Execute `supabase/alertas_monitoramento.sql` para adicionar os contadores de monitoramento dos alertas, caso a tabela já exista.

Enquanto o serviço de e-mail não estiver configurado, os alertas rodam em modo de simulação e registram logs no servidor.

Variáveis para testar com Resend:

```bash
EMAIL_ALERTS_PROVIDER=resend
EMAIL_ALERTS_API_KEY=re_...
EMAIL_ALERTS_FROM="Oportuna <onboarding@resend.dev>"
```

Para testar eventos sem domínio próprio, configure o e-mail do alerta como `delivered@resend.dev` ou outro endereço de teste `@resend.dev`. Para enviar para clientes reais, verifique um domínio na Resend e troque apenas `EMAIL_ALERTS_FROM` para um remetente desse domínio, por exemplo `Oportuna <alertas@seudominio.com.br>`.

Sem `OPENAI_API_KEY`, os alertas usam apenas análises já persistidas e ignoram oportunidades sem análise.

Para oportunidades já cadastradas, preencha os campos `participacao_*` somente com portal, link, forma, prazo e observações confirmados no edital ou anexos. Quando esses dados não existirem, o sistema mostra uma orientação de conferência manual.

## Deploy na Vercel

Checklist curto:

1. Execute os scripts SQL da pasta `supabase/` no projeto Supabase de produção.
2. Cadastre as variáveis abaixo em Settings > Environment Variables na Vercel para Production e Preview.
3. No Supabase Auth, adicione a URL de produção da Vercel em Site URL e Redirect URLs, incluindo `/auth/confirm` e `/auth/callback`.
4. Rode `npm run lint`, `npm run check:env` e `npm run build` antes do deploy.
5. Faça o deploy pela integração Git da Vercel ou com `vercel --prod`.
6. Confirme em Settings > Cron Jobs se `/api/cron/alertas` está ativo.

Variáveis obrigatórias:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

Variáveis opcionais:

```bash
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.1
EMAIL_ALERTS_PROVIDER=
EMAIL_ALERTS_API_KEY=
EMAIL_ALERTS_FROM=alertas@seudominio.com.br
CRON_SECRET=
```

Sem `OPENAI_API_KEY`, o sistema continua rodando e apenas deixa de gerar análises novas por IA. Sem `EMAIL_ALERTS_PROVIDER`, `EMAIL_ALERTS_API_KEY` ou `EMAIL_ALERTS_FROM`, os alertas continuam em modo simulação com logs no servidor.

### Login com Google

No Supabase, habilite o provider em Authentication > Sign In / Providers > Google e informe o Client ID e Client Secret criados no Google Cloud Console.

No Google Cloud Console, cadastre a Authorized redirect URI exibida pelo Supabase para o provider Google. Ela normalmente segue o formato:

```bash
https://SEU-PROJETO.supabase.co/auth/v1/callback
```

No Supabase Auth, mantenha também estas Redirect URLs da aplicação:

```bash
https://oportuna-two.vercel.app/auth/callback
https://oportuna-two.vercel.app/auth/confirm
```

## Execução automática dos alertas

O arquivo `vercel.json` agenda `/api/cron/alertas` diariamente às 11:00 UTC. A rota busca alertas ativos e decide por regra se cada alerta deve rodar conforme a frequência configurada:

- diária: executa se a última execução tiver mais de 24 horas;
- semanal: executa se a última execução tiver mais de 7 dias;
- sem execução anterior: executa no próximo cron.

Na Vercel, cadastre `CRON_SECRET` com uma string aleatória. A Vercel envia esse valor no header `Authorization: Bearer <CRON_SECRET>`.

Para testar localmente sem `CRON_SECRET`, acesse:

```bash
curl http://localhost:3000/api/cron/alertas
```

Para forçar a execução ignorando a frequência:

```bash
curl "http://localhost:3000/api/cron/alertas?forcar=true"
```

## Desenvolvimento

Use `.env.example` como base para o `.env.local`.

```bash
npm run check:env
npm run lint
npm run build
```

## Origem e tipo das oportunidades

O contrato central continua sendo `Opportunity`, persistido na tabela histórica
`oportunidades_editais`. Cada fonte deve normalizar seus dados antes de gravá-los.
O PNCP usa `transformarContratacao` no sincronizador existente, informando
explicitamente `origem: "PNCP"` e o `tipo` definido em
`lib/oportunidades/classificar-pncp.ts`. Não há integração SICX nesta etapa.

- Origens: `PNCP`, `SICX`, `OUTRA`. A coluna é obrigatória; o default temporário
  `PNCP` da Migration 1 é removido pela Migration 2 após validar a produção.
- Tipos: `LICITACAO`, `CREDENCIAMENTO`, `CONTRATACAO_DIRETA`, `COMPRA_EXPRESSA`,
  `OUTRO`. O default é `OUTRO`.
- Modalidade e portal de participação permanecem campos independentes da origem.
- IDs PNCP 1–7, 13 e 16–19: `LICITACAO`; 8 e 9: `CONTRATACAO_DIRETA`;
  12: `CREDENCIAMENTO`. Demais IDs: `OUTRO`.
- Na ausência de ID, somente nomes/aliases conhecidos são aceitos. Caixa, espaços
  e separadores são normalizados. ID desconhecido ou categorias conflitantes
  resultam em `OUTRO`; título e objeto nunca são usados para classificar.
- O helper `apresentacao-origem.ts` concentra os campos e o link externo PNCP.
  Favoritos, análises e alertas mantêm os relacionamentos pelo UUID da oportunidade.

### Migrations pendentes de revisão e execução manual

1. **Migration 1 — compatibilidade durante o deploy:**
   `supabase/oportunidades_origem_tipo.sql`. Executar uma única vez após revisão,
   sobre o esquema existente (ou após o script base numa instalação nova).
   Adiciona `origem` com default temporário `PNCP`, faz o backfill e aplica
   `NOT NULL`; adiciona `tipo` com default `OUTRO` e classifica os registros atuais.
   O código antigo pode continuar gravando PNCP durante a transição.
2. **Migration 2 — limpeza após publicação:**
   `supabase/oportunidades_origem_sem_default.sql`. Remove apenas o default de
   `origem`. Executar somente depois de confirmar o código novo em produção e
   validar que o sincronizador grava explicitamente `origem: "PNCP"`.
   **Não executar as duas migrations juntas antes da publicação.**

Sequência: revisar os SQLs → commit/push da branch → Preview Vercel → Migration 1
no Supabase → validar Preview → merge/deploy → testar cron PNCP → Migration 2.
O código novo exige as colunas da Migration 1 para funcionar. A compatibilidade
entre as duas etapas elimina a necessidade de pausar o cron no momento do deploy.
Depois da Migration 2, reverter para o importador antigo exige considerar que ele
não informa a origem obrigatória.

Nenhuma migration é executada pelo build ou pela aplicação. O backfill define PNCP
para os registros atuais e classifica pelo nome conhecido. O trigger existente
atualiza `atualizado_em` de todos os registros do backfill. IDs, códigos,
relacionamentos, políticas RLS e análises são preservados. A Migration 1 usa
transação e limite de espera por lock de 5s; se falhar, a transação deve ser
revertida antes de nova tentativa.

`codigo` continua globalmente único e o upsert continua por `codigo`. Antes de
integrar outra fonte, definir namespace para seus códigos ou revisar a unicidade
para `(origem, codigo)`, sem mudar os identificadores PNCP existentes.
