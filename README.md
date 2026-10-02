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

## Planos Free, Pro e Business com Asaas Sandbox

Esta branch integra somente o Sandbox do Asaas com o Supabase de homologação
`uzmgxxhiedevsxedgqij`. O código recusa outra combinação. Não configure a
chave Asaas de produção e não execute `supabase/asaas_assinaturas_v1.sql` em
produção nesta etapa. A migration preserva as migrations anteriores e deve ser aplicada **manualmente
apenas em homologação**, depois de `planos_e_permissoes_v1.sql`.

Crie uma conta separada em [Asaas Sandbox](https://sandbox.asaas.com), entre
como administrador e gere a chave em **Integrações → Chave de API**. Guarde-a
somente no gerenciador de secrets ou nas variáveis locais. No Asaas Sandbox,
cadastre um Webhook para `https://SEU-HOST-DE-HOMOLOGACAO/api/webhooks/asaas`,
com token de autenticação próprio (32–255 caracteres), envio sequencial e os
eventos Checkout, assinatura e cobrança tratados na migration. O endpoint
precisa ser HTTPS público; `localhost` não recebe notificações do Asaas.

Variáveis do servidor (não coloque valores no Git nem no chat):

```text
ASAAS_ENVIRONMENT=sandbox
ASAAS_API_KEY=<chave do Sandbox>
ASAAS_WEBHOOK_TOKEN=<mesmo authToken configurado no Webhook>
PRO_MONTHLY_PRICE=99.00
BUSINESS_MONTHLY_PRICE=197.00
PRO_MONTHLY_AI_LIMIT=200
BUSINESS_MONTHLY_AI_LIMIT=1000
APP_BASE_URL=https://SEU-HOST-DE-HOMOLOGACAO
SUPABASE_SECRET_KEY=<chave secret do Supabase de homologação>
```

Os preços de R$ 99,00 (Pro) e R$ 197,00 (Business) e as franquias de 200 e
1.000 análises/mês são valores de teste do Sandbox. Ajuste essas quatro
variáveis no ambiente de homologação para mudá-los; não é necessária migration.
O Free permanece gratuito e não cria Checkout.

`NEXT_PUBLIC_SUPABASE_URL` deve apontar para o projeto de homologação. A chave
Asaas usa o header `access_token` apenas no servidor; o webhook usa o header
`asaas-access-token`. Não existe `NEXT_PUBLIC_ASAAS_API_KEY`. O preço é lido
do catálogo server-side `PLAN_CATALOG` por plano. Sem preço válido para um plano,
o botão de contratação correspondente fica indisponível. FREE nunca cria
checkout. O navegador envia apenas `plan=PRO` ou `plan=BUSINESS`; nome, ciclo
e preço são resolvidos no servidor. Business só é contratável quando as duas
franquias mensais de IA estão configuradas e a sua é maior que a Pro. A
migration armazena `plan_code`, valor, franquia, ciclo, gateway e ambiente na
tentativa.

O fluxo é: usuário Free seleciona Pro ou Business e informa nome e CPF/CNPJ do pagador em `/planos` →
servidor cria/reutiliza cliente e Checkout hospedado recorrente com cartão →
retorno do navegador mostra estado pendente → webhook financeiro
`PAYMENT_CONFIRMED`, correlacionado a cliente, assinatura, usuário e valor.
Na primeira cobrança, o servidor também confirma no Asaas que ela pertence à
sessão de checkout armazenada antes de vincular a assinatura. Depois disso,
concede exatamente o `plan_code` registrado até o fim do mês pago. `successUrl`, `CHECKOUT_PAID` e
`SUBSCRIPTION_CREATED` isolados não concedem acesso. Pagamento vencido ou
recusado não retira um período já pago; estorno integral e chargeback do
período vigente suspendem o acesso para revisão. As assinaturas pagas manuais
anteriores permanecem protegidas. Uma assinatura paga ativa impede outro
checkout, inclusive após cancelamento enquanto `paid_until` ainda vigora.
Upgrade e downgrade exigem atendimento nesta versão. Não há cancelamento automático na interface
nesta versão; suporte deve conciliar/inativar a recorrência no Asaas.
Se a criação do Checkout perder a resposta, o evento `CHECKOUT_CREATED` tenta
recuperar o ID pela referência e cliente esperados; sem essa confirmação, a
tentativa permanece bloqueada para conciliação manual, sem gerar outro Checkout.

O Business ainda não tem teto comercial definitivo de perfis. Preços e franquias
acima servem somente para testes no Sandbox, sem aprovação comercial para
produção. Preço e franquia configurados no ambiente são obrigatórios para
abrir checkout Business. O teto de perfis
fica configurável em `planos_limites_perfis`: `NULL` significa sem teto
provisório; só o papel de serviço pode alterar a configuração. A franquia de IA
é capturada na assinatura local e projetada em `assinaturas_usuario.franquia_ia`.
Para Pro, `NULL` preserva o comportamento provisório sem teto. Equipes, alertas avançados e
Assistente de Participação não foram implementados; o acesso continua individual.

Para homologar futuramente, use uma conta Free de teste, escolha um plano e pague
somente com os [cartões de teste oficiais](https://docs.asaas.com/docs/testing-credit-card-payment).
Confira no banco o evento processado, cobrança, `paid_until` e a projeção
`assinaturas_usuario`, depois confirme os entitlements na aplicação. Repita
com cartão recusado, cancelamento, expiração e reenvio do mesmo webhook. O
script `tests/sql/asaas-billing.sql` exercita eventos sintéticos e termina em
`ROLLBACK`; execute-o no SQL Editor da homologação após a migration. Nenhum
teste Sandbox movimenta dinheiro real, mas notificações podem ser enviadas:
use apenas contatos de teste autorizados. Sandbox e produção têm contas,
chaves e URLs de API diferentes.

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

## Ingestão PNCP nacional em lotes

A rota autenticada `/api/cron/pncp` consulta propostas nacionais sem filtro de UF
ou perfil de empresa. A seleção comercial é separada da classificação histórica:
Pregão Eletrônico (6) e Concorrência Eletrônica (4) são `LICITACAO`; Dispensa (8)
só entra como `CONTRATACAO_DIRETA` com instrumento 2 e modo 4; Credenciamento (12)
entra como `CREDENCIAMENTO`, sem filtro por SICX. Os credenciamentos considerados
são os disponibilizados pelo endpoint de propostas, sem exigir encerramento informado.

### Domínios oficiais verificados em 18/09/2026

Consultas GET realizadas diretamente no PNCP, com resposta de sucesso:

- [Modalidades ativas](https://pncp.gov.br/api/pncp/v1/modalidades?statusAtivo=true):
  6 = Pregão - Eletrônico, 4 = Concorrência - Eletrônica, 8 = Dispensa,
  12 = Credenciamento (todos ativos).
- [Instrumentos ativos](https://pncp.gov.br/api/pncp/v1/tipos-instrumentos-convocatorios?statusAtivo=true):
  2 = Aviso de Contratação Direta; 3 = Ato que autoriza a Contratação Direta;
  4 = Edital de Chamamento Público.
- [Modos ativos](https://pncp.gov.br/api/pncp/v1/modos-disputas?statusAtivo=true):
  4 = Dispensa Com Disputa; 5 = Não se aplica.
- [Conformidade](https://pncp.gov.br/api/pncp/v1/tipo-instrumento-convocatorio-modo-disputa):
  confirma instrumento 2 + modo 4, instrumento 3 + modo 5 e instrumento 4 + modo 5.

`ehDispensaEletronicaComDisputa` exige os três IDs 8/2/4. Nomes estruturados,
quando informados, precisam concordar com instrumento/modo esperados; nomes não
substituem IDs ausentes. Dados incompletos ou conflitantes são ignorados e contados
em `ignoradas`. Nenhuma palavra em título/objeto/informação complementar decide
se uma dispensa é eletrônica. Não há inferência SICX.

O contrato inclui `tipoInstrumentoConvocatorioId`, `tipoInstrumentoConvocatorioNome`,
`modoDisputaId`, `modoDisputaNome`, `informacaoComplementar`, `linkSistemaOrigem`.
Os nomes foram conferidos no retorno de contratação documentado na seção 11.5.4 do
[Manual oficial de Integração v2.6](https://pncp.gov.br/manual/pt-br/latest/singlehtml/).
O link, quando presente, é salvo em `participacao_url`; ausente/vazio vira `null`.
`participacao_portal` permanece PNCP. Informação complementar fica disponível no
contrato de origem; não altera a classificação nem exige coluna adicional.

### Checkpoint e concorrência

Aplicar **manualmente**, após revisão, `supabase/sincronizacao_pncp_checkpoints.sql`
antes de ativar este código em produção. O arquivo cria apenas uma tabela nova e
uma função RPC, sem alterar `oportunidades_editais`, índices ou migrations anteriores.
A tabela usa RLS sem acesso de usuários; tabela e RPC são acessíveis pelo service role.

Cada modalidade tem `pagina_proxima`, `data_final_ciclo`, `ciclo_concluido`,
`atualizado_em`, `ultima_tentativa_em`, `reserva_token` e `reservado_ate`.
A RPC escolhe a tentativa mais antiga (nulos primeiro, desempate por ID), com lock
`FOR UPDATE SKIP LOCKED`. Atualiza a tentativa e reserva por 90 segundos **antes**
da consulta. Assim, uma modalidade com erro não bloqueia permanentemente as demais.
A expiração permite recuperar execuções interrompidas. Um token protege a gravação
contra uma reserva antiga. A data do ciclo fica congelada até a conclusão.

Só após consultar, normalizar e concluir o upsert por `codigo`, o checkpoint é
atualizado. Uma falha deixa a página pendente; se o upsert já tiver sido confirmado,
a repetição atualiza os mesmos códigos. Se a confirmação do checkpoint se perder
na rede, a próxima execução lê o estado persistido: jamais avança sem dados gravados.
No fim, a página fica 1 e o ciclo concluído; a próxima reserva abre o novo ciclo e
renova a data final. Duplicatas dentro da página são consolidadas por código.

### Limites, retorno e validação

- **Máximo de uma página/uma modalidade por execução**, sem loop de paginação.
  Até 19,5s de PNCP (3 tentativas de 6s + esperas de 0,5s/1s), mais até 15s para
  reserva, upsert e checkpoint (5s por operação). Há margem no `maxDuration = 60`.
  Não há cancelamento de página por orçamento global; os timeouts das dependências
  continuam protegendo chamadas individuais. O custo local de normalização é adicional.
- O JSON mantém `ok`, `dataExecucao`, `modalidade` e `resultado`; este último contém
  modalidade (ID/nome), `paginaInicial`, `paginaFinal`, `paginasProcessadas`,
  `consultadas`, `gravadas`, `ignoradas`, `proximaPagina`, `cicloConcluido`, `ocupado`.
  `gravadas` conta códigos submetidos com sucesso, inclusive atualizações;
  `ignoradas` inclui inválidas, fora do escopo e duplicatas na página.
  Sem reserva disponível retorna zero páginas e `ocupado: true`.
- O PNCP é disparado pelo GitHub Actions a cada 15 minutos (detalhes abaixo).
  O cron nativo da Vercel continua apenas para alertas, diariamente às 11:00 UTC
  (`0 11 * * *`).
- Paginação PNCP é dinâmica: propostas podem entrar/sair durante um ciclo. Congelar
  a data final não cria um snapshot; ciclos posteriores recomeçam da página 1, mas
  não garantem recuperação de oportunidades que já saíram da janela do endpoint.
- Consultas reais de propostas e Swagger expiraram durante a validação de 18/09/2026.
  Domínios foram verificados ao vivo; não foi possível validar um payload real de
  propostas nesta sessão. Revalidar essa integração ao aplicar a migration.
- A migration não foi executada. Os testes usam doubles de PNCP/Supabase; não
  substituem validação do SQL/RLS/concorrência em um banco de homologação.

Testes: Node.js 22.15+ ou 24 (loader com `registerHooks`) e dependências instaladas.
Executar `npm test`, `npm run lint`, `npx tsc --noEmit` e `git diff --check`.
Nenhum teste acessa produção ou executa migrations.

### Agendamento PNCP pelo GitHub Actions

O workflow `.github/workflows/pncp-sync.yml` chama
`https://oportuna-two.vercel.app/api/cron/pncp` nos minutos 7, 22, 37 e 52 de cada
hora UTC (`7,22,37,52 * * * *`) e permite disparo manual por `workflow_dispatch`.
Cada execução processa uma modalidade/página: cerca de **96 execuções por dia**,
ou aproximadamente **24 tentativas/páginas por modalidade por dia**, considerando
quatro modalidades. Falhas, conclusão dos ciclos e atrasos do agendador afetam esses
números; não há garantia de disponibilidade contínua do PNCP.

Cadastrar o **repository secret `CRON_SECRET`** em Settings → Secrets and variables
→ Actions, com o mesmo valor de `CRON_SECRET` na produção Vercel. O workflow envia
`Authorization: Bearer ...` via variável de ambiente, sem imprimir o secret ou o
corpo da resposta. Secret ausente faz a execução falhar antes da chamada.

O curl tem limite total de 70 segundos e conexão de 10 segundos, sem retries
adicionais. O job tem limite de dois minutos. A concorrência usa um grupo fixo
de produção, compartilhado entre disparos agendados e manuais, sem cancelar a
execução em andamento. Não há checkout, build, dependências ou acesso ao banco.
A migration de checkpoints continua **manual e nunca é executada pelo workflow**.

- HTTP 200: sucesso.
- HTTP 5xx ou timeout/falha de rede: warning e término sem erro; o próximo disparo
  retoma o estado persistido. Quando a consulta externa PNCP falha, o endpoint não
  avança o checkpoint. Um timeout entre Actions e Vercel não comprova rollback:
  o servidor pode ter concluído o lote; o workflow não altera o checkpoint.
- HTTP 4xx (incluindo 401/403): falha para sinalizar autorização/configuração.
  Outros status inesperados, inclusive redirects, também falham.

**Ativação:** o GitHub executa `schedule` apenas na branch padrão. O arquivo precisa
estar nessa branch também para disponibilizar `workflow_dispatch`. O push isolado
em `feat/pncp-nacional` não ativa o agendamento. A produção precisa conter a versão
com checkpoints e a migration deve ter sido aplicada manualmente antes da ativação.
O agendador pode atrasar ou perder disparos; em repositórios públicos, agendas podem
ser desabilitadas após 60 dias sem atividade.
[Referência oficial de eventos do GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).

**Custo:** usa somente o runner Linux padrão `ubuntu-latest`, sem serviços pagos
adicionais. Runners padrão são gratuitos em repositórios públicos; em privados,
consomem a franquia do plano e podem gerar cobrança excedente. Para manter custo
adicional zero em um repositório privado, conferir a franquia e configurar um
orçamento que bloqueie uso excedente antes da ativação; atingir esse limite pode
interromper os disparos. Este workflow não altera configurações de faturamento.
[Referência oficial de cobrança](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

## Matching determinístico

A listagem `/oportunidades` e os detalhes usam matching canônico no PostgreSQL para
**perfil + oportunidade**, sem IA e sem persistência do score. Os módulos puros
`lib/matching/calcular-match.ts` e `normalizar-texto.ts` permanecem como referência
de testes de paridade; não são chamados pelas telas em produção.

### Fórmula e comparação

- Com palavras-chave úteis: `round(65 × coberturaPalavras + 25 × coberturaSegmento + bônusUF)`.
- Sem palavras-chave úteis: `round(90 × coberturaSegmento + bônusUF)`.
- Cada cobertura é a quantidade encontrada dividida pela quantidade de entradas
  únicas úteis. Segmento sem termos úteis tem cobertura zero.
- UF igual, após trim e caixa alta, soma 10; UF diferente soma zero e **não exclui**
  oportunidades. UFs vazias não pontuam.
- Níveis: alta de 70 a 100; média de 40 a 69; baixa de 0 a 39.

Texto pesquisável: título, objeto, tags e modalidade. Não usa órgão nem cidade.
Normaliza caixa, acentos, pontuação/separadores e espaços. Palavras-chave são
removidas se vazias ou compostas só de stopwords; duplicatas são removidas após
normalização. Preserva a primeira grafia para exibir os motivos.

Uma palavra-chave corresponde quando todos os seus termos relevantes aparecem
como palavras inteiras no texto pesquisável, inclusive se estiverem separados ou
em outra ordem. Frases diretas também satisfazem essa regra. Por exemplo, “gestão
pública” corresponde a “gestão de compras da administração pública”; “obra” não
corresponde a “manobra”. Não há sinônimos, stemming ou interpretação semântica.
O segmento livre é tokenizado com a mesma lista explícita de stopwords, e seus
termos únicos pontuam proporcionalmente. Não há bônus por modalidade/tipo.
Porte e status da oportunidade não participam do score.

Exemplo: 3 de 4 palavras-chave, todos os termos do segmento e mesma UF resultam
em `round(65 × 3/4 + 25 + 10) = 84`. Em outra UF: 74. Com todas as palavras e termos
encontrados, outra UF ainda permite score 90. Sem palavras-chave e com metade dos
termos do segmento encontrados, mesma UF resulta em `round(90 × 1/2 + 10) = 55`.

### Perfil, filtros e IA

Somente perfis do usuário autenticado são carregados. `perfilId` seleciona um
perfil dessa lista; ID inválido, alheio ou repetido é ignorado sem fallback. Na
ausência do parâmetro, apenas um único perfil **ativo** é selecionado automaticamente.
Vários ativos exigem escolha explícita; perfis inativos podem ser escolhidos
explicitamente e são identificados no seletor. Uma seleção vazia desativa o matching.
Sem perfis, há um link para cadastro; sem seleção, nenhum score é exibido.

A ordenação padrão `recomendadas` prioriza abertas, em análise e encerradas,
nessa ordem; dentro do status, usa score decrescente (com perfil) e publicação
mais recente como desempate. Sem perfil, usa status e publicação.
O seletor `ordenacao` também oferece `mais_novas` (abertas/em análise antes de
encerradas, publicação decrescente), `maior_aderencia` (só com perfil: score
decrescente, abertas/em análise antes de encerradas no empate) e `prazo_proximo`
(abertas/em análise antes de encerradas, prazo de participação crescente com
fallback para abertura). Datas ausentes/inválidas ficam depois das válidas.
Essas regras alteram somente a apresentação, nunca a fórmula do score.
“Limpar filtros” preserva o perfil e restaura a ordenação padrão. `aderencia=alta|media|baixa`
filtra apenas com perfil selecionado. Busca, status e UF continuam sendo filtros
independentes e explícitos. Favoritos e links para os detalhes preservam
`perfilId`, `busca`, `status`, `uf`, `aderencia` e `ordenacao` quando aplicáveis.

A análise por IA continua **manual**, acionada pelo botão existente e persistida
por usuário/oportunidade/perfil. Abrir lista/detalhes ou calcular aderência não
chama OpenAI. O score da IA tem identificação própria e não é sobrescrito.
O limiar 60 é apenas uma possibilidade futura de seleção para IA: não aciona nem
bloqueia a análise manual nesta versão. Dashboard e favoritos não mostram o
antigo score global como se fosse aderência por perfil.

### Limitações e validação

A aderência textual **não garante aptidão jurídica ou técnica** para participar.
Não interpreta negação, contexto, plurais ou sinônimos. Termos de uma frase podem
estar em campos distintos; segmento genérico e termos comuns podem produzir
falsos positivos. A falta de palavras-chave e de segmento útil deixa apenas o
bônus geográfico, quando aplicável. O score não é probabilidade de sucesso.

O ranking considera todas as oportunidades que atendem aos filtros explícitos
no banco. O cálculo de score e o filtro de aderência ocorrem antes da ordenação
e do LIMIT/OFFSET. A Data API devolve até 21 registros; a aplicação exibe 20.
Existe uma migration manual descrita abaixo, sem tabela de matches ou infraestrutura nova.

Validação local com **Node.js 24**: `npm test`, `npm run lint`, `npx tsc --noEmit`,
`git diff --check` e `npm run build` (com variáveis disponíveis). O comando atual
de testes exige suporte a `--test-isolation=none`; use Node 24.
Os testes puros cobrem pesos, normalização, níveis, UF, ranking e determinismo.
Os cenários de integração renderizam as páginas reais e executam serviços/actions
com Supabase e OpenAI simulados: seleção autorizada, filtros, contexto de navegação,
favoritos e análise manual/reutilização. Não acessam produção nem executam migrations
ou chamadas reais de IA; não substituem validação autenticada em homologação.

### Paginação e matching SQL V1

**Pré-requisito de publicação:** aplicar manualmente e validar, primeiro em
homologação, `supabase/oportunidades_paginadas_v1.sql`. Não executar migrations
antigas novamente. O build, o GitHub Actions, a aplicação e `npm test` não aplicam SQL.
Não publicar esta versão antes de disponibilizar as RPCs: não existe fallback para
ranking parcial no TypeScript. A paridade e a segurança foram validadas em
homologação com 50.000 oportunidades. Há oscilação HTTP conhecida em Recomendadas
após inatividade (até 8,028 s); detalhes e resultados em `tests/sql/HOMOLOGACAO.md`.
Antes de qualquer deploy, confirmar que a migration exigida está presente no
projeto de produção; não reaplicar migrations antigas sem revisar seu estado.

A migration acrescenta somente `matching_tokens text[]` e `busca_documento text`
à tabela existente, ambos `GENERATED ALWAYS AS (...) STORED`. São derivados
independentes de perfil, não scores. São materializados também para as linhas
existentes pelo ALTER TABLE (backfill), sem UPDATE de IDs/favoritos/análises,
sem disparar alteração dos timestamps existentes e sem alterar origem/tipo ou
checkpoints. Colunas geradas foram preferidas a triggers para impedir drift entre
fonte e derivados, inclusive em updates feitos fora da aplicação. O helper de
tokens é imutável e recebe somente text/text[], sem conversões dependentes de
horário, formato de data ou sessão. A expressão de busca usa concatenação text.
A ingestão PNCP continua com o mesmo payload e código; o PostgreSQL calcula os derivados.

O backfill STORED e a criação de índices exigem tempo e locks: planejar uma janela,
backup e teste com volume representativo. `lock_timeout = 5s` limita a espera para
adquirir lock, **não** o tempo total de materialização após adquiri-lo. Não atualizar
os helpers V1 em produção sem planejar recomputação das colunas geradas; mudanças
de regra/Unicode devem receber nova versão e migration.

Funções públicas de entrada, `SECURITY INVOKER` e disponíveis a `authenticated`:

- `listar_oportunidades_paginadas_v1(p_perfil_id, p_busca, p_status, p_uf,
  p_aderencia, p_ordenacao, p_pagina)`;
- `calcular_match_oportunidade_v1(p_perfil_id, p_oportunidade_id)`.

Ambas exigem `auth.uid()`; perfil informado precisa satisfazer simultaneamente ID
e `usuario_id = auth.uid()`. RLS continua em vigor e nenhuma usa service role.
Helpers puros recebem dados, sem consultar perfis. O helper autorizado lê o perfil
uma vez por RPC e prepara keywords/segmento/UF. Lista e detalhe reutilizam
`matching_calcular_v1`. Dados de entrada inválidos não interpolam SQL dinâmico.
Sem perfil, não há score; aderência é ignorada e maior aderência vira recomendadas.

**Normalização:** não usa unaccent, stemming ou FTS. O SQL usa NFD, categorias
Unicode explícitas, lowercase com Final_Sigma e trim ECMAScript. As constantes
foram geradas com Node.js 24 pelo script `scripts/gerar-unicode-matching.mjs`; a
versão Unicode fica registrada na migration. Isso evita presumir que lower/regex
por locale ou unaccent são iguais ao JavaScript. O banco requer UTF8 e PostgreSQL
15 ou superior. É obrigatório validar a normalização também na versão real do
PostgreSQL, cuja biblioteca Unicode/NFD pode diferir da versão do Node.
O score preserva a sequência double precision da referência; arredonda positivos
pela parte fracionária >= 0,5, evitando o arredondamento bankers de casts.

**Busca:** pg_trgm + GIN em busca_documento, formado pelos cinco campos atuais,
sem UF. O documento é apenas pré-filtro; a RPC revalida o trecho em título, órgão,
modalidade, cidade ou objeto. `%`, `_` e barra são escapados: texto literal, não
wildcards do usuário. Acentos continuam significativos na busca ILIKE. O matching
permanece insensível a acentos conforme sua regra específica. Termos curtos podem
não aproveitar bem o índice. Texto não atravessa campos na validação final.

Índices novos: GIN trigram em busca_documento, B-tree em UF e B-tree no grupo
não encerrada/encerrada + publicação DESC + ID. Foram considerados os índices
existentes de status, data_abertura e as PKs de oportunidade/favoritos. Não há
B-tree de score dinâmico. Índices adicionais de prazo/status devem depender dos
planos medidos. Sem perfil, a RPC usa um caminho sem matching e com corte no banco;
com perfil, materializa IDs/chaves/match do conjunto elegível e depois corta a
página. Custo de score continua proporcional ao universo filtrado e aos termos,
mesmo que só 20 cards sejam transferidos.

**Retorno:** a RPC retorna até 21 linhas `{ oportunidade, match, favorito }`.
`listarOportunidadesPaginadas()` remove a sentinela 21 e retorna:

```text
{ itens, pagina, tamanhoPagina: 20, temAnterior, temProxima }
```

A projeção do card exclui análises IA e observações extensas de participação.
Favoritos são consultados por EXISTS somente nos IDs da página e no usuário atual,
sem carregar antecipadamente todos os favoritos. O detalhe mantém dados completos
e obtém matching pela RPC canônica. O dashboard atual usa uma RPC de resumo para
contar a visão acionável e a base completa; não usa o tamanho de uma página como total nacional.

**Navegação:** `pagina` é inteiro positivo dentro de int32; inválido volta a 1.
As páginas têm tamanho fixo 20 no banco, sem parâmetro de tamanho vindo do cliente.
Filtros, perfil e ordenação são submetidos sem pagina antiga, reiniciando em 1.
Limpar filtros preserva perfil e reinicia. Detalhes, voltar e favoritos preservam
pagina no contexto. Não há COUNT na listagem. Página vazia fora da faixa mantém
Anterior disponível; Próxima depende da sentinela. ID desempata todas as ordenações;
prazo usa timestamp de participação e depois abertura à meia-noite UTC, compatível
com Date.parse da data ISO usada na referência.

OFFSET/LIMIT preserva ranking global no snapshot de cada consulta, mas inserções
ou alterações entre requests podem mover itens entre páginas. Páginas profundas
custam mais; keyset fica para uma versão futura. Não há promessa de latência para 1k/10k/50k sem
benchmark. Um score 98 participa antes do corte; em recomendadas, status ainda tem
prioridade. Score não garante aptidão jurídica/técnica nem probabilidade de vitória.

### Ciclo de vida: ativas, histórico e todas

**Pré-requisito de publicação desta etapa:** revisar e executar manualmente
`supabase/oportunidades_ciclo_vida_v1.sql` em homologação e, depois dos testes,
em produção antes de publicar a aplicação. O workflow, build e `npm test` não
executam migrations. A migration depende da SQL V1 acima, cria uma view com
`security_invoker` e duas RPCs novas; não atualiza, exclui ou recria
oportunidades, perfis, favoritos ou análises. A RPC V1 permanece disponível.

A situação operacional é calculada em cada consulta, sem coluna de status
dependente do relógio nem job. `status = 'encerrada'` ou
`participacao_prazo_limite <= agora` significa **encerrada**. Prazo futuro e
status não encerrado significam **ativa**. Prazo ausente ou inválido, sem status
encerrado, significa **prazo a confirmar** (`indeterminada`). A visão padrão
**Ativas** inclui ativas e indeterminadas para não ocultar processos que ainda
podem admitir participação; **Histórico** contém as encerradas; **Todas** inclui
ambos. O badge distingue prazo confirmado de prazo desconhecido. O status de
origem nunca é sobrescrito por esta classificação.

Esta regra vale igualmente para Pregão Eletrônico, Concorrência Eletrônica,
Dispensa e Credenciamento. O PNCP define `dataAberturaProposta` como início do
recebimento e `dataEncerramentoProposta` como fim. A ingestão atual usa o
primeiro (ou publicação, como fallback) em `data_abertura` e o segundo em
`participacao_prazo_limite`, quando informado. Por isso `data_abertura` **não**
encerra participação. Amostras públicas de Dispensa e Credenciamento sem data
final reforçam o tratamento conservador. A classificação não identifica
suspensão, cancelamento ou anulação, pois os campos existentes não oferecem
evidência estruturada suficiente para esses estados. Prazo vazio não é garantia
de disponibilidade: o usuário deve conferir edital e portal de origem.

`listar_oportunidades_paginadas_v2` aplica visão e filtros antes de calcular
matching, aderência e ranking global; só então corta 20 cards. A fórmula, a
autorização por perfil e a RPC de matching do detalhe permanecem as mesmas.
O filtro de aderência e a paginação continuam globais dentro da visão escolhida.
As abas preservam filtros e perfil e reiniciam na página 1. Histórico abre por
publicação mais recente; em Todas, **Recomendadas** deixa encerradas depois das
demais. Detalhes e favoritos históricos permanecem acessíveis, sem desfavoritar
nem apagar dados. O dashboard conta ativas mais prazos a confirmar como número
principal e informa separadamente o tamanho da base completa. Os alertas ainda
seguem a lógica anterior; filtrar apenas oportunidades ativas neles é uma etapa
futura separada.

Esta migration não cria índice: a seletividade temporal e o custo do matching
dependem da distribuição real de prazos. Medir V1 `recomendadas` com todas versus
V2 `recomendadas` com ativas na mesma massa de homologação antes de atribuir
ganho de desempenho. Registros sem prazo permanecem na visão padrão e, portanto,
continuam participando do cálculo de score. Também pode haver mudança de página
entre requests enquanto prazos vencem ou chegam novos registros.

### Validação SQL manual e paridade

Procedimento reproduzível, identificação do ambiente, comandos e critérios de
aceite: [homologação manual](tests/sql/HOMOLOGACAO.md). O benchmark sintético
`tests/sql/oportunidades-benchmark.sql` prepara 1k/10k/50k registros em banco
descartável vazio e executa EXPLAIN sob `authenticated`, com rollback ao final.

Fixtures em `tests/helpers/matching-fixtures.mjs` alimentam **38 cenários de match**
e 16 textos de normalização. As expectativas completas (score, nível, palavras,
segmento, UF e motivos) vêm de `calcularMatch`. Incluem 39/40/69/70, score 98,
acentos compostos/decompostos, caixa, trim, frases, stopwords, duplicatas, ligaturas,
sigma grego, Unicode fora do BMP e UF. Geradores só escrevem arquivos locais:

```bash
node scripts/gerar-unicode-matching.mjs --check
node --import ./tests/register.mjs scripts/gerar-paridade-sql.mjs --check
```

Usar a versão Node/Unicode registrada para regenerar. Não editar expectativas SQL
à mão. O teste local confere referência/fixtures, **não executa PostgreSQL**.
Os doubles das páginas simulam o contrato RPC, não são testes do matcher SQL.

Sequência manual em banco de homologação:

1. Revisar e aplicar a única migration nova.
2. Executar `tests/sql/matching-paridade.sql`: compara os 38 resultados completos
   e normalizações SQL contra expectativas TS; qualquer diferença gera EXCEPTION.
3. Executar `tests/sql/oportunidades-paginadas.sql` como administrador em ambiente
   de teste: fixtures em transação, SET ROLE authenticated, JWTs simulados e ROLLBACK.
   Valida RLS/perfis, ranking global, busca literal, sentinela/páginas, desempate,
   favoritos por usuário, status e prazo. Não usar em produção.
4. Executar exemplos em `tests/sql/oportunidades-explain.sql`, substituindo os UUIDs
   por usuário/perfil de homologação, com bases 1k/10k/50k e páginas rasas/profundas.
   Inclui sem perfil/mais novas, recomendadas, maior aderência, busca e aderência alta.
   PL/pgSQL pode exibir só Function Scan: inspecionar também os SELECTs internos ou
   auto_explain de statements aninhados, quando disponível. Registrar buffers,
   tempos reais, CPU e concorrência; nenhum tempo foi estimado como medição.

A validação no banco é pré-requisito para considerar a paridade confiável e liberar
commit/publicação desta etapa. A aplicação não tenta executar a migration ao iniciar.

### Base de planos Free e Pro

A migration aditiva [`supabase/planos_e_permissoes_v1.sql`](supabase/planos_e_permissoes_v1.sql)
depende das migrations de perfis, favoritos, análises, alertas e oportunidades V2.
Em um projeto isolado criado para homologar oportunidades, confira se
`public.alertas_perfis` e `public.alertas_envios` existem; se não, execute
[`supabase/alertas_email.sql`](supabase/alertas_email.sql) primeiro. A migration
de planos verifica essas dependências antes de criar qualquer tabela.
Ela **não é executada por build, testes, workflow ou aplicação**. Homologar antes;
em produção, aplicar e validar manualmente antes de publicar o código desta etapa.
Essa migration, isoladamente, não define pagamento ou preço; a integração
Sandbox desta branch está descrita acima. Cada assinatura pertence a um usuário do
Supabase Auth; não há organização nem múltiplos usuários por conta. Sem registro
ou com assinatura inativa/vencida, o plano efetivo é Free. Um trigger cria o
registro Free para novos usuários, sem backfill destrutivo para os antigos.

| Recurso | Free | Pro |
| --- | --- | --- |
| Perfis de empresa | 1 | Até 3 |
| Favoritos | 5 | Ilimitados |
| Novos scores desbloqueados | 3 por dia | Ilimitados |
| Análises por IA concluídas | 1 de demonstração | Franquia por assinatura; `NULL` sem teto provisório até definição comercial |
| Alertas automáticos | Não | Sim, quando a configuração estiver ativa |
| Histórico | Últimos 30 dias | Completo |

Os limites são verificados no banco por triggers e RPCs, além das actions e da
interface. Dados antigos acima de um limite permanecem salvos; somente novas
inclusões são bloqueadas. O histórico Free usa o prazo final de participação
quando válido, ou a publicação como fallback. O filtro vale em **Histórico** e
**Todas**, na RPC e na leitura direta sob RLS. Oportunidades ativas continuam
visíveis independentemente da data de publicação. Detalhes antigos fora da
janela deixam de ser visíveis no Free, inclusive quando favoritados; os
favoritos ficam armazenados e voltam a ser visíveis no Pro.

O ranking global e o filtro de aderência continuam calculados antes dos 20 itens
da página. A listagem Free não consome créditos ao abrir: a RPC mascara score e
motivos de cada oportunidade ainda bloqueada. A ação **Desbloquear score** grava
uma chave única por usuário, perfil, oportunidade e dia de São Paulo. Reabrir o
mesmo score no dia não consome outra vaga. O detalhe usa a mesma autorização.
RPCs legadas e helpers que devolviam score diretamente perdem EXECUTE para
`authenticated` após a migration; o código do matcher não muda.

Análise IA em cache não consome cota. Para gerar uma nova, a action reserva uma
vaga com expiração de cinco minutos, evitando duas chamadas simultâneas acima da
franquia; falhas liberam a reserva. Um trigger registra o consumo somente quando
a análise é persistida com sucesso. O registro de consumo permanece caso a
análise seja excluída; análises já existentes entram nesse histórico na migration.
Inserções diretas acima do limite são bloqueadas. No Pro a franquia
`franquia_ia` é configurada na assinatura por administrador, sem valor comercial
definitivo nesta etapa.

Configurações antigas de alertas Free **não são apagadas nem desativadas**. A
action e o banco bloqueiam novas ativações Free. O serviço do cron lê planos com
o cliente administrativo, pois a chamada com `CRON_SECRET` não traz cookie de
usuário, e só processa `alerta.ativo` de um usuário Pro efetivo. Rota,
autenticação, frequência e conteúdo dos alertas não foram alterados. O serviço
precisa de `SUPABASE_SECRET_KEY` no ambiente do cron; telas normais continuam
usando o cliente de usuário com RLS.

`eventos_plano` guarda apenas usuário, tipo de evento e data para limites,
tentativa de alerta, visita a planos e clique no upgrade; não há analytics
externo. O usuário só lê e registra os próprios eventos. Assinaturas e cotas
não podem ser editadas por usuários autenticados. Enterprise permanece como
possível extensão do domínio, sem entitlement ou interface nesta versão.

Após aplicar em homologação, executar
[`tests/sql/planos-permissoes.sql`](tests/sql/planos-permissoes.sql) inteiro no
SQL Editor do projeto isolado: ele cria fixtures em transação, troca para
`authenticated` com duas identidades e termina em `ROLLBACK`. Executar também
38 fixtures/16 normalizações anteriores antes e depois da nova migration,
como administrador de homologação (a RPC V1 perde acesso de usuário nesta
etapa), e repetir smoke HTTP com duas contas reais na V2 e no desbloqueio.
O script existente de isolamento aceita `HOMOLOG_ISOLAMENTO_RPC=v2` junto das
variáveis locais `HOMOLOG_*` para testar a V2 por HTTP sem imprimir credenciais;
os quatro casos Conta A/B devem retornar PASS. O desbloqueio deve ser testado
na aplicação com a conta Free, verificando que abrir a lista não consome cota.
Medir também a latência da V2 sobre os 50.000 registros existentes. Sem
validação real de RLS, cotas, paridade e latência no
PostgreSQL de homologação, os testes locais não comprovam prontidão de deploy.
