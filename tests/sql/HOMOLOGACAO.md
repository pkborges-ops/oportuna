# Homologação manual de oportunidades

**Estado atual em 29/09/2026:** paridade, segurança e fluxos funcionais aprovados
em homologação. Latência de Recomendadas após inatividade permanece como risco
conhecido; o responsável autorizou o commit após receber o reteste abaixo.
Os registros datados anteriores são históricos. Produção não foi migrada.

Estado em 22/09/2026: execução PostgreSQL pendente. Não há medição nem paridade
SQL comprovada. Inspeção local não encontrou psql/Docker/Supabase CLI no PATH,
serviços PostgreSQL/Docker, configuração Supabase local ou variáveis de conexão.
Isso não exclui um ambiente remoto ainda não identificado pelo responsável.

## 1. Identificar e isolar antes de conectar

Utilizar projeto Supabase exclusivo de homologação ou Supabase local descartável.
Comparar nome **e project ref** com produção no painel; nomes semelhantes não
comprovam isolamento. Registrar responsável, identificação e versão PostgreSQL.
Não copiar credenciais ou dados de produção. Não usar `.env` da aplicação como
fonte automática de conexão. A migration contém COMMIT: rollback dos testes não
desfaz a aplicação da migration. Não iniciar sem confirmar o destino isolado.

Um PostgreSQL puro exige provisionar os papéis e o schema Auth equivalentes ao
Supabase. Um stub de `auth.uid()` não comprova autenticação/JWT do Supabase; para
o aceite final, preferir Supabase real/local e validar também a camada HTTP.

Configurar manualmente um serviço libpq chamado `oportuna_homologacao`, com host,
porta, banco e usuário do ambiente isolado. Guardar senha em pgpass com permissões
restritas; não colocá-la em comandos, logs ou repositório. Requer `psql` instalado.

Na raiz do projeto, PowerShell:

```powershell
$env:PGSERVICE = 'oportuna_homologacao'
$env:PGCLIENTENCODING = 'UTF8'
psql -X -v ON_ERROR_STOP=1 -c "select current_database(),current_user,inet_server_addr(),inet_server_port(),version();"
if ($LASTEXITCODE -ne 0) { throw 'Conexão falhou' }
```

Conferir essa identidade contra o serviço configurado e o painel. Não existe
consulta SQL capaz de provar sozinha que um projeto remoto não é produção.

## 2. Schema e migration

Alternativa sem ferramentas locais: criar `oportuna-homologacao` em uma organização
Free com vaga disponível, confirmar que seu project ref difere de produção e abrir
SQL Editor > New query. Copiar o conteúdo completo de cada arquivo listado abaixo
e executar um por vez, interrompendo ao primeiro erro. Depois executar a migration,
`matching-paridade.sql` e `oportunidades-paginadas.sql`, também separadamente.
Para estes dois testes não é necessário criar usuários manualmente: o roteiro de
integração cria fixtures em transação e as desfaz. Não precisa configurar Vercel,
GitHub, SMTP, PNCP, OpenAI ou variáveis da aplicação para a etapa SQL.
O script `oportunidades-benchmark.sql` contém comandos específicos do psql; não
colar esse arquivo diretamente no SQL Editor. Usar o procedimento psql da seção 4
para o benchmark. A etiqueta `main / PRODUCTION` de um projeto Supabase novo não
identifica a produção do Oportuna; conferir o project ref do projeto separado.

Em projeto Supabase **novo e vazio**, aplicar manualmente nesta ordem os scripts
existentes (em projeto já preparado, inspecionar o schema e não reaplicar scripts
de backfill):

1. `supabase/perfis_empresa.sql`
2. `supabase/oportunidades_editais.sql`
3. `supabase/participacao_oportunidades.sql`
4. `supabase/oportunidades_origem_tipo.sql`
5. `supabase/oportunidades_origem_sem_default.sql`

Exemplo de execução individual: `psql -X -v ON_ERROR_STOP=1 -f <arquivo>`.
Verificar `$LASTEXITCODE` após **cada** comando. Não aplicar migrations de PNCP,
alertas ou IA para este teste. Preservar políticas e grants reais: não contornar
uma falha de permissão desabilitando RLS ou concedendo BYPASSRLS.

Verificar papéis e RLS antes e depois da nova migration:

```sql
select rolname,rolsuper,rolbypassrls from pg_roles
where rolname in ('authenticated','anon','service_role');
select relname,relrowsecurity,relforcerowsecurity from pg_class
where oid in ('public.perfis_empresa'::regclass,
 'public.oportunidades_editais'::regclass,'public.oportunidades_favoritos'::regclass);
select * from pg_policies where schemaname='public' and tablename in
 ('perfis_empresa','oportunidades_editais','oportunidades_favoritos');
```

`authenticated` não pode ter superuser/BYPASSRLS; as três tabelas devem ter RLS.
Depois da identificação e revisão manual, executar:

```powershell
node scripts/gerar-unicode-matching.mjs --check
if ($LASTEXITCODE -ne 0) { throw 'Unicode divergente' }
node --import ./tests/register.mjs scripts/gerar-paridade-sql.mjs --check
if ($LASTEXITCODE -ne 0) { throw 'Expectativas divergentes' }
psql -X -v ON_ERROR_STOP=1 -f supabase/oportunidades_paginadas_v1.sql
if ($LASTEXITCODE -ne 0) { throw 'Migration falhou; parar e revisar' }
```

Não editar expectativas para fazer uma divergência passar. Corrigir a regra SQL
ou a fixture incorreta, justificar e repetir integralmente os testes afetados.

## 3. Paridade, RPCs e segurança

```powershell
psql -X -v ON_ERROR_STOP=1 -f tests/sql/matching-paridade.sql
if ($LASTEXITCODE -ne 0) { throw 'Paridade SQL/TS falhou' }
psql -X -v ON_ERROR_STOP=1 -f tests/sql/oportunidades-paginadas.sql
if ($LASTEXITCODE -ne 0) { throw 'Integração/RLS falhou' }
```

O primeiro compara 38 objetos completos de matching e 16 normalizações contra
expectativas TS. O segundo prepara fixtures como administrador, mas executa as
RPCs e asserções com `SET LOCAL ROLE authenticated` e dois contextos JWT. Verifica
RLS diretamente nas tabelas, acesso ao perfil próprio, rejeição ao alheio,
favoritos privados, tentativa de escrita alheia e rejeição sem identidade.
São testes reais das políticas PostgreSQL, não validação da assinatura JWT.

Verifica também o item antigo de 98 fora dos primeiros 21 por publicação,
recomendadas/aderência globais, filtro alta antes do corte, UF/status, ordenações,
20+sentinela, páginas sem repetição, literal `%`/`_` e colunas geradas atualizadas.
Falhas interrompem psql; o encerramento da conexão desfaz a transação dos testes.

Complemento obrigatório no Supabase: criar duas contas de teste A/B, autenticar
cada uma pela aplicação de homologação e observar as RPCs com seus próprios
access tokens (nunca service_role). Conferir lista/detalhe/favoritos; alterar o
`p_perfil_id` para o do outro usuário deve falhar sem dados. Chamada sem token de
usuário também deve falhar. Não registrar tokens, senhas ou headers Authorization
nas evidências. Registrar somente usuário pseudônimo, RPC, status e resultado.
Repetir navegação página 1/2, favoritar, abrir detalhe e voltar preservando filtros.

## 4. Performance reproduzível

Sem psql: abrir `tests/sql/oportunidades-benchmark-editor.sql`, copiar inteiro no
SQL Editor do projeto de homologação e executar. Começar com `tamanho integer :=
1000`, repetir com 10000 e 50000; guardar a célula JSON `resultado_benchmark` de
cada execução. O arquivo envolve setup e medição em um bloco no servidor, mede
sob authenticated e termina em rollback. Não executar trechos selecionados.
Se houver erro/timeout, registrar e interromper; não há aprovação nem tempos
presumidos. Este roteiro ainda precisa ser executado pelo responsável no banco.


Somente banco descartável sem oportunidades; o roteiro rejeita base não vazia.
Não remover dados para satisfazer essa condição: usar outro ambiente isolado.

```powershell
foreach ($tamanho in @(1000,10000,50000)) {
  psql -X -v ON_ERROR_STOP=1 -v tamanho=$tamanho -f tests/sql/oportunidades-benchmark.sql 2>&1 |
    Tee-Object -FilePath "$env:TEMP/oportuna-benchmark-$tamanho.log"
  if ($LASTEXITCODE -ne 0) { throw "Benchmark falhou: $tamanho" }
}
```

Massa determinística em distribuição: textos de cerca de 1 KB, cinco temas/UFs,
status mistos, datas variadas e favoritos. IDs são aleatórios. São dados
sintéticos representativos de volume, não reprodução da distribuição PNCP real.
ANALYZE precede EXPLAIN; seis cenários cobrem os cinco requeridos e página profunda.
Há plano adicional para o predicado trigram. Timeout de 120 s é falha registrada,
nunca uma medição bem-sucedida. Dados de cada tamanho terminam em ROLLBACK.

Registrar versão, recursos/plano Supabase, tamanho, cenário, planning/execution
time, buffers hit/read, temporários, linhas e timeout. Repetir para observar cache,
sem chamar uma execução de cache frio se o cache não foi controlado. Não inferir
latência HTTP/transferência ou concorrência desses planos de uma conexão.
Function Scan agrega a RPC e pode ocultar os nós internos: usar auto_explain
nested statements se disponível, ou EXPLAIN do SELECT interno copiado da função.

## 5. Critério de aceite

Registrar logs sem secrets, checksum/versão da migration, resultado de cada suíte
e planos reais. Liberar commit/PR apenas após paridade integral, RLS e smoke HTTP
aprovados, com performance avaliada. Até lá, estado **não pronto**; sem commit,
push, aplicação em produção ou alegação de testes SQL executados.

### Alternativa após timeout do SQL Editor em 50k

A carga e sete EXPLAIN na mesma chamada sofreram upstream timeout; isso não mede
uma consulta individual. Usuário confirmou contagem zero e nenhuma sessão do
benchmark visível na consulta de pg_stat_activity. Não executar automaticamente.

No projeto exclusivo `oportuna-homologacao` (`uzmgxxhiedevsxedgqij`):

1. Executar `benchmark-50k-1-carga.sql` inteiro com `lote := 1`; depois repetir
   alterando apenas lote para 2, 3 ... 10. Cada lote grava 5000 registros; repetir
   o mesmo lote não duplica códigos. Aqui há COMMIT, diferente do roteiro anterior.
   Se houver timeout, verificar sessões antes de repetir. Não executar lotes em paralelo.
2. Conferir 50000 registros e executar, em consulta separada:
   `ANALYZE public.oportunidades_editais; ANALYZE public.perfis_empresa;
   ANALYZE public.oportunidades_favoritos;`
3. Executar `benchmark-50k-2-medir.sql` inteiro com `cenario := 1`, depois 2 até 7.
   Guardar cada JSON; cada chamada mede um único cenário sob authenticated.
4. Após guardar resultados, executar manualmente `benchmark-50k-3-limpar.sql`.
   Remove oportunidades com prefixo exclusivo e perfil sintético; mantém a conta
   sintética sem credenciais para evitar cascatas sobre dados não previstos.

Não há tabela nova, alteração de matcher ou aplicação de migration nestes scripts.
Os dados persistem exclusivamente para permitir chamadas separadas. A checagem de
conteúdo não substitui conferir o project ref no painel. Tempos deste roteiro não
foram medidos localmente. Diferenças de cache e carga por transação devem constar
na comparação com os benchmarks anteriores.

### Diagnóstico e ajuste 1 — UF ASCII (23/09/2026)

Resultados enviados pelo responsável em PostgreSQL 17.6, 50k, work_mem 2184kB,
JIT off: SELECT interno recomendadas 11702,048 ms; elegíveis 11101,502 ms;
sort external merge 17160 kB; leitura sem matcher 380,955 ms; matcher agregado
11037,597 ms com um worker paralelo; preparação/autorização 2,542 ms;
normalização UF 2216,566 ms (Index Only Scan 24,368 ms, 10000 heap fetches).
Tempos incluem instrumentação; não subtrair execuções distintas como custo exato.

Primeiro ajuste local: caminho direto em matching_upper_v1 para exatamente duas
letras ASCII, fallback Unicode original nos demais casos. A fórmula é preservada.
Patch manual `otimizacao-01-uf-ascii.sql` substitui apenas essa função e compara
2719 expectativas geradas por String.toUpperCase (2704 pares ASCII + 15 extremos).
Se houver diferença a transação aborta. Não reaplicar a migration inteira para
este ajuste. Não executado automaticamente; ganho e paridade real pós-ajuste
continuam pendentes. Nenhum registro/índice/coluna é recriado.

Após aplicar em homologação: repetir matching-paridade.sql e oportunidades-paginadas.sql;
repetir cenário 5 e 3 do diagnóstico e cenários 1–7 do benchmark na mesma massa.
Manter evidências de antes/depois; não liberar commit apenas com testes Node.

### Score escalar para ranking global

Resultados após o ajuste UF: RPC recomendadas 4960,342 ms contra 13633,369 ms
antes (redução de 63,6% nesta execução); temporários continuam 4289 lidos/6363
gravados. A ordenação ainda usa spill, mas não explica o custo total sozinho.

Patch local `otimizacao-02-score-global.sql` calcula somente o inteiro do score
global e reduz a CTE materializada para colunas estreitas. Motivos e JSON completo
passam a ser gerados depois do corte, só para os itens retornados. Mais novas/prazo
sem filtro de aderência não calculam score; prazo só é calculado para essa ordenação.
Filtro e ranking globais seguem antes de LIMIT/OFFSET e não há pré-filtro heurístico.
O teste de paridade gerado agora compara também o score scalar nos 38 casos.

Este segundo patch é só local, não aplicado nem medido no PostgreSQL. Próxima
validação manual, no projeto isolado: aplicar patch; executar matching-paridade.sql
e oportunidades-paginadas.sql; medir cenario 2 (recomendadas), 3 (maior aderência),
5 (aderência alta) e 6 (página 2500); conferir mais novas/prazo sem cálculo indevido.
Guardar novos EXPLAIN e comparar mesmos cenários/50k antes de concluir.

### Resultados após score escalar — reportados pelo responsável

Homologação: `matching-paridade.sql` e `oportunidades-paginadas.sql` ambos
retornaram Success/No rows; 38 fixtures + score scalar + 16 normalizações e roteiro
de paginação/RLS com dois usuários passaram segundo o resultado informado.
Benchmarks PostgreSQL 17.6, 50k: mais novas 7,038 ms; recomendadas 3634,167 ms
(366 temp read/683 written); maior aderência 3675,145 ms (366/683); aderência alta
7439,788 ms (0/315); página 2500 3810,854 ms (840/1160). Uma medição por cenário;
ambiente/cache podem variar. Comparáveis anteriores: recomendadas 13633,369 ms;
maior aderência 8488,519 ms; aderência alta 10744,584 ms; página 2500 11754,678 ms.
Não se mediu novamente a mesma senha de cache controlado; inferir percentuais é
indicativo, não benchmark estatístico. Roteiros `Function Scan` ocultam nós da RPC.

Verificação local após a mudança: npm test 59/59, lint, TypeScript, geradores e
git diff --check passaram. Nenhum commit/push/merge. Ainda não há teste HTTP real da
aplicação nesta etapa. Meta de 1–2 s não foi atingida: aderência alta 7,44 s; demais
ordenações de ranking aproximadamente 3,6–3,8 s. Antes de mudança arquitetural,
alternativas a comparar: otimização adicional da representação/preparação dos
termos no request ou materialização incremental por perfil (custo de atualização,
volume e consistência); não usar pré-filtro heurístico que descarte candidatos.

### Próxima experiência — termos do perfil em arrays pré-preparados (24/09/2026)

Após os resultados acima, foi preparada localmente uma experiência, ainda NÃO aplicada
na homologação. O SQL `otimizacao-03-perfil-arrays.sql` substitui o score scalar para
receber arrays de termos preparados uma vez por chamada, além de UF já normalizada;
usa `matching_tokens` persistidos para cada oportunidade e mantém o mesmo cálculo
65/25/10, arredondamento, filtros globais e ordenação antes da paginação. Os motivos
completos seguem calculados apenas nas linhas retornadas. O patch descarta a assinatura
antiga do helper para não deixar dois caminhos de score ativos. Não mexe em tabelas,
índices, dados ou RLS; requer que os patches 01 e 02 já estejam aplicados.

O gerador de `matching-paridade.sql` foi atualizado para comparar o matcher completo
e o score novo nas 38 fixtures, mais 16 normalizações. `benchmark-50k-4-diagnostico.sql`
cenário 3 agora mede o matcher scalar preparado sem ordenação/cards/favoritos; cenário 4
mede preparação/autorização. Aplicar o patch 03 somente após conferir o project ref
`uzmgxxhiedevsxedgqij`; em seguida executar paridade e RLS/paginação antes de benchmarks.
O patch não foi executado contra o banco nesta etapa, então fórmula/paridade/RLS SQL e
latência permanecem pendentes de confirmação remota. Manter os 50.000 registros.

O teste integral local teve 58/59 sucesso; a única falha foi `spawnSync ... node.exe EPERM`
no teste de integração que inicia um processo filho. Os outros 40 testes focados em
matching, ordenação e paginação passaram; lint/TypeScript e `git diff --check` não
reportaram erros. O HTTP de homologação permanece não testado: não há sessão/credencial
de app de homologação disponível neste workspace, e não se deve usar cookies ou tokens
de produção.

### Diagnósticos internos após o score em arrays — resultados enviados em 24/09/2026

O responsável executou os cenários 2, 3 e 1 de `benchmark-50k-4-diagnostico.sql` em
PostgreSQL 17.6, 50k, JIT off, work_mem 2184 kB:

- Cenário 2, leitura de tokens sem matcher: 204,096 ms total; Seq Scan 111,422 ms,
  50.000 linhas reais contra estimativa de 50.008; sem I/O temporário.
- Cenário 3, matcher scalar sem ordenação/cards/favoritos: 5644,617 ms total. A
  preparação `matching_preparar_score_v1` aparece como uma chamada de 0,325 ms. A
  consulta varre 50.000 linhas e não gera blocos temporários. O plano não atribui
  separadamente tempo à chamada escalar na expressão do Aggregate.
- Cenário 1, SELECT interno de recomendadas: 9426,254 ms total, 9422,546 ms no
  Nested Loop final. CTE `elegiveis` materializa 50.000 scores; o Seq Scan que avalia
  `matching_score_v1(...)` registra 9025,096 ms e o CTE Scan 9083,506 ms. Ordena
  50.000 linhas por external merge (2928 kB) com 366 blocos temporários lidos e 682
  gravados; o Limit faz top-N para 21 linhas. A busca dos cards registra 1,374 ms
  por loop, com 21 loops (aproximadamente 28,9 ms); favoritos 7,721 ms. A chamada
  de score está na projeção da varredura e esta concentra o tempo observado. O plano
  não permite separar a função escalar do custo restante da varredura com precisão.

A leitura simples (cenário 2) é cerca de 0,204 s, enquanto o score-only levou 5,645 s;
preparar o perfil uma vez custa 0,325 ms. Isso aponta fortemente para avaliação do
matcher por oportunidade como custo dominante, sem provar um tempo exato por chamada.
Há uma divergência a investigar com os benchmarks externos da RPC, que reportaram
~1,6 s para Maior aderência; Function Scan esconde nós internos e essas execuções não
foram pareadas. O plano interno atual de Recomendadas é 9,426 s, portanto a meta de
1–2 s não foi alcançada de modo consistente. Ranking global permanece correto; não
foi aplicado pré-filtro nem materialização por perfil. Paridade/RLS após este patch,
HTTP de homologação e benchmarks pareados continuam pendentes; sem commit/PR.

### Validação pela aplicação autenticada — 25/09/2026

Esta atualização substitui as pendências históricas acima somente nos itens
explicitamente comprovados abaixo. O responsável relatou execução sem erros de
`matching-paridade.sql` (38 fixtures e 16 normalizações) e
`oportunidades-paginadas.sql` após o patch 03. Trata-se de resultado relatado pelo
responsável, não de uma nova execução SQL pelo agente.

Aplicação da branch `feat/escala-oportunidades` executada em build de produção local
(`npm run build` e `npm run start -- --hostname 127.0.0.1 --port 3000`), usando apenas
URL e chave publicável do projeto `uzmgxxhiedevsxedgqij`. `.env.local` é ignorado pelo
Git. Build e 59/59 testes locais passaram. Lint, TypeScript (`tsc --noEmit`) e
`git diff --check` também passaram. Nenhuma migration foi executada.

O usuário criou uma conta por e-mail/senha e entrou pelo navegador. Google retornou
`Unsupported provider: provider is not enabled` neste projeto isolado. Foi criado
pela interface o perfil sintético `Homologação — Software (teste)` (Perfil A),
com segmento `tecnologia software`, UF SC e
palavras `software, gestão pública, suporte`. Nenhuma oportunidade foi modificada.

Resultados observados no navegador, com sessão real e sem acesso administrativo:

- Dashboard exibiu 50.000 oportunidades. Listagem sem perfil exibiu 20 cards.
- Recomendadas e Maior aderência exibiram 20 cards, scores de 100% e motivos
  correspondentes a 3/3 palavras e 2/2 termos do segmento.
- Páginas 1 e 2 de Recomendadas: 20 cards cada, sem IDs repetidos entre elas.
  Alterar a ordenação na página 2 voltou à página 1.
- Filtros combinados `software`, aberta, SC e alta: 20 cards compatíveis; link
  Próxima preservou busca/status/UF/perfil/aderência/ordenação.
- Mais novas exibiu publicações de 26/09/2026; o primeiro card de Recomendadas,
  `Aquisição 43195`, com 100% e publicação 23/09/2026, estava fora das primeiras
  20 de Mais novas. Isso verifica na UI que o ranking não se limita ao lote por data.
  A fixture exata de 98% continua coberta pelo teste SQL relatado, não por esta massa.
- Prazo próximo exibiu cards abertos com abertura em 01/10/2026; este smoke test
  não inspecionou todas as datas de participação nem substitui paridade SQL.
- Página 2500: 20 cards encerrados, botão Próxima desabilitado.
- Favoritar persistiu e apareceu em Favoritos; desfavoritar voltou à lista vazia.
  O perfil de teste foi mantido para reprodução.
- Informar na URL o perfil sintético de outro usuário
  `a63a0c83-514d-4c70-8c93-68238d4b8102` não selecionou esse perfil, não exibiu scores
  e voltou à ordenação sem perfil. Isto comprova o filtro da aplicação; não equivale
  a testar diretamente a RPC com JWT de dois usuários distintos.

Bloqueio encontrado: Ver detalhes com perfil provocou erro de servidor, digest
`1954080492`. O log aponta `Nao foi possivel buscar a analise da oportunidade.`
Uma consulta somente de leitura à API da homologação, usando chave publicável sem
login, confirmou PGRST205: `public.analises_oportunidades` não foi encontrada no
schema cache. O setup mínimo da etapa SQL não incluía essa tabela, mas a página
de detalhes consulta análises já persistidas mesmo sem solicitar geração por IA.
Não alterar a lógica de IA nem esconder o erro para aprovar o teste. Inspecionar e
completar manualmente o schema de homologação necessário à tela antes do reteste;
o script existente relacionado é `supabase/analises_oportunidades.sql`.

Não foram obtidas medições HTTP precisas nesta sessão de navegador; tempos das
ferramentas incluem automação e não devem ser apresentados como latência da aplicação.
As últimas medições SQL fornecidas pelo responsável incluem Recomendadas 1670,780 ms,
Maior aderência 1595,604–1698,645 ms e Alta 1698,184 ms. São execuções individuais,
sem garantia de latência sob concorrência. A repetição de leitura de tokens em
4201,362 ms, contra 204,096 ms antes, mostra variabilidade ainda não explicada;
não atribuir sua causa a cache, CPU ou sort sem novas evidências.

Aceite completo ainda pendente: isolamento direto das RPCs via HTTP com duas
contas reais e medição de latência
reproduzível. Sem commit, push ou PR nesta etapa.

### Reteste de detalhes após preparação manual do schema — 25/09/2026

O responsável informou aplicação manual bem-sucedida de
`supabase/analises_oportunidades.sql` no projeto de homologação. O agente não
executou SQL nem migration. Reteste autenticado no navegador passou:

- Busca `software`, status aberta, UF SC, aderência alta, perfil de teste e
  ordenação Recomendadas; navegação até a página 2.
- Ver detalhes de `Aquisição 18625` (ID `245fb923-fa8b-4005-a841-7c6db5148531`)
  carregou normalmente, sem o erro de servidor anterior.
- Exibiu score 100%, nível Alta, 3/3 palavras, 2/2 termos de segmento, palavras
  encontradas `software, gestão pública, suporte`, termos `tecnologia, software`
  e bônus de mesma UF de 10 pontos.
- Seção de análises existentes exibiu `Nenhuma análise gerada para este perfil ainda.`
  O botão de geração por IA não foi acionado.
- Voltar às oportunidades preservou busca/status/UF/perfil/aderência/ordenação e
  página 2; foram renderizados 20 cards.

O bloqueio funcional de detalhes foi resolvido pela preparação do ambiente.
Permanecem as limitações de aceite HTTP e latência registradas acima. Nenhuma
alteração de código de produto, produção, commit, push ou PR foi feita no reteste.

### Validador HTTP local — 28/09/2026

Preparado `scripts/validar-isolamento-rpc.mjs`. Configuração por variáveis locais,
critérios de PASS/FAIL e execução no PowerShell: [ISOLAMENTO-HTTP.md](ISOLAMENTO-HTTP.md).
Os seis testes simulados do validador passaram, junto à suíte local (65/65).
A tentativa real terminou com quatro FAIL / Não executado por ausência das
variáveis das contas. Não houve conexão ao Supabase nessa tentativa e não se
comprovou ainda o isolamento HTTP com as duas contas reais.

### Isolamento HTTP confirmado pelo responsável — 28/09/2026

Após configurar as duas contas reais e os respectivos perfis, o responsável
executou o validador e enviou as quatro linhas sanitizadas abaixo. Esta evidência
substitui a pendência de isolamento HTTP e os FAIL / Não executado anteriores;
não se trata de uma execução remota realizada pelo agente.

```text
PASS | Conta A / Perfil A | Perfil próprio retornou página válida com matching.
PASS | Conta A / Perfil B | Perfil alheio rejeitado explicitamente pela RPC.
PASS | Conta B / Perfil B | Perfil próprio retornou página válida com matching.
PASS | Conta B / Perfil A | Perfil alheio rejeitado explicitamente pela RPC.
```

Pelos critérios do validador: as identidades são distintas, cada perfil próprio
pertence à conta autenticada e retorna página válida com matching; os dois acessos
cruzados foram rejeitados com HTTP 403 / SQLSTATE 42501 / Perfil indisponível.
Destino fixo de homologação, chave publicável, sem service role, sem migrations ou
escritas nas tabelas da aplicação. Credenciais e tokens não foram registrados.
Os oito testes locais do validador atualizado e o lint passaram anteriormente.

O teste solicitado de isolamento desta RPC com as duas contas está aprovado nesta
execução. Não representa auditoria de todas as políticas do aplicativo. A medição
HTTP reproduzível de latência permanece pendente e os tempos SQL históricos não
devem ser apresentados como tempo HTTP. Nenhum commit, push ou merge foi feito.

### Medições HTTP finais — 29/09/2026

Executadas pelo agente entre 29/09/2026, 08:26:06 e 29/09/2026, 08:26:39 (America/Sao_Paulo, UTC−03:00).
Intervalo UTC: 2026-09-29T11:26:06.684Z a 2026-09-29T11:26:39.291Z.
Node v24.19.0, no computador local, chamando por HTTPS o PostgREST do projeto
`oportuna-homologacao` / `uzmgxxhiedevsxedgqij`. Autenticação real por e-mail/senha
da Conta A e chave publicável; identidade e propriedade do Perfil A verificadas
por consultas autenticadas. Volume de **50.000** oportunidades confirmado por
HEAD com `Prefer: count=exact` imediatamente antes das medições.

**Escopo:** HTTP real da RPC usada pela aplicação, via POST; não é SQL Editor.
Não inclui SSR do Next.js, carregamento/renderização no navegador nem tempo de
login. O perfil foi usado em todos os cenários, inclusive busca e mais novas.
O benchmark SQL histórico de busca/mais novas era sem perfil; portanto esses
dois cenários não são comparações diretas. Perfil com 3 palavras-chave e segmento
com 2 termos, o mesmo Perfil A validado no teste de isolamento.

**Método reproduzível:** um processo Node com fetch, timeout de 45 s por chamada,
redirecionamentos recusados e sem repetição automática. Preparação: login Auth
por senha, GET /auth/v1/user, SELECT do perfil sob RLS e contagem HEAD da tabela.
Para cada rodada 1, 2 e 3, executar sequencialmente Recomendadas → Maior aderência
→ Alta → Busca → Mais novas. Sem paralelismo ou pausa artificial entre chamadas.
Chamar POST `/rest/v1/rpc/listar_oportunidades_paginadas_v1` com apikey publicável
e Bearer da sessão autenticada; não registrar cabeçalhos nem credenciais.

Parâmetros comuns: `p_perfil_id` = Perfil A, `p_pagina` = 1, `p_status` e `p_uf` = null.
Parâmetros por cenário:

| Cenário | p_ordenacao | p_aderencia | p_busca |
|---|---|---|---|
| Recomendadas | recomendadas | null | null |
| Maior aderência | maior_aderencia | null | null |
| Aderência alta | recomendadas | alta | null |
| Busca textual com perfil | recomendadas | null | software |
| Mais novas com perfil | mais_novas | null | null |

Cronometrar com `performance.now()` imediatamente antes do fetch até concluir
`response.arrayBuffer()`. Parsing JSON e validação funcional ocorrem após encerrar
a cronometragem. Tamanho é o buffer do corpo recebido/descomprimido, não bytes
exatos transferidos na rede. A reutilização normal de conexão do fetch é permitida.

**Nenhuma execução foi descartada.** Não houve aquecimento dedicado. A primeira
chamada de Recomendadas foi muito mais lenta, mas isso sozinho não prova cache,
conexão fria, plano genérico, carga da instância ou qualquer causa específica.

Tempos em segundos; classificação pela média: VERDE ≤2 s, AMARELO >2–3 s,
VERMELHO >3 s. Mínimo e máximo incluem todas as três execuções.

| Cenário | Execução 1 | Execução 2 | Execução 3 | Menor | Maior | Média | Status |
|---|---:|---:|---:|---:|---:|---:|---|
| Recomendadas | 6,556 | 1,628 | 1,610 | 1,610 | 6,556 | 3,265 | VERMELHO |
| Maior aderencia | 2,391 | 1,601 | 1,730 | 1,601 | 2,391 | 1,907 | VERDE |
| Aderencia alta | 1,624 | 1,440 | 1,418 | 1,418 | 1,624 | 1,494 | VERDE |
| Busca textual com perfil | 1,743 | 1,791 | 1,833 | 1,743 | 1,833 | 1,789 | VERDE |
| Mais novas com perfil | 0,888 | 0,464 | 0,511 | 0,464 | 0,888 | 0,621 | VERDE |

| Cenário | HTTP nas 3 execuções | Corpo por execução (bytes) | Itens RPC / UI | Timeout | Erro funcional |
|---|---|---|---|---|---|
| Recomendadas | 200 / 200 / 200 | 42013 / 42013 / 42013 | 21 / 20 | Não | Não |
| Maior aderencia | 200 / 200 / 200 | 42013 / 42013 / 42013 | 21 / 20 | Não | Não |
| Aderencia alta | 200 / 200 / 200 | 42013 / 42013 / 42013 | 21 / 20 | Não | Não |
| Busca textual com perfil | 200 / 200 / 200 | 42013 / 42013 / 42013 | 21 / 20 | Não | Não |
| Mais novas com perfil | 200 / 200 / 200 | 37834 / 37834 / 37834 | 21 / 20 | Não | Não |

As 21 linhas incluem a linha extra usada pela aplicação para detectar a próxima
página; são 20 cards apresentados. Em todas as respostas foram verificados IDs
únicos, favoritos booleanos, matching completo equivalente ao TypeScript
(score, nível, palavras, termos, mesma UF e motivos), filtro de alta/busca e
ordenação interna da página. Os corpos foram idênticos nas três repetições de cada
cenário. Isso complementa, sem substituir, a paridade e o ranking global já
homologados. O isolamento com duas contas continua documentado no teste anterior;
esta rodada utilizou somente a Conta A e não refez os quatro testes cruzados.

**Decisão: não fazer commit/push nesta etapa.** Recomendadas, o cenário de maior
prioridade, registrou 6,556 s na primeira chamada (cerca de 3,9 vezes os 1,671 s
da última medição SQL) e média de 3,265 s. As outras duas chamadas foram coerentes
com o banco, mas a oscilação ainda não foi explicada. Sem descartar a primeira
amostra como warm-up sem evidência, o critério de desempenho não foi considerado
aprovado para liberar automaticamente o commit. Não houve timeout ou erro funcional.
Nenhuma otimização adicional foi aplicada e os checks condicionais de pré-commit
não foram repetidos, pois a execução parou no critério de latência.

Evidência sanitizada com milissegundos e timestamps individuais:
[http-latencia-2026-09-29.json](http-latencia-2026-09-29.json).
Não houve alteração de dados da aplicação, migration, chamada de IA, commit, push
ou merge. Somente relatório/evidência foram gravados depois das medições.

### Reteste HTTP de Recomendadas e autorização de commit — 29/09/2026

Medição real realizada entre 10:41:35 e 10:46:58 (America/Sao_Paulo), no mesmo
projeto de homologação, mesma Conta A e Perfil A, página 1, sem filtros adicionais.
Contagem autenticada confirmou 50.000 oportunidades. Mesmo método HTTP POST e
cronometragem da rodada anterior; login e validação fora do tempo medido.
Cinco chamadas consecutivas, intervalo de 300,015 segundos sem chamar a RPC e
sexta chamada com a mesma sessão. Nenhuma medição descartada.

| Execução | Tempo HTTP (ms) | HTTP | Itens | Timeout / erro funcional |
|---|---:|---:|---:|---|
| 1 | 7089,125 | 200 | 21 | Não / Não |
| 2 | 2052,787 | 200 | 21 | Não / Não |
| 3 | 1871,475 | 200 | 21 | Não / Não |
| 4 | 2002,844 | 200 | 21 | Não / Não |
| 5 | 1844,854 | 200 | 21 | Não / Não |
| 6 — após inatividade | 8028,078 | 200 | 21 | Não / Não |

Média: 3814,861 ms; mediana: 2027,816 ms; mínimo: 1844,854 ms; máximo: 8028,078 ms.
Respostas idênticas, 42.013 bytes cada; matching dos itens conferido com TypeScript.
A oscilação reapareceu: o critério automático de performance não foi aprovado.
Não há evidência suficiente para atribuir a causa a cache, rede ou PostgreSQL.
Após ser informado desses resultados e da parada, o responsável solicitou
explicitamente o commit. Esta autorização não significa resolução da latência,
aprovação de produção ou autorização para aplicar migrations. Nenhuma nova
otimização foi feita. Credenciais temporárias removidas após o teste.

#### Verificações finais para o commit autorizado

Em 29/09/2026: `npm test` 67/67 PASS; `npm run lint` PASS;
`npx tsc --noEmit` PASS; geradores Unicode/paridade com `--check` PASS;
`git diff --check` PASS; `npm run build` PASS com a configuração pública
de homologação existente. O build informou ausência de configuração de IA/e-mail,
que não impediu sua conclusão; nenhum serviço de IA foi acionado. A primeira
tentativa de teste foi impedida por EPERM ao criar subprocesso no sandbox;
a repetição autorizada fora dessa restrição passou sem alteração de código.

Revisão do escopo: listagem, matching, navegação, contador do dashboard, testes
e documentação. Única migration nova: `supabase/oportunidades_paginadas_v1.sql`.
Sem alterações em PNCP, alertas, checkpoints, serviços de IA/análise ou migrations
antigas. Arquivos de ambiente e credenciais não integram a entrega; exemplos de
autenticação nos testes são fictícios. Migration de produção não executada.

### Ciclo de vida V2 — homologação de 29/09/2026

Projeto isolado `oportuna-homologacao` (`uzmgxxhiedevsxedgqij`), PostgreSQL
17.6, 50.000 oportunidades sintéticas. A nova migration
`supabase/oportunidades_ciclo_vida_v1.sql` foi executada **somente aqui**;
nenhuma migration desta etapa foi aplicada em produção. A V2 foi ajustada para
classificar diretamente as linhas elegíveis e montar o estado descritivo apenas
para os cards da página. Não houve UPDATE/DELETE de oportunidades nem alteração
dos 50.000 registros. As consultas de teste autenticadas terminaram em ROLLBACK.

Nesta massa, **todos os 50.000** registros têm `participacao_prazo_limite` nulo;
10.000 têm status `encerrada`. A view e o resumo retornaram 40.000 na visão
padrão como prazo a confirmar e 10.000 no histórico. Isso valida o tratamento
conservador e o corte antes do ranking, mas não representa a distribuição de
prazos reais preenchidos.

Sob `SET LOCAL ROLE authenticated` e JWTs de teste, a V2 retornou página com
matching para o perfil próprio do usuário sintético A e de um usuário de teste B
do ambiente; os dois acessos cruzados foram rejeitados com `42501`. Não foi
usada service role para essas chamadas. A função de situação passou para prazo
futuro, vencido, ausente e status encerrado; Ativas não retornou encerradas,
Histórico não retornou ativas, a visão inválida foi rejeitada, e o resumo
separou 40.000/50.000. Na primeira página de **Todas**, V1 e V2 devolveram
21 linhas na mesma ordem, com **zero divergência** de ID, JSON de matching ou
favorito. Os 38 cenários de paridade e os 16 de normalização pertencem à V1;
os helpers de matching não foram modificados nesta etapa.
`has_table_privilege` e `has_function_privilege` confirmaram: `anon` não acessa
a view nem executa a V2; `authenticated` tem SELECT na view.

`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` na mesma sessão, mesmo perfil sintético,
sem filtros, página 1, mediu a RPC externa. O plano expõe apenas `Function Scan`,
portanto os números não isolam o custo de cada operação interna.

| Consulta | Tempos observados (ms) | Observação |
|---|---|---|
| V1 Recomendadas / Todas | 1579,130; 1686,522; 1524,768; 1666,247 | Base anterior, 50.000 elegíveis |
| V2 inicial Recomendadas / Ativas | 2215,654; 2202,372; 2215,230 | Versão intermediária, substituída |
| V2 final Recomendadas / Ativas | 2833,829; 1604,810; 1484,069 | 40.000 elegíveis; primeira execução após `CREATE OR REPLACE` oscilou |
| V2 final Recomendadas / Todas | 1628,213 | 50.000 elegíveis |

Não se atribui ganho percentual à classificação: a amostra tem prazos finais
todos nulos, o banco apresentou oscilação após recriar a função e houve somente
uma medição da V2 final em Todas. A execução estável de Ativas ficou próxima
da V1 na mesma massa, mas falta medição HTTP desta etapa e volume representativo
de prazos PNCP preenchidos. A oscilação HTTP de Recomendadas registrada acima
na V1 também permanece risco conhecido até investigação específica.

O primeiro resumo do dashboard pela view mediu 6794,403 ms e a repetição
1200,594 ms. Planos diretos separaram a contagem pela view (545,183 ms),
a contagem na tabela com o mesmo predicado (160,932 ms) e a seleção do card
na tabela (111,276 ms). A função de resumo passou a usar a tabela sob o mesmo
RLS, classificando apenas o card selecionado. Depois do ajuste, a RPC mediu
124,480 ms e 239,499 ms; retornou 40.000 ativas/a confirmar, 50.000 na base
e um card válido. São medições SQL, não tempos HTTP.

### Planos e permissões — homologação de 01/10/2026

No projeto isolado `oportuna-homologacao` (`uzmgxxhiedevsxedgqij`), após a
execução manual de `alertas_email.sql` e `planos_e_permissoes_v1.sql`, uma
consulta somente leitura confirmou as cinco tabelas novas, RLS habilitado nas
cinco, cinco gatilhos centrais, e a presença das RPCs V2 e de desbloqueio.
`authenticated` executa as RPCs V2 e de desbloqueio, mas não executa a RPC V1
nem o helper `matching_calcular_v1`.

O operador informou que `tests/sql/planos-permissoes.sql` foi executado inteiro
com sucesso no SQL Editor da homologação. O script testa cotas e isolamento sob
duas identidades `authenticated` e termina em `ROLLBACK`; o resultado da execução
foi informado pelo operador, não capturado por automação local.

O teste HTTP real de `listar_oportunidades_paginadas_v2` foi executado com duas
contas distintas e perfis próprios, pela chave publicável da homologação. O
validador confirmou a identidade e a propriedade dos perfis antes das RPCs;
as quatro respostas sanitizadas foram:

| Caso | Resultado |
|---|---|
| Conta A / Perfil A | PASS: página própria válida |
| Conta A / Perfil B | PASS: perfil alheio rejeitado |
| Conta B / Perfil B | PASS: página própria válida |
| Conta B / Perfil A | PASS: perfil alheio rejeitado |

Na aplicação local ligada exclusivamente à homologação, uma conta Free real
abriu a listagem e um detalhe com perfil selecionado; consultas de leitura em
`score_desbloqueios` confirmaram **zero** consumo. O primeiro desbloqueio
exibiu score, nível e motivos e elevou a contagem diária a **1**. Um segundo
desbloqueio da mesma oportunidade com outro perfil da mesma conta e um terceiro
desbloqueio de outra oportunidade elevaram a contagem a **3**. Uma quarta
oportunidade inédita recebeu a mensagem “Limite de 3 novos scores por dia
atingido no plano Free.”; o score continuou oculto. Reabrir o primeiro score
mostrou os mesmos dados e manteve a contagem em **3**. A contagem foi feita para
o usuário, não apenas para um perfil. A ação na interface chamou a RPC pelo
servidor, mas ainda falta a tentativa HTTP direta autenticada acima da cota.

Consultas de leitura sob `authenticated` verificaram as visões Ativas,
Histórico e Todas sem perfil, o mascaramento de matching, filtros combinados
com perfil e páginas distintas de `maior_aderencia`. A comparação inicial de
todas as 21 linhas de cada página acusou uma linha em comum: a linha 21 é a
sentinela intencional de `temProxima` e passa a ser a linha 1 da página 2.
Repetida a comparação dos **20 cards exibidos** de cada página, não houve
sobreposição. Nenhum dado ou função foi alterado nesse diagnóstico.
Busca `software` + status `aberta` + UF `SC` retornou amostra não vazia com esse
perfil. A combinação adicional com aderência `alta` retornou zero itens;
portanto ela comprova resposta vazia, não ordenação de itens de alta aderência
para esse perfil. O roteiro transacional de planos cobre a classificação e o
corte global com oportunidades sintéticas controladas.

A repetição integral de `tests/sql/matching-paridade.sql` na homologação foi
informada pelo operador como `Success`, sem exceção: PASS para os 38 fixtures de
matching, score scalar e 16 normalizações. O texto do `NOTICE` não foi capturado
automaticamente; o roteiro abortaria com exceção em qualquer divergência.
Os testes HTTP Free/Pro e suas medições estão registrados abaixo.

Para viabilizar o teste Pro real, a segunda conta de teste (distinta da conta
Free acima) recebeu **somente em homologação** uma linha `PRO/active` em
`assinaturas_usuario`. O setup transacional exigiu exatamente 50.000
oportunidades e perfis pertencentes a usuários diferentes antes de gravar; uma
consulta posterior confirmou uma assinatura Pro ativa. Não foram alteradas
oportunidades, desbloqueios, migrations nem dados de produção. A conta Free
permanece no fallback Free para usuários anteriores à migration.

Uma transação com `SET LOCAL ROLE authenticated` e JWT da segunda conta
confirmou `plano_atual_v1() = PRO`, página de Recomendadas com matching visível
e retorno verdadeiro de `desbloquear_score_v1`; terminou em `ROLLBACK`. Isso
valida a regra no banco, mas não substitui o teste HTTP com login real Pro.
O operador informou não ter acesso às credenciais dessa segunda conta.
Assim, sua assinatura de setup foi restaurada para `FREE/active` na homologação;
o teste HTTP Free/Pro foi realizado depois com a conta acessível em duas fases,
restaurando o plano Free ao fim.

O medidor HTTP final foi executado manualmente com
`& .\scripts\medir-planos-homolog.ps1` em PowerShell na raiz do projeto. O
roteiro pede o plano esperado, a chave publicável da homologação, e-mail/senha
e UUID do perfil no terminal; não recebe service role e não grava esses
valores. Foi executado primeiro com `FREE` e depois com `PRO`, após o setup
controlado da mesma conta. A saída sanitizada fica no diretório temporário do
usuário. Ele confirma o bloqueio da quarta tentativa diretamente na RPC no
Free, quatro acessos no Pro e mede três chamadas de cada cenário/plano,
incluindo status, duração, bytes e itens.

Primeira execução HTTP Free do medidor: o quarto desbloqueio direto retornou
HTTP 200 com `false` e a cota permaneceu em 3 (PASS). Recomendadas mediu
1875,6 / 1730,5 / 1648,6 ms (média 1751,6 ms, 21 linhas, HTTP 200).
Maior aderência mediu 1637,4 / 1638,2 / 1566,3 ms (média 1614,0 ms,
21 linhas, HTTP 200). A primeira chamada de aderência alta retornou HTTP 200,
lista vazia e 1296,6 ms; o medidor interrompeu a coleta porque exigia ao menos
um item. Esse critério do medidor foi corrigido para aceitar lista vazia apenas
nesse filtro, sem alterar a aplicação ou o banco. A rodada parcial não substitui
as três execuções completas exigidas para os quatro cenários.

Segunda execução HTTP Free completa, no mesmo perfil e nas mesmas 50.000
oportunidades. Todas as 12 chamadas tiveram HTTP 200, PASS, sem timeout ou erro
funcional; o bloqueio direto do quarto score foi confirmado novamente (HTTP
200, `false`, cota permaneceu em 3). Tempos em milissegundos:

| Cenário Free | Execução 1 | Execução 2 | Execução 3 | Mínimo | Máximo | Média | Mediana | Itens por chamada |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Recomendadas | 1912,0 | 1636,7 | 1530,7 | 1530,7 | 1912,0 | 1693,1 | 1636,7 | 21 |
| Maior aderência | 1500,0 | 1579,2 | 1506,9 | 1500,0 | 1579,2 | 1528,7 | 1506,9 | 21 |
| Aderência alta | 1351,0 | 1346,4 | 1420,2 | 1346,4 | 1420,2 | 1372,5 | 1351,0 | 0 |
| Busca textual | 1284,3 | 1285,1 | 1321,4 | 1284,3 | 1321,4 | 1297,0 | 1285,1 | 21 |

Aderência alta retorna lista vazia para este perfil; zero itens é resultado
válido do filtro e não mede renderização de cards. As outras respostas tinham
35.515 bytes; a lista vazia tinha 2 bytes. As 21 linhas incluem a sentinela
de paginação, ou seja, no máximo 20 cards exibidos.

Na sequência, a **mesma conta** foi promovida temporariamente a `PRO/active`
somente na homologação; a linha de assinatura não existia antes do setup.
Quatro chamadas diretas a `desbloquear_score_v1` retornaram HTTP 200 e `true`.
As 12 chamadas de listagem tiveram HTTP 200, PASS, sem timeout ou erro
funcional. Tempos em milissegundos:

| Cenário Pro | Execução 1 | Execução 2 | Execução 3 | Mínimo | Máximo | Média | Mediana | Itens por chamada |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Recomendadas | 2050,3 | 1967,8 | 1777,9 | 1777,9 | 2050,3 | 1932,0 | 1967,8 | 21 |
| Maior aderência | 1693,9 | 1670,4 | 1793,2 | 1670,4 | 1793,2 | 1719,2 | 1693,9 | 21 |
| Aderência alta | 1636,8 | 1330,0 | 1241,5 | 1241,5 | 1636,8 | 1402,8 | 1330,0 | 0 |
| Busca textual | 1422,2 | 1331,5 | 1330,2 | 1330,2 | 1422,2 | 1361,3 | 1331,5 | 21 |

Respostas Pro com 21 linhas tinham 40.816 bytes; a lista vazia de alta tinha
2 bytes. A diferença para Free inclui a presença do objeto de matching na
resposta, variação normal entre chamadas e possível aquecimento; esta amostra
não isola o custo do plano. Após o teste, a assinatura foi atualizada para
`FREE/active` e confirmada por leitura. Isso restaura o plano efetivo, mas
mantém a linha explícita de assinatura Free criada no setup, em vez do fallback
sem linha anterior. Não houve alteração na massa de oportunidades.

Comparação orientativa com a baseline HTTP V1 anterior (Mais novas 0,621 s,
Aderência alta 1,494 s, Busca textual 1,789 s, Maior aderência 1,907 s;
Recomendadas estáveis perto de 1,6–2,0 s, com uma primeira execução de
6,556 s): as médias desta rodada Free/Pro ficaram entre 1,297 e 1,932 s.
Não houve repetição de timeout nem da execução de 6+ s. As visões, perfis e
payloads diferem da baseline, portanto a comparação não demonstra ganho
causal, apenas ausência de degradação relevante nesta amostra.

Validação local final: `npm test` 75/75 PASS, `npm run lint` PASS,
`npx tsc --noEmit` PASS, `git diff --check` PASS, geradores Unicode e de
paridade SQL em modo `--check` PASS, `npm run build` PASS. A primeira tentativa
do teste de integração recebeu `spawnSync ... EPERM` no sandbox; repetida com
execução permitida, passou. A primeira tentativa de build falhou por falta de
rede para buscar Geist/Geist Mono; repetida com rede, compilou e gerou as 18
páginas estáticas. Nenhum arquivo ou configuração foi alterado para contornar
essas restrições.
