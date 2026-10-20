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
  `identificador de fixture omitido` não selecionou esse perfil, não exibiu scores
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
- Ver detalhes de `Aquisição 18625` (ID `identificador de fixture omitido`)
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

### Asaas Sandbox — preparação do E2E de 05/10/2026

Ambiente: Preview da branch `feat/asaas-assinatura-pro`, ligado ao projeto
`oportuna-homologacao` (`uzmgxxhiedevsxedgqij`). Produção não foi alterada.
Os resultados abaixo são verificações preparatórias; **não comprovam ainda
pagamento E2E Pro ou Business**.

- `npm test`: **81/81 PASS**. A primeira execução passou em 80 testes e recebeu
  `spawnSync EPERM` no teste que inicia um subprocesso; a repetição com execução
  permitida passou integralmente, sem alteração de código.
- `tests/sql/asaas-billing.sql`: **PASS**, executado integralmente no SQL Editor
  da homologação, terminando em `ROLLBACK`. Foi adicionada somente na consulta
  do editor uma linha de resultado antes do rollback para tornar o sucesso
  visível. Os fixtures usam identidades, preços e pagamentos sintéticos;
  não fazem chamadas ao Asaas nem representam os valores comerciais do E2E.
- A suíte SQL verificou reserva/reuso de checkout, rejeição de Free como plano
  pago, `CHECKOUT_PAID` e `SUBSCRIPTION_CREATED` sem ativação, confirmação
  vinculada ao checkout, Pro/Business, duplicidade sem extensão de período,
  renovação, atraso, reembolso/chargeback, isolamento e fallback Free.
- Token inválido no webhook do Preview, com bypass da Vercel válido:
  **HTTP 401 / PASS**, duração total aproximada **1.231 ms**, em 05/10/2026
  por volta de 23h40 de Brasília. A requisição foi rejeitada antes do
  processamento de eventos. Nenhum token, cookie ou credencial foi registrado.

Pendentes nesta etapa: login de duas contas Free reais, checkout hospedado,
pagamento aprovado/recusado no Sandbox, entrega real de `PAYMENT_CONFIRMED`,
correlação das tabelas de billing e entitlements na aplicação; cancelamento,
expiração e reenvio no fluxo real. A aprovação desta suíte não substitui essas
evidências e não autoriza merge.

Continuação com login real Free, em 05/10/2026, por volta de 23h41 de Brasília:

- `/planos` mostrou `FREE`, Pro R$ 99,00/mês com 200 análises e Business
  R$ 197,00/mês com 1.000 análises: PASS para configuração e apresentação.
- Acesso direto a `/planos/retorno?estado=sucesso`, sem pagamento ou evento:
  plano efetivo continuou `FREE`: PASS; a mensagem informa que o retorno
  não libera acesso e que a confirmação depende do webhook financeiro.
- Tentativa de iniciar Pro com pagador fictício: bloqueada antes do checkout
  hospedado. O Preview redirecionou com mensagem genérica de falha.
  Vercel registrou um POST `/api/billing/checkout` às 23h41m56s, HTTP 303,
  duração total de 584 ms. O duplo clique não foi concluído pelo controle de
  navegador, pois o primeiro envio navegou; **concorrência HTTP não validada**.
- Logs do Supabase às 23h41m57s: POST
  `/rest/v1/rpc/billing_reservar_cliente_v1` recebeu HTTP 401, com PostgreSQL
  `42501: permission denied for function billing_reservar_cliente_v1`.
- Consulta somente leitura confirmou `service_role` com EXECUTE nessa função;
  `anon` e `authenticated` sem EXECUTE, como previsto. Contagens nas quatro
  tabelas de billing permaneceram em zero. Nenhum pagamento foi realizado.

A causa comprovada é a rejeição de permissão na primeira RPC administrativa;
o valor efetivo de `SUPABASE_SECRET_KEY` no deployment não foi confirmado.
Essa variável da Vercel é Secret/write-only, limitada ao Preview desta branch.
Próxima etapa: conferir/reinserir a chave backend existente da homologação no
Preview e repetir após redeploy, preservando os grants e RLS. Nenhum grant foi
ampliado nem dado alterado para contornar o bloqueio. Pro e Business ainda
**não estão homologados por pagamento E2E**.

Continuação em 06/10/2026, por volta de 00h00 de Brasília:

- O usuário atualizou `SUPABASE_SECRET_KEY`; metadados da Vercel confirmaram
  escopo somente Preview da branch `feat/asaas-assinatura-pro` (Secret).
  Nenhum valor de chave foi registrado.
- Redeploy `dpl_9yNVT5TU13wsY2zR3y7u5CTiDP8K`: READY, build de 35 s,
  mesmo commit `d8e2bc2e484b732692db8a99b4b95a65ec8129e2`, ambiente Preview.
  Produção não foi alterada.
- Nova tentativa Pro ultrapassou a RPC administrativa: um cliente Sandbox
  foi criado/vinculado, com `billing_customers.status_local = ready`.
- Logs de requisições do Asaas: `/api/v3/customers` HTTP 200;
  POST `/api/v3/checkouts` HTTP 400. A resposta `invalid_object` exige no
  cliente os campos `email`, `phone`, `address`, `addressNumber`, `postalCode`,
  `province` e `city`, ausentes no cadastro criado pelo fluxo atual.
- A reserva local contém PRO, 9.900 centavos e franquia 200, porém está
  `uncertain`, sem checkout remoto vinculado e sem `paid_until`.
  Contagens: 1 cliente, 1 reserva de assinatura, 0 pagamentos, 0 eventos.
  A aplicação continua mostrando FREE, com assinatura em processamento/revisão.
- Nenhum pagamento ou ativação de plano ocorreu. Não foram feitas novas
  tentativas, alterações diretas nas tabelas, mudanças de grants ou migrations
  para contornar o erro.

Novo bloqueio comprovado: o fluxo cria um cliente Asaas incompleto e o envia
como `customer` ao checkout. É necessária uma correção desse fluxo e uma
conciliação controlada da reserva antes de retomar os pagamentos E2E.
Completar manualmente o cliente de teste ocultaria a falha do cadastro inicial.
A documentação oficial descreve também a coleta dos dados no checkout quando
`customer`/`customerData` são omitidos; essa alternativa exige preservar a
correlação segura de cliente, checkout, assinatura e confirmação financeira.
Referência: https://docs.asaas.com/docs/como-informar-os-dados-do-cliente.
E2E Pro/Business e cenários financeiros negativos permanecem pendentes.

### Correção do cadastro do pagador — 07/10/2026

- Pro e Business abrem diálogo com nome, CPF/CNPJ, e-mail, celular, CEP,
  número e complemento opcional. Nome e e-mail vêm da conta autenticada;
  documento não é copiado do perfil de empresa. FREE não cria checkout.
- Validação no servidor verifica campos obrigatórios, dígitos de CPF/CNPJ,
  formato de e-mail, celular e CEP, número e limites de tamanho. Documento,
  celular e CEP são enviados normalizados. Erros não incluem dados pessoais.
- Payload de cliente: `name`, `cpfCnpj`, `email`, `mobilePhone`, `postalCode`,
  `addressNumber`, `complement` quando preenchido e `externalReference`
  derivado do usuário autenticado no servidor. Nenhum endereço é inventado.
- Cliente já vinculado é consultado e reutilizado pelo mesmo ID. Campos
  diferentes são atualizados por PUT antes do checkout, após validar a
  correspondência de `externalReference`. Falha de atualização interrompe
  o fluxo e não cria outro cliente. Conciliação conserva proteção contra
  duplicação de clientes.
- Checkout continua enviando somente `customer`, sem `customerData`.
  Preços e franquias permanecem no catálogo/configuração do servidor:
  Pro R$ 99 / 200 análises; Business R$ 197 / 1.000 análises.
  Webhook e regra de ativação financeira não foram modificados.
- Validação local: **100/100 testes PASS**, lint PASS, TypeScript PASS,
  build PASS, geradores de paridade/Unicode PASS e diff check PASS.
  Testes cobrem campos inválidos, payload, criação/reutilização/atualização,
  rejeição de cliente alheio, falha de atualização, adulteração de preço,
  planos permitidos e retorno de sucesso sem ativação.
- Revisão visual: diálogo conferido em página local com dados fictícios,
  usando o componente renderizado e CSS compilado; não houve envio de
  pagamento nessa revisão. Formulário em duas colunas nos campos menores,
  com rolagem e botão de continuar, fora dos cards de planos.
- Preview da branch atualizado e READY, mantendo proteção da Vercel.
  Não houve novo commit, push, migration ou alteração de produção.
- **Pendente:** confirmar no Sandbox se CEP + número bastam para preencher
  os campos de endereço e se `mobilePhone` satisfaz o checkout. A reserva
  `uncertain` da tentativa anterior ainda bloqueia o botão da conta Free.
  A aprovação automática rejeitou a tentativa de encerrar somente essa
  reserva, porque o painel mostra o rótulo `main PRODUCTION`, apesar do
  nome/ref conhecidos de homologação. Nenhuma alteração no banco ocorreu.
  É necessária confirmação explícita do ambiente/setup controlado ou outra
  conta Free antes de retomar o E2E Pro. Não há evidência de pagamento ou
  ativação com este ajuste; Business e negativos financeiros continuam
  pendentes.

### Retomada E2E Pro após autorização pontual — 07/10/2026

- O usuário confirmou que `uzmgxxhiedevsxedgqij` é exclusivamente homologação
  e autorizou encerrar apenas a reserva anterior `uncertain` sem excluir
  cliente, histórico ou outros registros.
- Conferência anterior: reserva PRO `uncertain`, sem checkout remoto,
  assinatura remota ou período pago; zero pagamentos e eventos; um cliente.
- UPDATE limitado ao ID dessa reserva, estado `uncertain`, ausência de IDs
  remotos/período pago e ausência de pagamentos relacionados: **1 reserva
  encerrada** em `canceled`. O registro foi mantido. Nenhum DELETE foi feito.
- Na aplicação, plano permaneceu FREE e os botões Assinar Pro/Business
  voltaram a ficar disponíveis. Modal real Pro mostrou R$ 99,00/mês, nome
  e e-mail pré-preenchidos. Para o envio foram usados dados fictícios.
- Nova tentativa às **21h36 de 07/10/2026, conforme horário exibido nos logs
  do Asaas Sandbox**: PUT no cliente existente retornou **HTTP 400**:
  `{"errors":[{"code":"invalid_mobilePhone","description":"O celular informado é inválido."}]}`.
  O celular fictício passou na validação local de formato, mas foi rejeitado
  pela validação adicional do gateway. Não houve nova chamada de criação
  de checkout na lista de requisições observada.
- O payload observado inclui `name`, `cpfCnpj` (mascarado pelo painel),
  `email`, `mobilePhone`, `postalCode` e `addressNumber`; cliente existente
  foi reutilizado no caminho PUT. Dados pessoais não são reproduzidos aqui.
- Conferência posterior somente leitura: reserva anterior `canceled`,
  cliente `ready` com ID remoto preservado, **1 reserva da conta**,
  **0 pagamentos**, **0 eventos** e plano cadastrado **FREE**.
- **Parada solicitada pelo usuário:** nenhuma nova tentativa, atualização
  adicional de dados ou limpeza foi feita após o HTTP 400. CEP + número e
  geração de checkout ainda não estão validados; pagamento e ativação Pro
  permanecem pendentes. Próxima tentativa precisa de celular de teste aceito
  pelo Sandbox. O erro não comprova exigência de campos extras de endereço.
- Produção, migrations, merge e commits não foram alterados nesta retomada.

### Cadastro mínimo aceito; bloqueio no link de checkout — 08/10/2026

- Conforme autorização, repetido somente no Asaas Sandbox com o celular
  fictício indicado pelo usuário; demais dados de pagador permaneceram
  fictícios. Nenhum número real de terceiro foi buscado ou utilizado.
- Logs às **07h30 de 08/10/2026, conforme horário exibido pelo Asaas**:
  PUT no mesmo cliente remoto **HTTP 200**, seguido de POST `/api/v3/checkouts`
  **HTTP 200**. Nenhum HTTP 400 nesta tentativa.
- Payload PUT: nome, documento, e-mail, `mobilePhone`, `postalCode` e
  `addressNumber`. Complemento vazio não enviado. Não foram enviados
  `address`, `province` nem `city`. A resposta de cliente preenchia esses
  campos automaticamente a partir do CEP, incluindo cidade/UF.
- **CEP + número foram suficientes para criar este checkout Sandbox.**
  `mobilePhone` foi aceito; `phone` permaneceu null na resposta do cliente,
  sem impedir a criação. Evidência específica desta tentativa, não garantia
  para qualquer CEP/cadastro. Nenhum novo cliente foi criado.
- Checkout enviado com `customer` do cliente existente, sem `customerData`;
  PRO mensal R$ 99,00, estado remoto ACTIVE, expiração configurada de 60 min.
- **Novo bloqueio local comprovado:** o link retornado começa com
  `https://sandbox.asaas.com/000/checkoutSession/show/`.
  `validarUrlCheckout` exige que pathname comece com `/checkoutSession/`,
  rejeitando esse prefixo `/000/`. Reprodução direta com o validador atual:
  `URL de Checkout Sandbox invalida.`. A aplicação retornou erro genérico,
  em vez de redirecionar para o checkout hospedado.
- Consulta somente leitura posterior: evento `CHECKOUT_CREATED` processed;
  nova reserva `checkout_pending`, checkout e link vinculados pelo webhook,
  cliente `ready`, plano cadastrado FREE, sem período pago e zero pagamentos.
  A reconciliação foi automática pelo fluxo existente; não houve limpeza,
  cancelamento manual, alteração de reserva ou ativação direta.
- Parada no bloqueio de redirecionamento. Nenhum pagamento realizado;
  PAYMENT_CONFIRMED, ativação Pro e checkout hospedado permanecem pendentes.
  Correção necessária: validar estritamente também o formato Sandbox
  efetivamente retornado, mantendo HTTPS/domínio e restrição de caminho;
  não afrouxar para qualquer URL. Nenhuma correção de código feita nesta
  coleta. Não abrir outro checkout para contornar o bloqueio.
- Produção, migrations, merge, commit e push não foram alterados. Resultado
  registrado sem CPF, endereço completo, credenciais ou tokens.

### Validador corrigido e retomada do mesmo checkout Pro — 08/10/2026

- Alteração restrita ao caminho em `validarUrlCheckout`: aceita
  `/checkoutSession/` e `/000/checkoutSession/`. Mantidos HTTPS, host exato
  `sandbox.asaas.com`, ausência de porta alternativa e credenciais na URL.
  Produção, subdomínios, outros caminhos e prefixos numéricos continuam
  rejeitados. Regras de preço, plano, billing e webhook não foram alteradas.
- Testes cobrem os dois formatos válidos e rejeitam produção, host falso,
  subdomínio, HTTP, porta alternativa, credenciais, outro caminho, outro
  prefixo numérico, prefixo duplicado e nome de caminho semelhante.
- Validação: **111/111 testes PASS**, lint PASS, TypeScript PASS,
  diff check PASS, build PASS. Primeiro build restrito falhou por acesso
  negado na canonicalização de diretório pelo SWC/Windows; a repetição
  autorizada fora dessa restrição terminou com sucesso.
- Preview `dpl_9thjG7QvQMpqVGyVbnVAbcc9Frpg` READY, ambiente Preview,
  publicado a partir dos arquivos locais, sem novo commit/push.
  Somente alias da branch `feat/asaas-assinatura-pro` foi atualizado.
- Após reload, Continuar pagamento reutilizou a reserva e abriu o checkout
  hospedado já existente. Identificação/endereço completos, valor R$ 99,00,
  recorrência mensal; nenhuma limpeza, novo cliente ou novo checkout.
- Pagamento exclusivamente fictício no Sandbox: página hospedada mostrou
  **Pagamento confirmado**. Dados de cartão não são armazenados neste
  relatório nem pela aplicação Oportuna.
- Retorno `estado=sucesso` mostrou **FREE / checkout_pending**, antes da
  confirmação financeira no backend: successUrl não ativou Pro sozinha.
- **Novo bloqueio do E2E:** logs de webhooks às 07h47, horário exibido pelo
  Asaas em 08/10/2026, mostraram HTTP 503 nas entregas financeiras. Detalhe
  de uma entrega confirmou evento `PAYMENT_CONFIRMED`; painel mostrou
  configuração penalizada. Não foram feitos reenvios manuais ou mudanças
  de configuração para contornar esse erro. Causa interna do 503 ainda
  não comprovada; não atribuir ao token, banco ou API sem nova evidência.
- Auditoria somente leitura: CHECKOUT_CREATED, CHECKOUT_PAID,
  PAYMENT_CREATED e SUBSCRIPTION_CREATED registrados como processed,
  um de cada; PAYMENT_CONFIRMED ainda ausente. Reserva `checkout_paid`,
  ID de checkout preservado, assinatura remota ainda não vinculada,
  franquia prevista 200, nenhum período pago, zero billing_payments;
  assinatura de usuário permanece FREE. Nenhuma ativação foi forçada.
- Correção e retomada do redirecionamento: PASS. **E2E Pro completo ainda
  bloqueado pela entrega/processamento de PAYMENT_CONFIRMED.** Parada sem
  alterar webhook/billing fora do escopo. Business e negativos financeiros
  não foram executados nesta retomada.
- Produção, migrations e merge não foram alterados; nenhum commit/push.

### PAYMENT_CONFIRMED HTTP 503: diagnóstico e correção — 08/10/2026

- Somente Preview da branch `feat/asaas-assinatura-pro`, Supabase
  `uzmgxxhiedevsxedgqij` de homologação e Asaas Sandbox. Preservados o mesmo
  cliente, checkout, pagamento, reserva e ID de evento. Nenhuma nova cobrança,
  pagamento, limpeza, migration, ativação manual, commit, push ou merge.
- Logs do Preview às 08:07 e 08:22 BRT: POST `/api/webhooks/asaas` HTTP 503.
  A sequência de chamadas passou por `billing_evento_processado_v1`, GET da
  cobrança no Asaas, `billing_checkout_pendente_v1` e GET da listagem filtrada
  pelo checkout; não chegou a `billing_processar_webhook_v1`.
- Diagnóstico sanitizado no Preview às 08:40:39 BRT comprovou a condição do
  503: listagem retornou `hasMore=false`, `itemCount=0`, sem pagamento,
  assinatura ou cliente correspondentes. O handler rejeitou a correlação.
  Não houve erro de token, validação financeira inicial ou projeção de plano.
  A razão interna de o Asaas retornar lista vazia não foi determinada; não
  afirmar atraso de indexação como fato.
- Antes da correção: PAYMENT_CONFIRMED ausente em `billing_webhook_events`,
  portanto sem status local pending/error/processed. O retry estava na fila
  Asaas, com configuração ativa e penalizada. Reserva checkout_paid, plano
  FREE, sem assinatura remota vinculada, período pago ou billing_payment.
- Correção restrita à correlação: usar `checkoutSession` da cobrança obtida
  pelo GET autenticado `/payments/{id}` e compará-lo ao checkout salvo no banco.
  Campo divergente/malformado é rejeitado, sem contornar pela listagem. Quando
  o campo estiver ausente/null, permanece o fallback anterior de listagem,
  exigindo pagamento, assinatura e cliente coincidentes e lista não truncada.
  O checkout enviado no payload do webhook não é usado como prova desse vínculo.
  Mantidas validação financeira, token, RPC transacional, RLS e idempotência.
- O diagnóstico temporário de contagem foi substituído por logs sanitizados
  de falha, sem payload, documento, telefone, endereço, cartão ou secrets.
- **119/119 testes PASS**, lint PASS, TypeScript PASS, diff check PASS,
  build PASS. Oito testes novos cobrem lista vazia com vínculo autenticado,
  checkout divergente/malformado, fallback, erros de consulta, handler com
  payload não confiável, valor divergente e RPC retornando retry/HTTP 503.
- Preview corrigido `dpl_G5eqJEiMg48gWcU9uv5o2rk2C3d7` READY, target Preview,
  publicado com arquivos locais; somente alias da branch atualizado.
- Após publicação, o **mesmo evento** foi reenviado automaticamente pelo Asaas
  às **08:45 BRT**. Preview registrou POST **HTTP 200** às 08:45:47;
  `billing_webhook_events` registrou **processed**, sem erro, às
  `2026-10-08 11:45:49.641685+00` (08:45:49 BRT).
  Uma remoção pontual de backoff foi usada para obter o diagnóstico anterior;
  nenhuma configuração de URL, token, eventos ou autenticação foi alterada.
  Uma solicitação posterior de remoção de backoff não fez alteração: o Asaas
  informou que já não havia eventos penalizados, pois a entrega havia passado.
- Auditoria somente leitura depois da entrega: billing_payment
  PAYMENT_CONFIRMED; billing_subscription active, assinatura remota vinculada;
  assinaturas_usuario PRO/active; franquia IA **200**; paid_until e fim_em
  **2026-11-08 03:00:00+00** (08/11/2026 00:00 BRT), futuros no momento da coleta.
  A aplicação passou a exibir PRO, até 3 perfis, scores/favoritos ilimitados,
  alertas/histórico completo e 200 análises por mês, válido até 08/11/2026.
- successUrl anteriormente mostrou FREE/checkout_pending e continuou sem
  ativar plano sozinha; a ativação ocorreu somente com PAYMENT_CONFIRMED
  verificado pela API e processado pela RPC transacional.
- Reenvios automáticos são documentados pelo Asaas para respostas diferentes
  de HTTP 200, com intervalos progressivos e interrupção após 15 falhas:
  https://docs.asaas.com/docs/penaliza%C3%A7%C3%A3o-de-filas
- Resultado: **E2E Pro do pagamento existente PASS**. Esta correção não executou
  Business nem ampliou os negativos financeiros; essas validações continuam
  pendentes antes de declarar a integração completa pronta para produção.

### E2E Business real no Asaas Sandbox — 08/10/2026

- Preview `dpl_G5eqJEiMg48gWcU9uv5o2rk2C3d7`, branch
  `feat/asaas-assinatura-pro`, Supabase de homologação
  `uzmgxxhiedevsxedgqij`. Conta autenticada distinta da conta Pro, confirmada
  pela comparação dos proprietários das reservas; estava FREE antes do teste.
- Acesso isolado a `/planos/retorno?estado=sucesso` manteve FREE. A página
  informa explicitamente que não libera acesso: successUrl não ativa plano.
- Modal Assinar Business exibiu **R$ 197,00/mês**. Pagador e cartão
  exclusivamente fictícios de Sandbox. Celular brasileiro fictício,
  CEP + número aceitos; endereço restante preenchido pelo Asaas.
  Nenhum dado de cartão foi enviado ao Oportuna ou salvo neste relatório.
- Checkout hospedado mostrou Oportuna Business mensal, recorrência mensal e
  total R$ 197,00; pagamento aprovado. Antes do pagamento: reserva BUSINESS,
  checkout_pending, valor 19700 centavos, franquia prevista 1000, plano efetivo
  FREE e uma assinatura em curso. Não houve limpeza ou ativação manual.
- `PAYMENT_CONFIRMED` entregue com **HTTP 200** às **11:05 BRT**;
  confirmação financeira no banco em `2026-10-08 14:05:05.525674+00`.
  Evento registrado uma vez em `billing_webhook_events`, **processed**, erro null.
- Depois do webhook: billing_payment PAYMENT_CONFIRMED, billing_subscription
  BUSINESS/active, assinaturas_usuario BUSINESS, franquia **1000**, paid_until
  e fim_em **2026-11-08 03:00:00+00** (08/11/2026 00:00 BRT). Aplicação exibiu
  BUSINESS, 1000 análises por mês, R$ 197,00 e validade até 08/11/2026.
  Business não foi projetado como Pro.
- **Idempotência E2E PASS:** reentrega manual do MESMO PAYMENT_CONFIRMED pelo
  painel Asaas às **11:06 BRT**, novamente **HTTP 200**. Após reentrega,
  paid_until/fim_em idênticos, um billing_payment, um evento persistido e uma
  assinatura em curso. Nenhuma segunda cobrança/assinatura foi criada.
- **Isolamento PASS:** conta Pro comparada antes/depois permaneceu PRO/active,
  franquia 200, um pagamento e uma assinatura em curso; mesmo paid_until/fim_em
  de 08/11/2026. Verificação SQL transacional com ROLLBACK, role authenticated
  sem bypass RLS e claims de cada conta: RPC de estado retorna somente plano
  próprio, assinatura alheia invisível, UPDATE de assinaturas/billing sem
  permissão; billing_payments/webhook_events sem SELECT e RPC de processamento
  sem EXECUTE para usuário comum. Nenhuma tabela foi manipulada para sucesso.
- Segurança observada/revisada: Oportuna exibe plano e validade, sem dados de
  cartão, token ou IDs financeiros do gateway; coleta de cartão ocorre somente
  no checkout Asaas. Endpoint de checkout deriva usuário da sessão e preço/
  franquia do catálogo server-side, respondendo apenas com redirecionamento.
- Resultado do fluxo positivo Business e reentrega: **PASS**, sem erro novo.
  Esta execução não cobre integralmente recusas, cancelamento, expiração e
  atraso financeiro no provedor; negativos financeiros anteriores que ainda
  não tenham evidência E2E permanecem pendentes para liberação em produção.
- Produção, migrations, regras de plano/preço/webhook e código não alterados
  nesta execução. Somente este relatório recebeu registro local; sem commit,
  push ou merge.
- Validações locais repetidas após o E2E: **119/119 testes PASS**, lint PASS,
  TypeScript PASS, build PASS. Build local avisou ausência de configuração de
  IA/e-mail, sem bloquear compilação; nenhuma variável foi inventada e nenhum
  envio/geração de IA foi acionado. Diff check final: PASS.
- Pronta para preparar commit/push e PR dos ajustes já homologados. Merge e
  produção não autorizados nesta etapa; permanecem condicionados à revisão,
  aos negativos financeiros pendentes e à aplicação/validação da migration
  no ambiente de produção em etapa explicitamente autorizada.

### Preparação para commit, push e PR — 13/10/2026

- E2E Pro e Business positivos, idempotência e isolamento mantêm os resultados
  registrados em 08/10/2026; nenhuma nova cobrança ou mudança de ambiente foi
  realizada nesta preparação. `npm test` repetido: **119/119 PASS**.
- Revisão dos arquivos versionados e novos sem secrets encontrados;
  `.env.local` permanece ignorado e não versionado. `.env.example` contém
  somente configuração de exemplo, sem credenciais reais.
- A migration `supabase/asaas_assinaturas_v1.sql` permanece aplicada somente
  em homologação, conforme os registros anteriores. Não foi executada em
  produção e nenhuma configuração de produção foi alterada nesta etapa.
- Pendências de E2E financeiro completo antes de liberação em produção:
  cartão recusado, pagamento vencido, estorno, chargeback, cancelamento real
  da recorrência e demais negativos ainda sem evidência E2E. Testes locais/SQL
  não substituem a validação desses eventos reais no Asaas Sandbox.
- Commit, push e PR autorizados pelo usuário; merge não autorizado.

### UX de planos e suporte explícito a ambientes — 13/10/2026

- Alterações locais posteriores ao commit `f0d7986`, ainda sem commit/push.
  Nenhum deployment, credencial real, configuração Vercel, banco Supabase ou
  migration remota foi alterado nesta etapa. Produção NÃO habilitada.
- `/planos`: resumo do plano efetivo, validade em Brasília e franquia da
  assinatura quando disponível; selo Recomendado no Pro, independente do
  destaque verde do plano atual. Preços/benefícios/ações organizados para
  comparação, cards responsivos, pagador somente no modal. Equipes e Assistente
  de Participação removidos da oferta visual; nenhum limite Business inventado.
- Estados apresentados: Plano atual, Pagamento pendente, Aguardando confirmação,
  Em processamento, Indisponível no momento e Alteração pelo suporte. Checkout
  vencido/sem data válida não oferece retomada; nenhuma nova reserva é criada
  por esse estado visual. Status internos não são exibidos no texto das páginas.
- successUrl mostra Aguardando confirmação do pagamento quando o plano efetivo
  continua Free. Nenhuma mutação de assinatura nessa página; confirmação de
  disponibilidade depende do backend, não da query string.
- Verificação visual dos componentes reais, hidratados em prévia localhost com
  fixtures fictícias, sem banco/API: desktop 1280 px, preços na mesma coordenada
  vertical; celular 390 px, cards empilhados e sem overflow horizontal; modais
  Pro/Business abrem/fecham, com foco inicial no nome. Modal móvel cabe na largura
  e tem rolagem vertical. Console sem erro/warning. Essa prévia NÃO é E2E de billing.
- `sandbox`: API api-sandbox.asaas.com/v3, checkout somente sandbox.asaas.com,
  caminhos /checkoutSession/ e /000/checkoutSession/, Supabase de homologação
  fixo. `production`: API api.asaas.com/v3 e checkout somente asaas.com no
  caminho documentado /checkoutSession/. HTTPS e hosts exatos, sem porta
  alternativa/credenciais em URL; requisições autenticadas não seguem redirects.
- Produção exige seleção explícita, `ASAAS_PRODUCTION_ENABLED=true`, chave com
  prefixo produtivo, preços/franquias completos, URL Supabase aprovada fixada em
  `ASAAS_PRODUCTION_SUPABASE_URL`, coincidência com NEXT_PUBLIC_SUPABASE_URL e
  ambiente produtivo do banco. Preview não pode usar production. Sem essas
  condições, falha fechada; sem fallback. Flag permanece desabilitada/ausente
  localmente e false no exemplo, sem URL ou chave produtiva real configurada.
- SQL aditivo/reaplicável: config de ambiente por banco, RLS/grants exclusivos,
  defaults/constraints/guardas para ambos os ambientes, seleção imutável após
  existir histórico. Banco dedicado a um só ambiente, sem mistura. Gateway
  service-only verifica ambiente e executa operação allowlisted na MESMA
  transação; mismatch é rejeitado antes de persistir evento. Contratos antigos
  dos helpers permanecem, sem alterar ativação/renovação ou fórmula de matching.
- Preservadas concessões ASAAS na reaplicação: apenas concessões pagas antigas
  de origem SYSTEM são classificadas MANUAL. Dados/IDs/auditoria não apagados.
  Preços/franquias continuam no catálogo/configuração, sem migration para mudar
  valores. Reutilização de checkout valida URL no ambiente selecionado; resposta
  da API com somente ID monta link no host oficial documentado.
- **134/134 testes PASS** (15 novos sobre a base 119), lint PASS, TypeScript PASS,
  build PASS e diff check PASS. Casos novos cobrem APIs/hosts por ambiente,
  ausência de habilitação/configuração produtiva, configurações cruzadas,
  URLs maliciosas, gateway atômico, handler com banco incompatível, estado visual,
  successUrl e preços/benefícios/modal. Build avisou IA/e-mail ausentes sem
  bloquear compilação; nenhum envio ou geração IA foi acionado.
- **SQL local PASS nos dois modos**, usando PGlite 0.5.9/PostgreSQL em memória,
  schema de teste mínimo e roles/RLS. Rodadas: upgrade da migration anterior
  Sandbox, reaplicação com snapshots idênticos, configuração production em
  OUTRO banco descartável vazio, fluxos Pro/Business, renovação, reentrega,
  estorno/chargeback sintéticos, RLS e rejeição de mistura/troca de ambiente.
  Suites terminaram em ROLLBACK, snapshots finais preservados. Não é teste em
  Supabase produtivo nem E2E com eventos do provedor. Dependências de teste
  instaladas somente em pasta temporária, sem mudar package.json/lock.
- Limite da validação: novo SQL ainda NÃO reaplicado no Supabase de homologação;
  novo código ainda NÃO publicado no Preview. Compatibilidade Sandbox foi
  validada no upgrade local, e o Preview anterior não foi alterado. Depois da
  revisão, atualizar SQL em homologação antes do novo Preview e repetir E2E.
- Checklist em `docs/BILLING_PRODUCAO.md`: configuração, migration, webhook,
  token, teste real autorizado, logs e rollback compatível. A trava global não
  substitui bloqueio específico de novas contratações quando já houver eventos
  de recorrências para receber.
- Pendências: limite comercial de perfis Business e aprovação comercial final
  dos valores produtivos; E2Es reais do provedor para recusa, vencimento,
  estorno, chargeback e cancelamento; revisão operacional de recuperação/retry.
  Suporte técnico de ambientes preparado; liberação produtiva ainda bloqueada.

### Homologação remota da arquitetura de ambientes — 13/10/2026

- Execução real no Supabase `uzmgxxhiedevsxedgqij`, projeto
  `oportuna-homologacao`, a partir de 22h de Brasília (14/10 UTC).
  Antes da execução: todas as linhas de billing tinham ambiente sandbox,
  RLS ativa e nenhuma concessão paga de origem SYSTEM.
- Aplicada a versão atual de `supabase/asaas_assinaturas_v1.sql` em transação,
  com bloqueio das tabelas e comparação de contagem/hash integral antes e
  depois. COMMIT somente após as assertivas de preservação e RLS passarem.
  Preservados integralmente: 2 clientes, 3 assinaturas de billing, 4 pagamentos,
  12 eventos, 2 concessões e 3 limites de perfis. Configuração nova: sandbox.
  Nenhum registro anterior duplicado, apagado ou atualizado.
- E2Es anteriores preservados: PRO ativo com franquia 200 e BUSINESS ativo
  com franquia 1000; ambos mantêm paid_until/fim_em
  `2026-11-08T03:00:00Z`. Nenhuma nova cobrança ou pagamento nesta etapa.
- Suítes remotas `tests/sql/asaas-billing.sql` e
  `tests/sql/asaas-ambientes.sql`: PASS, com ROLLBACK das fixtures.
  Gateway financeiro autorizado para service_role e bloqueado para
  authenticated; ambiente cruzado rejeitado antes de persistir evento.
  Hashes do histórico real idênticos após as suítes.
- Teste SQL remoto adicional em transação/ROLLBACK: 6 URLs inválidas
  rejeitadas pela guarda de billing (host Production em Sandbox, host falso,
  subdomínio falso, HTTP, porta 8443 e caminho alheio). PASS.
- Arquivos locais aprovados enviados diretamente à Vercel como Preview,
  sem commit/push e sem arquivos .env. Deployment
  `dpl_DXhHnphb8ukXsr6jDpUF6kDmWyaA`: READY, target null (Preview).
  Alias da branch atualizado:
  https://oportuna-git-feat-asaas-assinatura-pro-pkborges-1822s-projects.vercel.app
  . Vercel Authentication continua habilitada; nenhuma proteção desativada.
- Conferidas somente variáveis não secretas da branch Preview:
  NEXT_PUBLIC_SUPABASE_URL aponta para homologação; ASAAS_ENVIRONMENT=sandbox;
  APP_BASE_URL é o alias Preview; preços 99/197 e franquias 200/1000.
  Nenhuma chave/token recuperado das variáveis Vercel. Produção não selecionada
  nem configurada/habilitada nesta etapa.
- Smoke parcial real: /planos HTTP 200; nova UX publicada, Business atual
  com franquia 1.000 e validade preservada, Pro recomendado por R$ 99,
  Business por R$ 197. Nenhum status interno exibido.
  Logs do novo deployment vistos no painel Vercel: zero warnings/errors/fatal
  na janela consultada e nenhum dado de pagador/secret nas linhas retornadas.
- `npm test` repetido nesta etapa: 134/134 PASS. Testes automatizados cobrem
  token inválido, successUrl sem ativação, hosts/configurações cruzadas e
  impedimento de consultar endpoint financeiro fora do ambiente.
  Isso não substitui o teste HTTP remoto do webhook.
- PENDENTE para concluir o smoke remoto: login manual no Asaas Sandbox
  (sessão expirou) para reentrega do MESMO evento já pago; conta FREE no
  Preview para abrir modal/checkout sem alterar concessões Pro/Business.
  Token inválido via HTTP remoto ainda não verificado nesta etapa.
  O conector de fetch protegido e o de logs retornaram 403 de autorização;
  logs foram consultados pelo painel, sem ampliar acessos.
- Nenhuma regressão observada nos passos concluídos. Ainda não declarar
  smoke completo nem iniciar E2Es financeiros negativos enquanto as
  verificações HTTP pendentes não forem concluídas. Nenhuma produção,
  merge, commit ou push executado.
- Arquivos desta etapa: `.env.example`, `README.md`,
  `app/(painel)/planos/page.tsx`, `app/(painel)/planos/retorno/page.tsx`,
  `app/api/webhooks/asaas/route.ts`, `components/planos/assinatura-dialog.tsx`,
  `components/planos/planos-view.tsx`, `lib/billing/asaas.ts`,
  `lib/billing/ambiente.ts`, `lib/billing/banco.ts`, `lib/billing/checkout.ts`,
  `lib/billing/preco.ts`, `lib/billing/validacao.ts`, `lib/planos/catalogo.ts`,
  `lib/planos/apresentacao.ts`, `supabase/asaas_assinaturas_v1.sql`,
  `scripts/validar-billing-sql-local.mjs`, `tests/billing-ambientes.test.mjs`,
  `tests/billing-pagador.test.mjs`, `tests/billing-webhook.test.mjs`,
  `tests/billing.test.mjs`, `tests/planos-ux.test.mjs`, `tests/sql/asaas-billing.sql`,
  `tests/sql/asaas-ambientes.sql`, `tests/sql/HOMOLOGACAO.md`,
  `docs/BILLING_PRODUCAO.md`. PNCP, cron, IA e serviço de alertas não alterados.

### Complemento do smoke HTTP remoto — 13/10/2026, 22h47–22h54 Brasília

- Sessão Asaas Sandbox retomada pelo usuário. Reentregue o MESMO
  PAYMENT_CONFIRMED do E2E Pro, sem novo checkout, cobrança ou pagamento.
  Entrega às 22h47: HTTP 200, comprovado no Asaas e nos logs do deployment
  Preview `dpl_DXhHnphb8ukXsr6jDpUF6kDmWyaA`.
- Idempotência remota PASS: hashes integrais de clientes, assinaturas,
  pagamentos, eventos e concessões idênticos antes/depois. Permanecem
  2 clientes, 3 assinaturas de billing, 4 pagamentos, 12 eventos e 2 concessões.
  Evento original continua processed, sem erro; processado_em não alterado.
  PRO/200 e BUSINESS/1000 ativos, paid_until/fim_em preservados em
  2026-11-08T03:00:00Z. Não houve extensão em duplicidade ou interferência
  na outra conta.
- Testes HTTP reais de token inválido e ausente: HTTP 401, corpo vazio.
  Chamadas medidas às 22h51:57/58: 1.057 ms e 476 ms, respectivamente,
  sem timeout. Nenhum evento de teste persistido no banco. Os logs do
  Preview mostram os POSTs 200/401 e zero warnings/errors/fatal na janela
  consultada, sem payload financeiro ou secrets nas mensagens da aplicação.
- Foi usado somente o bypass Vercel já cadastrado. Transporte temporário
  restrito ao usuário conforme autorização anterior; arquivo/pasta apagados
  após o teste, com ausência confirmada. Nenhuma proteção desabilitada,
  nenhum bypass novo criado, nenhum secret recuperado da Vercel.
- As pendências de login Asaas, reentrega e token inválido da seção anterior
  estão concluídas. Falta somente o smoke de modal/checkout/retorno em conta
  FREE; a sessão da aplicação ainda era Business nesta conferência. O usuário
  informou que entrará numa conta FREE. Não rebaixar nem alterar as duas
  concessões existentes para esse teste.
- Sem regressão nos passos executados. Produção permanece intacta;
  nenhum commit, push ou merge nesta etapa. Ainda não marcar smoke completo
  antes de concluir a pendência Free.

### Recuperação do acesso Free na homologação — 14/10/2026

- O cadastro não informa emailRedirectTo e o Supabase de homologação usava
  Site URL http://localhost:3000, sem Redirect URLs adicionais. Isso explica
  o destino local dos links anteriores; otp_expired significa link inválido
  ou expirado e não comprova, sozinho, que a confirmação foi concluída.
- Mediante autorização explícita do usuário, alterado SOMENTE o Site URL
  do projeto uzmgxxhiedevsxedgqij para
  https://oportuna-git-feat-asaas-assinatura-pro-pkborges-1822s-projects.vercel.app
  . Salvamento confirmado no painel Supabase e valor persistido conferido
  em 14/10. Nenhum redirect adicional, template, senha ou configuração
  de confirmação de e-mail alterado; Vercel Authentication preservada.
- Não apagar contas nem conceder confirmação/plano por SQL. A recuperação
  da conta Free e seu smoke permanecem pendentes de identificação local
  da conta e de confirmação válida. Tela de login Preview aberta ao usuário;
  nenhum e-mail, senha ou token solicitado no chat.
- Nenhuma configuração de produção, migration adicional, cobrança,
  commit, push ou merge executado nesta recuperação.

### Smoke Free remoto após arquitetura de ambientes — 14/10/2026

- Usuário autenticou uma conta Free no Preview; plano efetivo Free confirmado
  na aplicação. Nenhuma alteração nas contas Pro/Business para preparar o teste.
- /planos carrega: Free R$ 0, Pro R$ 99 com 200 análises e Business R$ 197
  com 1.000 análises. Modais Pro/Business abrem/fecham, nome/e-mail pré-preenchidos
  conferidos somente por indicadores de presença, sem extrair valores pessoais.
  Formulário de pagador exclusivamente no modal.
- Testada successUrl isolada ANTES e DEPOIS do checkout: conta permanece Free;
  mensagem Aguardando confirmação do pagamento. Nenhuma concessão criada.
- Criado somente UM checkout Pro Sandbox, com identidade de pagador fictícia
  e celular de teste previamente autorizado. POST /api/billing/checkout: 303;
  redirecionamento HTTPS sandbox.asaas.com/000/checkoutSession/show/... aceito.
  Checkout hospedado mostra Pro R$ 99,00 e recorrência mensal. CEP + número
  foram suficientes; Asaas preencheu cidade/endereço/bairro. Sem dados de cartão
  preenchidos, nenhum pagamento concluído e nenhuma cobrança paga nova.
- CHECKOUT_CREATED recebido: POST /api/webhooks/asaas HTTP 200; evento processed
  sem erro no banco. Uma reserva aberta para a conta, plano PRO, valor 9900,
  franquia 200, paid_until NULL e zero pagamentos. Conta efetiva permanece FREE.
  /planos mostra Pagamento pendente/Continuar pagamento e impede outra
  contratação concorrente; nenhum status interno exibido.
- Resultado esperado do smoke: clientes 2 -> 3, assinaturas de billing 3 -> 4,
  eventos 12 -> 13; pagamentos continuam 4 e concessões continuam 2.
  Hashes integrais das duas assinaturas pagas e de todas as concessões idênticos
  ao baseline. Pro/200 e Business/1000 continuam ativos até 2026-11-08T03:00:00Z.
  Reserva do smoke deixada pendente, com expiração prevista para
  2026-10-14T12:44:31.989Z; nenhum cancelamento ou limpeza manual.
- BILLING SMOKE: PASS. Separação de ambientes, token inválido/ausente e
  idempotência mantêm as evidências remotas das seções anteriores.
- PENDÊNCIA FUNCIONAL BLOQUEANTE encontrada ao revisar logs: dashboard da
  conta Free falha de forma reproduzível com Não foi possível carregar o
  resumo, digest 1909289627. PostgreSQL registra SQLSTATE 57014:
  canceling statement due to statement timeout. Raw JSON do log confirma
  consulta PostgREST da RPC resumo_oportunidades_ativas_v1.
  GET pode aparecer com HTTP 200 nos logs Next.js, mas a tela mostra erro.
- Diagnóstico somente leitura com JWT/role authenticated da MESMA conta,
  dentro de transação encerrada em ROLLBACK: RPC retorna total 40000 e
  totalBase 40555. Este resultado Free é filtrado pelo plano; não indica perda
  de massa. SQL Editor não reproduz necessariamente o timeout da Data API.
  Não foi estabelecido que a falha foi introduzida pelo billing; falta
  investigar desempenho do resumo no fluxo HTTP autenticado Free.
- Conforme critério do usuário, NÃO declarar homologação sem regressões
  nem pronta para iniciar a próxima etapa antes de resolver/validar essa
  divergência. Parado sem alterar código, timeouts, RLS ou permissões.
  Sem migration adicional, produção, commit, push ou merge.

### Otimização pontual do resumo do dashboard — 15/10/2026, homologação

- Aplicado somente no projeto `uzmgxxhiedevsxedgqij` o arquivo
  `supabase/resumo_oportunidades_ativas_otimizacao_v1.sql` (`Success. No rows
  returned`). O nome, assinatura, JSON, regras de ciclo de vida e ordenação da
  RPC foram preservados. A seleção visível passou a ser materializada uma vez;
  contagem e próxima oportunidade reutilizam essa seleção, e somente o item
  escolhido é buscado por chave primária para formar o card completo.
- Paridade em transações `READ ONLY` com papel `authenticated` e RLS real:

  | Plano | JSON antigo = novo | Total antigo/novo | totalBase antigo/novo |
  | --- | --- | ---: | ---: |
  | Free | Sim | 40.000 / 40.000 | 40.555 / 40.555 |
  | Pro | Sim | 40.000 / 40.000 | 50.000 / 50.000 |
  | Business | Sim | 40.000 / 40.000 | 50.000 / 50.000 |

  A igualdade foi feita sobre o JSON inteiro, incluindo `proxima` e todos os
  campos do card; os hashes integrais também coincidiram. As transações
  terminaram em `ROLLBACK`. `security invoker`, `search_path=pg_catalog`, RLS
  ativa, execução por `authenticated` e ausência de execução por `anon`
  foram conferidos após a aplicação.
- `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` do SQL interno sob a mesma conta
  Free: expressão anterior **3.236,987 ms**, com dois `Seq Scan` independentes
  em `oportunidades_editais` (40.000 e 40.555 linhas visíveis), cerca de
  25.108 blocos compartilhados e sort `top-N heapsort` de 31 KB. Expressão
  nova **2.014,188 ms**, com um `Seq Scan` de 40.555 linhas, reutilização da
  CTE, busca por índice primário de um item e sort `top-N heapsort` de 25 KB.
  A CTE usou 194 blocos temporários lidos/escritos (aproximadamente 1,5 MB),
  sem crescimento relevante do sort. A amostra do SQL Editor não substitui
  a medição HTTP para avaliar a cauda de latência.
- Uma execução adicional do plano novo sob conta Pro percorreu 50.000 linhas
  visíveis e levou **8.057,958 ms** no SQL Editor, com um único `Seq Scan` e
  242 blocos temporários. Não foi um timeout nem uma chamada HTTP, mas mostra
  variabilidade importante; a correção não será considerada suficiente sem as
  10 amostras HTTP por plano e a verificação de 500/57014.
- `npm test`: 134/134 PASS; lint, `npx tsc --noEmit` e sintaxe do medidor
  PowerShell: PASS. `npm run build` não concluiu porque o ambiente local não
  conseguiu acessar `fonts.googleapis.com` para obter Geist/Geist Mono; não é
  erro de SQL. Nenhum arquivo de billing, plano, política RLS ou timeout foi
  alterado nesta correção.
- Medição HTTP direta da RPC (`POST /rest/v1/rpc/resumo_oportunidades_ativas_v1`,
  payload `{}`), 10 chamadas por plano, em 15/10/2026. O arquivo sanitizado
  iniciado às 09:34:08 BRT contém Pro e Business; os 10 valores Free foram
  registrados na saída do PowerShell exibida separadamente pelo usuário e
  **não constam desse arquivo**. p95 calculado por interpolação linear.

  | Plano | Mínimo | Média | p95 | Máximo | HTTP 500 | SQLSTATE 57014 |
  | --- | ---: | ---: | ---: | ---: | ---: | ---: |
  | Free | 2.304 ms | 3.286,1 ms | 5.868,5 ms | 7.871 ms | 0/10 | 0/10 |
  | Pro | 2.259 ms | 3.197,1 ms | 6.427,45 ms | 8.452 ms | **1/10** | **1/10** |
  | Business | 2.246 ms | 2.436,5 ms | 2.823,65 ms | 2.915 ms | 0/10 | 0/10 |

  A primeira chamada Pro retornou HTTP 500 e SQLSTATE `57014` em 8.452 ms;
  as outras nove retornaram HTTP 200 e `total=40000`. As 10 chamadas Free e
  Business retornaram HTTP 200 e `total=40000`. O campo `timeout=false` do
  medidor indica ausência de timeout **de transporte HTTP**; o SQLSTATE
  `57014` confirma cancelamento por timeout **do banco**. Nenhuma medição foi
  descartada. O máximo Free de 7.871 ms também ficou perto do limite de 8 s.
- **Critério de parada atingido.** A otimização reduziu o custo do plano
  interno e as chamadas usuais, mas ainda não elimina timeout/HTTP 500. Não
  liberar E2Es financeiros negativos nem afirmar estabilidade do dashboard.
  A conferência visual manual Free/Business segue pendente; a página Pro abriu
  normalmente em uma observação, insuficiente para provar estabilidade.
  Produção não alterada; sem commit/push/merge.

### Refatoração controlada da policy de visibilidade — 19/10/2026, homologação

- Aplicado **somente** no projeto `uzmgxxhiedevsxedgqij` o SQL
  `supabase/oportunidades_rls_visibilidade_v1.sql`. A alteração atômica usa
  `ALTER POLICY`; não modifica as funções, o billing, índices, timeout ou RLS
  de outras tabelas. O catálogo confirmou que a policy continua limitada a
  `authenticated` e passou a resolver `auth.uid()`, plano pago e corte de
  30 dias em subconsultas sem dependência da linha.
- A mesma conta de cada plano foi usada antes e depois, sob
  `SET LOCAL ROLE authenticated` e JWT simulado em transações encerradas com
  `ROLLBACK`. Hash do JSON completo e hash do objeto `proxima` permaneceram
  idênticos; `total=40000` nos três planos. `totalBase`: Free `40370` antes e
  depois; Pro/Business `50000` antes e depois. O valor Free de `40555` do
  diagnóstico anterior não é referência fixa: o limite de 30 dias avançou.
- `EXPLAIN (ANALYZE, BUFFERS)` de `count(*)` com RLS real apresentou três
  InitPlans, cada um com um loop, e um Seq Scan de oportunidades. Amostras
  únicas: Free `347,354 ms` (`40370` linhas, `12520` blocos hit), Pro
  `297,973 ms` (`50000`, `12530` hit), Business `5097,462 ms` (`50000`,
  `12530` hit). O pico Business confirma que o plano correto, sozinho, não
  estabelece estabilidade de latência. Não houve evidência de sort nessa
  contagem.
- `pg_stat_xact_user_functions` com `track_functions=all`: na contagem,
  `plano_atual_v1=1`, `plano_pago_v1=1`, `plano_historico_visivel_v1=0`
  para Free, Pro e Business. Na execução da RPC real pelo SQL Editor,
  respectivamente `2`, `2` e `0` chamadas por plano; a RPC foi chamada uma
  vez. A quantidade é constante, não proporcional às 50 mil linhas.
- RLS cruzada com duas contas reais simuladas por JWT e role `authenticated`:
  Free viu 1 perfil próprio e 0 perfis da conta Pro; Pro viu 2 próprios e 0
  da conta Free. `row_security_active` retornou `true` para oportunidades e
  perfis nos dois contextos. Nenhum plano veio do cliente.
- Dashboard Preview na sessão Pro: três atualizações exibiram `40000`
  oportunidades ativas e base `50000`, sem erro visível. Free e Business
  ainda exigem sessão própria para a conferência manual.
- Medição HTTP real pós-policy em 19/10/2026, iniciada às 17:14:29 BRT e
  concluída às 17:16:22 BRT: 10 chamadas autenticadas por plano para
  `POST /rest/v1/rpc/resumo_oportunidades_ativas_v1`, payload `{}`.
  Nenhuma medição foi descartada. p95 usa interpolação linear entre as
  posições 9 e 10 das dez amostras ordenadas.

  | Plano | Tempos individuais (ms) | Mínimo | Média | p95 | Máximo | HTTP 500 | 57014 |
  | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
  | Free | 8782, 7658, 514, 398, 425, 420, 514, 624, 418, 415 | 398 | 2016,8 | 8276,2 | 8782 | **1/10** | **1/10** |
  | Pro | 615, 414, 357, 769, 407, 372, 343, 329, 408, 311 | 311 | 432,5 | 699,7 | 769 | 0/10 | 0/10 |
  | Business | 637, 337, 323, 309, 408, 408, 406, 525, 415, 414 | 309 | 418,2 | 586,6 | 637 | 0/10 | 0/10 |

  As nove respostas Free bem-sucedidas e todas as Pro/Business retornaram
  `total=40000`. A primeira Free retornou HTTP 500/SQLSTATE 57014 em 8782 ms;
  a segunda, HTTP 200 em 7658 ms. Nenhum timeout de transporte HTTP. As
  oito últimas Free ficaram entre 398 e 624 ms, mas não há prova de que o
  custo inicial não se repetirá após inatividade ou reinício. **Critério
  obrigatório não passou**: manter E2Es financeiros negativos pausados e
  investigar a cauda Free antes de declarar o dashboard estável.
- Verificações locais repetidas no mesmo dia: `npm test` 134/134 PASS, lint
  PASS, TypeScript PASS, `git diff --check` PASS e build PASS. Os primeiros
  resultados de teste/build foram limitados pelo sandbox (subprocesso Node
  `EPERM` e acesso às fontes Geist); a repetição com essas permissões passou,
  sem alteração de código.
- Nenhuma alteração em produção e nenhum commit/push/merge nesta etapa.

### Diagnóstico de ordem e inatividade da RPC de resumo — 19/10/2026, homologação

- Medição HTTP direta e autenticada de `POST /rest/v1/rpc/resumo_oportunidades_ativas_v1`
  com payload `{}` no projeto `uzmgxxhiedevsxedgqij`. As três contas tiveram o
  plano efetivo conferido antes da série. Foram feitas 36 chamadas entre
  17:22:42 e 17:38:37 BRT, sem descartar nenhuma; o arquivo local contém
  apenas resultados sanitizados. Pausa de 0,5 s entre chamadas consecutivas.

  | Ordem global | Série e ordem dos planos | Business (ms) | Pro (ms) | Free (ms) |
  | --- | --- | --- | --- | --- |
  | 1–9 | A: Business → Pro → Free | 7440, 622, 349 | 303, 362, 324 | 387, 407, 377 |
  | 10–18 | B: Pro → Free → Business | 380, 310, 326 | 382, 356, 312 | 404, 329, 297 |
  | 19–27 | C: Free → Business → Pro | 328, 318, 362 | 293, 301, 300 | 392, 399, 306 |

  A primeira chamada global foi Business às 17:22:42 BRT e levou 7440 ms;
  a duração da inatividade anterior a essa chamada não foi controlada. Nas
  outras 26 chamadas consecutivas, o máximo foi 622 ms.

- Depois de cada pausa de cinco minutos **sem chamadas da RPC pelo script**,
  o plano indicado foi chamado três vezes. O intervalo real entre o término
  da chamada anterior e o início da primeira seguinte foi 300,5 s nos três
  casos. Não se pode excluir chamadas de outros clientes ao projeto durante
  essas pausas.

  | Ordem global | Primeiro plano após pausa | Horário da primeira (BRT) | Chamada 1 (ms) | Chamada 2 (ms) | Chamada 3 (ms) |
  | --- | --- | --- | ---: | ---: | ---: |
  | 28–30 | Business | 17:28:12 | 6888 | 773 | 619 |
  | 31–33 | Pro | 17:33:22 | 1764 | 919 | 409 |
  | 34–36 | Free | 17:38:27 | 7665 | 729 | 539 |

- **Todas as 36 chamadas retornaram HTTP 200**, `total=40000`, sem SQLSTATE,
  timeout de transporte ou erro funcional. `totalBase` foi 40370 em Free e
  50000 em Pro/Business. Os picos de 7440 e 6888 ms ocorreram com Business,
  e o de 7665 ms com Free, sempre na primeira chamada global ou após pausa;
  as chamadas seguintes caíram rapidamente. Assim, esta rodada **não sustenta
  uma cauda exclusiva do Free** e é compatível com efeito de primeira execução
  após inatividade. A intensidade varia: Pro, primeiro após pausa, levou
  1764 ms. O mecanismo exato (cache, planejamento, infraestrutura ou outro)
  **não foi demonstrado**.
- Nenhum plano `EXPLAIN` foi capturado para estas chamadas HTTP individuais;
  o PostgREST expõe apenas o `Function Scan` externo. Não há dados comparáveis
  de planning time, execution time interno, JIT, buffers ou contagem de funções
  para a chamada lenta versus a rápida. `EXPLAIN` anterior confirmou InitPlans
  constantes e também mostrou variabilidade em SQL, mas não identifica a causa
  dos picos desta série. Não houve limpeza de cache nem ajuste de infraestrutura.
- O SQLSTATE `57014` da medição anterior (Free, 8782 ms) permanece evidência de
  timeout real, apesar de **0/36 ocorrências nesta rodada**. Picos de 7,4–7,7 s
  ainda deixam pouca folga para o limite de 8 s; não declarar estabilidade
  definitiva nem liberar os E2Es financeiros negativos com base apenas nesta
  série. SQL, billing, timeout e produção permaneceram inalterados; sem
  commit/push/merge.

### Comparação HTTP discriminatória após inatividade — 19/10/2026, homologação

- Uma única conta autenticada foi usada nas quatro chamadas, com a mesma
  chave publicável e payload `{}`. O resultado sanitizado não guarda conta,
  token, senha nem plano nominal; `totalBase=50000` indica o contexto pago da
  conta nesta amostra. A operação simples foi a RPC existente
  `plano_atual_v1`, no mesmo PostgREST; não foi criado endpoint ou mecanismo
  de keep-alive. O script aguardou cinco minutos antes de A e mais cinco
  minutos antes de B, sem chamar a RPC de resumo nesse intervalo.

  | Ordem | Cenário | Horário BRT | Operação | Tempo HTTP | Status | SQLSTATE |
  | ---: | --- | --- | --- | ---: | ---: | --- |
  | 1 | A | 22:14:26 | `plano_atual_v1` | 1037 ms | 200 | ausente |
  | 2 | A | 22:14:27 | `resumo_oportunidades_ativas_v1` | 6314 ms | 200 | ausente |
  | 3 | B | 22:19:33 | `resumo_oportunidades_ativas_v1` | 6635 ms | 200 | ausente |
  | 4 | B | 22:19:40 | `resumo_oportunidades_ativas_v1` | 1003 ms | 200 | ausente |

- Em A, a RPC simples retornou resultado válido em 1037 ms, mas **não aqueceu
  o caminho pesado o suficiente** para evitar 6314 ms no resumo iniciado
  imediatamente depois. Em B, após 300 s de inatividade medida entre as
  chamadas, o resumo direto levou 6635 ms e a repetição imediata caiu para
  1003 ms. Todas as três respostas do resumo preservaram `total=40000` e
  `totalBase=50000`; nenhuma medição foi descartada. Não houve HTTP 500,
  SQLSTATE 57014, timeout de transporte ou erro funcional nesta pequena série.
- **Interpretação limitada:** a operação simples também teve algum custo
  inicial, mas a cauda de 6,3–6,6 s persistiu especificamente na primeira
  execução do resumo após a pausa. Isso enfraquece a hipótese de que apenas
  a conexão/compute geral explica o pico e favorece trabalho frio no caminho
  da consulta; não demonstra se a causa interna é cache de páginas, plano,
  JIT, compute ou outra etapa. Não foram capturados planning time, execution
  time interno, buffers ou JIT dessas chamadas HTTP. O 57014 anterior segue
  registrado e o limite de 8 s ainda pode ser alcançado em outra execução.
- O diagnóstico de dashboard permanece aberto; esta frente **não bloqueia**
  os E2Es financeiros negativos do Asaas Sandbox. SQL/RLS, billing, timeout e
  produção não foram alterados; sem commit/push/merge.

### Asaas Sandbox — tentativa de cartão recusado (parcial), 19/10/2026

- Em checkout hospedado do Asaas Sandbox para Pro, a captura enviada pelo
  usuário mostrou a mensagem **"Pagamento não autorizado"**. O cartão de
  recusa usado não foi confirmado por evidência sanitizada do provedor; não
  registrar número, CVV ou dados do pagador neste relatório.
- O retorno do Preview em `/planos/retorno?estado=cancelado` exibiu **"checkout
  cancelado"** e **plano atual Free**. Isso comprova que o retorno cancelado
  não concedeu Pro naquela sessão.
- O usuário apresentou o log de checkout de 19/10/2026 às 22:29 com entrega
  HTTP 200 e o conteúdo correspondente: evento `CHECKOUT_CREATED`, checkout
  `ACTIVE`, plano Pro mensal de R$ 99, cobrança recorrente mensal e cliente
  existente via `customer`, com `customerData=null`. O horário é o exibido
  pelo painel/provedor; o payload não informa fuso. IDs, link individual do
  checkout e dados da conta não foram copiados para este relatório.
- Na consulta manual informada pelo usuário, a categoria Cobranças com
  período Hoje não apresentou logs. Na categoria checkout apareceu o evento
  de criação acima; isso não comprova entrega de evento de recusa ou de
  cancelamento, nem confirmação financeira. `ACTIVE` descreve a sessão de
  checkout e não comprova concessão de plano.
- **E2E ainda não concluído:** falta verificar evidência de evento financeiro
  da recusa, se emitido, e no banco de homologação o estado da reserva,
  pagamentos, eventos, ausência de duplicidade e preservação de histórico.
  Não inferir `PAYMENT_CREDIT_CARD_CAPTURE_REFUSED` apenas da mensagem visual;
  o provedor pode não ter emitido esse evento para este checkout. Nenhuma
  segunda tentativa, limpeza ou alteração de produção foi realizada pelo
  agente; sem commit/push/merge.

### Preparação para versionamento e canário produtivo — 19/10/2026

- Branch conferida: `feat/asaas-assinatura-pro`; HEAD e branch remota antes
  desta preparação em `f0d798678635cb05419c334708de580e73eb314b`, confirmado
  com fetch. As alterações posteriores de UX `/planos`, retorno informativo,
  ambientes Sandbox/Production, migration reaplicável, documentação, testes
  e otimizações locais de resumo/RLS estavam presentes. Nenhum arquivo foi
  descartado; nenhum código adicional de billing/RLS foi implementado nesta etapa.
- Validações locais repetidas: **134/134 testes PASS**, lint PASS, TypeScript
  (`npx tsc --noEmit`) PASS, build PASS. O build usou a configuração local já
  disponível; avisou ausência de OpenAI/e-mail, sem impedir compilação e sem
  chamadas de IA. Geradores Unicode e paridade com `--check`: PASS, sem
  reescrever as migrations geradas.
- PostgreSQL embarcado PGlite local: suites de billing e ambientes PASS para
  sandbox e production simulados, incluindo upgrade/reaplicação, preservação de
  dados, RLS e idempotência. Isso não é execução no Supabase produtivo nem E2E
  financeiro real. Nenhuma migration foi aplicada remotamente nesta etapa.
- Revisão dos 31 arquivos candidatos, incluindo os ainda não rastreados:
  nenhum valor de credencial local detectado; sem tokens JWT literais, chaves
  privadas, secrets Supabase/GitHub ou e-mails pessoais detectados. `.env.local`
  permanece ignorado; somente `.env.example`, com placeholders, integra o diff.
  Resultados temporários e credenciais dos prompts não foram incluídos.
- PNCP, cron, alertas, IA e migrations antigas fora do billing não receberam
  alterações neste diff. Os únicos SQLs de schema envolvidos são a revisão de
  `asaas_assinaturas_v1.sql` e os novos roteiros de otimização de resumo/RLS,
  cuja aplicação produtiva continua sendo uma decisão separada.
- Checklist e canário planejado em `docs/BILLING_PRODUCAO.md`: conta controlada,
  exclusivamente Pro, uma cobrança real de R$ 99 e franquia 200, somente após
  autorizações futuras. **Falta restrição server-side de checkout por conta e
  plano canário**: a habilitação atual é global e não deve ser ligada numa
  aplicação pública até existir essa contenção validada. Nenhum teste real,
  secret ou configuração produtiva foi executado/adicionado nesta preparação.
- Billing: E2Es positivos Pro/Business previamente aprovados; recusa negativa
  ainda parcial, demais negativos financeiros ainda pendentes. Dashboard/cold
  latency: investigação aberta, com 57014 anterior preservado e cauda após
  inatividade documentada. Versionamento não equivale a aprovação de produção.

### Trava de canário Pro — validação local, 20/10/2026

- Sobre a branch `feat/asaas-assinatura-pro`, commit-base `97102b8`, foi adicionada
  a verificação server-only `checkoutPermitido`. Em produção, exige exatamente
  `BILLING_CANARY_ENABLED=true`, um UUID válido em `BILLING_CANARY_USER_ID`, a
  identidade autenticada correspondente e plano Pro. Flag ausente/desligada,
  UUID inválido, Business ou outra conta bloqueiam novos checkouts produtivos.
  Desligar o canário não abre contratação ao público; Sandbox mantém Pro/Business.
- Endpoint POST e serviço de criação/reuso verificam a regra antes de alterar
  cliente, reservar ou chamar o Asaas. POST bloqueado retorna HTTP 403 com
  "Assinaturas em liberação gradual."; query, formulário e metadata não
  substituem identidade, ambiente ou configuração do servidor.
- `/planos` calcula elegibilidade no servidor e passa somente booleanos à
  apresentação. Contas Free não elegíveis veem "Disponível em breve" e
  "Assinaturas em liberação gradual.", sem formulário de assinatura. Canário
  oferece somente modal Pro. Plano vigente, entitlements e webhook não foram
  condicionados à trava. O ID configurado não é passado às props de apresentação.
- Testes executam o handler POST e o serviço reais com Request/Response e
  dependências de banco/Asaas substituídas, sem chamadas remotas: matriz das duas
  contas/planos, ausência de configuração, tentativa de override, autenticação,
  bloqueio antes de efeitos externos, preços/franquias, reuso e processamento do
  webhook independente do canário. Testes de renderização cobrem os novos estados.
- **149/149 testes PASS**, `npm run lint` PASS, `npx tsc --noEmit` PASS,
  `git diff --check` PASS e `npm run build` PASS. Assets client compilados sem
  referências a `BILLING_CANARY_USER_ID`/`BILLING_CANARY_ENABLED`; módulo marcado
  `server-only`. Revisão React: autorização nos pontos de mutação, verificações
  baratas antes do banco e somente booleanos na apresentação.
- `.env.example` contém somente flag desabilitada e UUID vazio. `.env.local`
  não foi alterado; nenhum UUID real ou credencial foi configurado. Não houve
  migration, alteração em SQL/RLS, produção, cobrança, commit, push ou merge.
  E2Es financeiros negativos e investigação de latência fria continuam pendentes.
- Arquivos desta etapa (13):
  - Servidor: `lib/billing/canario.ts`, `lib/billing/checkout.ts`,
    `app/api/billing/checkout/route.ts`.
  - Apresentação: `app/(painel)/planos/page.tsx`,
    `components/planos/planos-view.tsx`, `lib/planos/apresentacao.ts`.
  - Testes: `tests/billing-canario.test.mjs`, `tests/billing-webhook.test.mjs`,
    `tests/planos-ux.test.mjs`.
  - Configuração/documentação: `.env.example`, `README.md`,
    `docs/BILLING_PRODUCAO.md`, `tests/sql/HOMOLOGACAO.md`.

### Revisão pré-commit da liberação gradual — 20/10/2026

- Branch `feat/asaas-assinatura-pro`, base `97102b8`, PR #9 aberto. Validações
  repetidas antes do versionamento: 149/149 testes PASS, lint PASS, TypeScript
  PASS, diff check PASS e build PASS. Nenhuma regra adicional de billing,
  webhook, preço ou ativação foi modificada nesta revisão.
- Os 13 arquivos revisados não contêm secrets locais ou UUID real configurado
  para o canário. Os dois IDs nos novos testes são fixtures sintéticas. Duas
  referências antigas a UUIDs de fixtures neste relatório foram anonimizadas,
  preservando a descrição e os resultados dos cenários. `.env.local` continua
  ignorado e inalterado; `.env.example` mantém flag false e UUID vazio.
- Nenhuma configuração Production, migration ou cobrança real foi executada.
  Pendências antes do teste controlado: aprovar/configurar a conta produtiva e
  o ambiente dedicado, aplicar/validar a migration mediante autorização futura,
  configurar credenciais e webhook de produção, validar o bloqueio das demais
  contas e de Business no ambiente publicado, e autorizar a cobrança Pro de
  R$ 99 com recorrência e encerramento definidos. Checklist completo em
  `docs/BILLING_PRODUCAO.md`.
- Recusa financeira ainda parcial, demais negativos financeiros sem E2E completo
  e investigação de latência fria continuam registrados; aprovação do commit
  não representa autorização para merge ou habilitação produtiva.
