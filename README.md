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

A listagem `/oportunidades` e os detalhes calculam aderência em runtime para a
combinação **perfil + oportunidade**, sem IA, chamadas externas ou persistência
do score. O módulo puro fica em `lib/matching/`; não escreve em oportunidades nem
em `analises_oportunidades`.

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

Com perfil, ordena score decrescente e desempata por data de abertura crescente
(datas ausentes/inválidas ficam depois das válidas). `aderencia=alta|media|baixa`
filtra apenas com perfil selecionado. Busca, status e UF continuam sendo filtros
independentes e explícitos. Favoritos e links para os detalhes preservam
`perfilId`, `busca`, `status`, `uf` e `aderencia` quando aplicáveis.

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

O ranking considera **somente as oportunidades retornadas pela consulta atual**,
respeitando filtros existentes e o teto de linhas configurado no Supabase. A
listagem já não possuía paginação explícita; nenhum novo `limit` foi introduzido.
Portanto, o ranking não garante os melhores itens de toda a base nacional se a
consulta for truncada pelo servidor. Paginação/ranking global ficam para outra
etapa. Para N itens, há normalização de texto por item, buscas de tokens em `Set`
e ordenação O(N log N); perfil preparado uma única vez por listagem. Memória e HTML
crescem com o lote retornado. Não há infraestrutura nova nem migration.

Validação local com **Node.js 24**: `npm test`, `npm run lint`, `npx tsc --noEmit`,
`git diff --check` e `npm run build` (com variáveis disponíveis). O comando atual
de testes exige suporte a `--test-isolation=none`; use Node 24.
Os testes puros cobrem pesos, normalização, níveis, UF, ranking e determinismo.
Os cenários de integração renderizam as páginas reais e executam serviços/actions
com Supabase e OpenAI simulados: seleção autorizada, filtros, contexto de navegação,
favoritos e análise manual/reutilização. Não acessam produção nem executam migrations
ou chamadas reais de IA; não substituem validação autenticada em homologação.
