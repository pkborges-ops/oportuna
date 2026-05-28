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
3. No Supabase Auth, adicione a URL de produção da Vercel em Site URL e Redirect URLs, incluindo `/auth/confirm`.
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
