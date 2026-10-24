# IA + Billing Asaas — homologação local integrada (etapas 4.1 e 4.2)

Data: 24/10/2026. Atualizado na etapa 4.2. Resultado: **suítes locais aprovadas, incluindo cenário 15; aceite remoto pendente**. A atualização v2 completa no Sandbox também continua pendente. PASS abaixo significa somente evidência local no escopo descrito.

## Referências e alterações

- Workspace: `/home/patrick.borges/projetos/oportuna`, branch `feat/analise-ia-v1`, inicialmente limpa.
- IA / PR #10: `5e36d3c1e00088ea1073d1819eee1cedaa8fb32c` (base de implementação validada).
- Billing / PR #9: `28a48a7371d46e7e590c19ba4922128fd093b519`.
- Referência financeira anterior: `183e62e56c65390111744e8e8ce2249cb5cb7949`.
- `git fetch origin` concluído. Objetos confirmados localmente; `gh pr view 9 --json number,state,headRefName,headRefOid,commits` confirmou PR aberto, branch `feat/asaas-assinatura-pro`, head e lista contendo o novo commit.
- Diff financeiro: sete arquivos, 610 inserções / 11 exclusões. Única migration alterada: `asaas_assinaturas_v1.sql`; preserva `canceled` na confirmação tardia, recalcula `paid_until` pelos pagamentos confirmados não estornados e evita reescrita em estornos repetidos. Contrato de concessões e migration de planos têm bytes idênticos aos anteriores.
- Atualizados referência e hashes do runner, referências operacionais em `IA_BILLING_ADAPTER_V1.md` e `IA_RECUPERACAO_FINANCEIRA.md`. Registros históricos em `IA_INTERFACE_V1.md` preservados.
- Adicionada suíte `tests/sql/analises-ia-homologacao-integrada.sql`; runner passou a executar também `tests/sql/asaas-negativos.sql` externo, autenticado por SHA-256.
- Nenhuma alteração no código de aplicação, migrations, score determinístico ou contrato financeiro. Migrations financeiras extraídas somente em `/tmp`; não copiadas para esta branch.
- Sem merge, rebase, reset, commit, push, SQL remoto, checkout financeiro, pagamento, ativação de cron/worker ou chamada paga OpenAI.

## Dependências e reprodução

PostgreSQL **16.15**, Python 3.12, Node **24.13.0**, dependências já instaladas, Next.js 16.2.6. Os runners removem variáveis `PG*`, criam clusters temporários com Auth sintético e encerram/removem os clusters ao final. Usam sockets Unix privados, portas 55439/55440 e `listen_addresses=''`. Não aceitam URL remota.

Extrair os arquivos imutáveis, sem checkout de branch:

```bash
python3 - <<'PY'
from pathlib import Path
import subprocess
rev = '28a48a7371d46e7e590c19ba4922128fd093b519'
base = Path('/tmp/oportuna-finance-28a48a7')
for name in ['supabase/planos_e_permissoes_v1.sql',
             'supabase/asaas_assinaturas_v1.sql',
             'supabase/billing_concessoes_v1.sql',
             'tests/sql/asaas-negativos.sql']:
    dest = base / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(subprocess.check_output(['git', 'show', f'{rev}:{name}']))
PY
python3 tests/sql/run-ia-billing-local.py /tmp/oportuna-finance-28a48a7
python3 tests/sql/run-ia-local.py
```

O runner confere SHA-256 antes de iniciar o banco. Hashes:

| Arquivo financeiro | SHA-256 |
|---|---|
| planos_e_permissoes_v1.sql | `9ec18461ea0d53834daf63f15e013000658ad32459ac6c005fd82ed61fa58884` |
| asaas_assinaturas_v1.sql | `b8d7b87ae0e9f5d7858d2f40ef821ecb124562f41803cbb9785550086695f2da` |
| billing_concessoes_v1.sql | `01a52a4537648517a95d75e3ce1414991a192953743e7b0a3f3085946217d975` |
| asaas-negativos.sql | `b04df3b8f95c41e2c9ae9e1fd81413619db4779a3f906533b43918ff104cb9d9` |

## Ordem exata do runner integrado

Primeiro, banco separado `sem_billing`: bootstrap abaixo → planos → IA execuções → conteúdo v2 → tentativa de adaptador. PASS: recusa por dependência ausente e nenhuma tabela de projeção criada.

No banco integrado:

1. `tests/sql/ia-billing-bootstrap-local.sql`: papéis anon/authenticated/service_role, schema Auth e `auth.uid()` sintético; em seguida, nesta ordem:
   - `supabase/perfis_empresa.sql`
   - `supabase/oportunidades_editais.sql`
   - `supabase/participacao_oportunidades.sql`
   - `supabase/oportunidades_origem_tipo.sql`
   - `supabase/analises_oportunidades.sql`
   - `supabase/alertas_email.sql`
   - `supabase/oportunidades_paginadas_v1.sql`
   - `supabase/oportunidades_ciclo_vida_v1.sql`
2. Financeiro externo: `supabase/planos_e_permissoes_v1.sql`.
3. Financeiro externo: `supabase/asaas_assinaturas_v1.sql`.
4. Financeiro externo: `supabase/billing_concessoes_v1.sql`.
5. IA: `supabase/analises_ia_execucoes_v1.sql`.
6. IA: `supabase/analises_ia_conteudo_v2.sql`.
7. Fixture local de legado: `tests/sql/ia-billing-legado-local.sql`.
8. IA: `supabase/analises_ia_billing_adapter_v1.sql`.
9. Suíte `tests/sql/analises-ia-billing-adapter.sql` (instala também helpers locais).
10. IA: `supabase/analises_ia_interface_v1.sql`.
11. Suíte `tests/sql/analises-ia-interface.sql`.
12. Suíte `tests/sql/analises-ia-homologacao-integrada.sql`.
13. Suíte financeira externa `tests/sql/asaas-negativos.sql` (transação com rollback).
14. Sessões concorrentes e recuperação da outbox pelo runner Python.
15. Etapa 4.2: `snapshots_concorrencia(sql)` de `tests/sql/ia_snapshots_concorrencia.py`, no mesmo banco integrado.

Não aplicar fixtures/bootstrap de teste em Supabase. A suíte IA isolada usa schema financeiro simplificado; seus resultados são complementares, não substituem o runner integrado.

## Contrato financeiro e segurança

| RPC | Retorno / acesso verificado |
|---|---|
| `ia_receber_concessao_financeira_v1(jsonb)` | boolean; owner financeiro, sem EXECUTE para public/anon/authenticated/service_role; chamada interna pela entrega |
| `billing_concessao_autorizada_v1(text,uuid,uuid,bigint)` | boolean; service_role, validada também pela reserva/início/finalização |
| `billing_concessoes_reservar_entregas_v1(text,integer)` | jsonb; service_role, leases e seleção concorrente de entregas distintas |
| `billing_concessoes_entregar_v1(text,uuid,uuid)` | text; service_role, token e revisão validados; ACK e projeção transacionais |
| `ia_reservar_v1(uuid,uuid,uuid,text,text,jsonb)` | jsonb; authenticated, exige identidade correspondente e perfil próprio |
| `ia_finalizar_v1(uuid,uuid,uuid,jsonb,jsonb,boolean)` | jsonb; backend, token de execução, resultado validado e consumo único |

Funções privilegiadas usam SECURITY DEFINER e `search_path=pg_catalog`. A instalação exige owner compatível; a suíte consulta o catálogo para comparar owner de entrega/hook. Instalação local executada pelo owner postgres: não comprova owners reais do Supabase.

Envelope validado contra a origem financeira, incluindo ambiente, identidade, plano, franquia, datas e revisão. Revisão antiga não reativa concessão; revogação anterior à entrega mantém tombstone sem crédito. Legado sobreposto exige conciliação, sem duplicar saldo.

PASS local para identidade ausente/cruzada, perfil alheio, RLS, bloqueio de leitura financeira e alteração de projeção/consumos pelo cliente; service_role não pode usar o hook para criar concessão nem reservar como usuário. DTO da interface não expõe segredos; início/token não são acessíveis ao cliente. Os testes usam tokens sintéticos no banco descartável e na memória do processo, sem registrar seus valores nos logs de sucesso. Nenhuma credencial real foi inserida em arquivo ou comando.

Locks: ambiente e origem financeira antes do advisory lock por usuário/ciclo. Sessões reais comprovaram espera por lock em reserva/revogação e conclusão/revogação, com timeout de 8s para detectar travamento nesses casos. Revogação antes da conclusão mantém execução incerta sem consumo; conclusão anterior preserva resultado/consumo. Isso não prova ausência de deadlocks para toda combinação de operações ou sob carga de produção.

## Matriz dos 18 cenários

Abreviações: A = `analises-ia-billing-adapter.sql`; H = nova suíte de homologação; I = `analises-ia-interface.sql`; E = `analises-ia-execucoes.sql` isolada; N = negativos financeiros externos; R = runner integrado.

| # | Cenário | Resultado e evidência local |
|---|---|---|
| 1 | Pro confirmado, 200 | PASS — H, pagamento sintético → concessão → entrega → limite 200 |
| 2 | Business confirmado, 1.000 | PASS — H, mesmo fluxo, limite 1.000 |
| 3 | Não confirmado | PASS para franquia paga — H/N, RECEIVED/recusa/atraso não concedem; demonstração Free continua sendo direito separado |
| 4 | Pagamento duplicado | PASS — A/N, mesmo e diferentes IDs de evento, um ciclo e outbox sem duplicação |
| 5 | Conclusão consome uma | PASS — H/A/E, resultado e uma linha de consumo |
| 6 | Consulta salva gratuita | PASS — I/E, leitura preserva estado e não consome |
| 7 | Atualização permitida/concluída | PARCIAL — E comprova versões e consumo, A comprova teto/revogação e I leitura; falta teste dedicado do fluxo completo de atualização v2 com pagamento real do sandbox |
| 8 | Repetição sem segunda cobrança | PASS local para mesma identidade hash/versão — A/E/R e testes de aplicação; não comprova faturamento externo OpenAI |
| 9 | Concessão revogada | PASS — A/R, bloqueio antes mesmo da entrega da revogação e sem débito em outro ciclo |
| 10 | Estorno futuro preserva pago vigente | PASS — H, Pro e Business, concessão vigente preservada e análise concluída nela; futuro REVOKED; N cobre estornos repetidos distintos |
| 11 | Confirmação após cancelamento | PASS — H/N, SUBSCRIPTION_DELETED sintético seguido de confirmação mantém canceled e concessão vigente |
| 12 | Webhooks fora de ordem | PASS nos casos A/N: chargeback antes de confirmação, revisão antiga, checkout expirado/overdue tardio; não é prova de todas as permutações |
| 13 | Entrega interrompida | PASS — R/N, ACK perdido, lease vencido, token antigo recusado, consumidor ausente e rollback/retry sem duplicação |
| 14 | Limite concorrente | PASS — R/E, duas sessões disputam última unidade e só uma reserva |
| 15 | Snapshots distintos simultâneos | **PASS local na etapa 4.2** — duas sessões com mesmo usuário/perfil/oportunidade, saldo 2 e saldo 1, repetição durante processamento, conclusão inversa, falha conhecida/incerta e isolamento. Hashes distintos são execuções distintas: duas solicitações aceitas podem consumir duas unidades; não existe deduplicação entre snapshots. Ver evidências e limites abaixo |
| 16 | Aniversário mensal | PASS local de cálculo — H, âncora 31 em fevereiro comum/bissexto retorna a 31 em março; A/R preservam datas e fronteira real. Calendário do gateway real pendente |
| 17 | Mudança de plano | PASS nos casos A: termos imutáveis, downgrade explícito não transfere consumo nem autoriza conclusão antiga; upgrade comercial real não executado |
| 18 | Free vitalício | PASS — A/E, legado conta, demo não recria, consulta não consome e nova geração após uso é negada |

## Validação técnica e limitações encontradas na etapa 4.1

- `npm test` com Node 24.13.0: **127/127 PASS**.
- `python3 tests/sql/run-ia-local.py`: **PASS**, inclusive quatro verificações concorrentes.
- `python3 tests/sql/run-ia-billing-local.py /tmp/oportuna-finance-28a48a7`: **PASS**, suites A/H/I/N, instalação negativa, seis verificações de concorrência/fronteira e cinco de recuperação da outbox. Nenhum worker/cron operacional iniciado: testes chamam RPCs diretamente.
- `npm run lint`: **PASS**.
- `./node_modules/.bin/tsc --noEmit`: **PASS**.
- `git diff --check`: **PASS**.
- `npm run build`: **PASS**, Node 24, `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` e chave pública fictícia `sb_publishable_local_test`; sem chave OpenAI. Não comprova conexão Supabase.
- Node 22.22.0 inicial não suporta `--test-isolation=none`; resolvido usando Node 24 instalado, sem alterar scripts.
- Sandbox inicialmente bloqueou sockets PostgreSQL e spawnSync de dois testes; reexecuções permitidas passaram. Build inicialmente não conseguiu baixar Geist/Geist Mono; reexecução com rede para fontes públicas passou. Não foram falhas funcionais de billing/IA.
- Não encontrada incompatibilidade do contrato financeiro atualizado nos testes executados; nenhuma correção exigida no PR #9/Windows.
- Score determinístico não alterado; suíte v2 rejeita score gerado e preserva campos legados, testes de matching incluídos nos 127 testes.

Logs desta execução (temporários, podem ser removidos pelo sistema): `/tmp/oportuna-integrada.log`, `/tmp/oportuna-ia.log`, `/tmp/oportuna-test.log`, `/tmp/oportuna-lint.log`, `/tmp/oportuna-tsc.log`, `/tmp/oportuna-build.log`. Evidência durável: comandos, referências imutáveis e testes versionáveis acima.

## Pendências para Supabase Sandbox

Nenhuma evidência real remota foi produzida nesta etapa. Antes do aceite:

1. Repetir cenário 15 no Sandbox através de duas requisições autenticadas reais. A etapa 4.2 comprovou as invariantes locais; caso o produto exija impedir toda segunda execução entre hashes diferentes, isso é uma mudança de regra de negócio ainda não implementada.
2. Executar atualização v2 completa e permissões no fluxo HTTP/interface com usuários autenticados reais no projeto isolado.
3. Confirmar project ref exclusivo de sandbox, schema prévio, owners das RPCs, grants/RLS efetivos, JWT/Auth e versões/extensões. Não instalar bootstrap local de Auth.
4. Aplicar migrations financeiras e IA na ordem indicada, com owner compatível, após revisão autorizada; conciliar ciclos legados sobrepostos antes de conceder saldo.
5. Validar callbacks e autenticação de webhooks Asaas Sandbox, recorrência cancelada, ciclo vigente, atraso, estorno futuro/repetido e fora de ordem com dados de teste reais. Os eventos locais são sintéticos, não assinados pelo Asaas.
6. Validar leases, timeout e concorrência na infraestrutura real, incluindo snapshots distintos, troca de plano e fronteiras de calendário/fuso.
7. Manter worker e cron desativados até autorização específica. Revisar segredo de cron, configuração de ambiente, sanitização de logs e limites antes de eventual ativação.
8. Testar provedor IA somente em etapa explicitamente autorizada, com controle de custo. Esta etapa não comprova disponibilidade, latência, cobrança ou qualidade real da OpenAI.

Entrega para revisão; não autoriza deploy, merge ou ativação remota.


## Etapa 4.2 — concorrência entre snapshots distintos

### Reprodução anterior a qualquer alteração de implementação

Branch preservada: `feat/analise-ia-v1`, HEAD IA `5e36d3c1e00088ea1073d1819eee1cedaa8fb32c`; billing externo fixado em `28a48a7371d46e7e590c19ba4922128fd093b519` e verificado pelos hashes do runner. As alterações não commitadas da etapa 4.1 foram preservadas.

A primeira execução dos novos cenários já passou contra a implementação original. **Nenhuma correção de aplicação ou migration foi necessária ou realizada nesta etapa.** Acrescentados somente módulo Python de regressão, sua chamada no runner, dois testes de aplicação e esta documentação.

Fixtures concedem duas ou uma unidades via concessão administrativa sintética do contrato financeiro real, entregue à IA pelas RPCs reais. Não criam pagamentos. Cada solicitação usa o mesmo usuário, perfil e oportunidade, mas hashes `a`/`b` e snapshots JSON efetivamente diferentes (revisões A/B). O banco é PostgreSQL 16.15 descartável com socket privado, Auth sintético, reserva como `authenticated` e início/finalização como `service_role`.

A primeira sessão mantém sua transação aberta após reservar A. A segunda tenta reservar B enquanto A segura o lock. O teste observa `pg_stat_activity.wait_event_type='Lock'` antes de liberar a disputa; há timeout de 8s nas transações. Isso comprova concorrência real, não apenas chamadas sequenciais. As duas execuções, quando aceitas, são iniciadas em sessões concorrentes. As finalizações repetidas também disputam sessões reais.

### Evidências dos oito cenários

| Cenário | Resultado observado / asserção |
|---|---|
| 1. Mesmo usuário/perfil/oportunidade | PASS: ambos os pedidos compartilham os três IDs; snapshots e hashes diferentes |
| 2. Solicitações simultâneas | PASS: B espera lock real de A; duas reservas distintas quando autorizadas |
| 3. Saldo suficiente (2) | PASS: duas execuções em processing, zero consumo até conclusão; ao final dois resultados e dois consumos, um por execução |
| 4. Apenas uma unidade | PASS: A RESERVADA, B LIMITE_ATINGIDO; um resultado/consumo após conclusão, B permanece sem crédito |
| 5. Repetição durante processamento | PASS: repetições concorrentes de A/B devolvem EM_ANDAMENTO e o ID original; novo início devolve NAO_INICIADA; nenhuma execução adicional |
| 6. Finalização inversa B→A | PASS: B concluída primeiro; A depois; finalizações duplicadas simultâneas mantêm dois resultados/consumos totais |
| 7. Falha em A com B ativa | PASS para failed e uncertain: B continua processing e conclui; A não consome nem finaliza sem reconciliação; repetir a falha não altera B |
| 8. Resultado recente preservado | PASS: registro completo de B permanece idêntico após conclusão de A; interface seleciona B para hash B e para hash C ainda sem resultado; cada conteúdo corresponde ao snapshot da própria execução |

Asserções adicionais: consumos + reservas ativas nunca superam o limite; usuário alheio não lê resultados via RLS, não consulta o perfil de outro usuário e não reserva usando sua identidade. Ao retornar explicitamente aos dados A, a interface reutiliza A por correspondência de hash — comportamento previsto e não sobrescrita de B.

### Interpretação e limites

A identidade idempotente é usuário/perfil/oportunidade/hash/versão. Portanto, **duas solicitações explícitas com hashes distintos podem gerar duas análises e consumir duas unidades**, se ambas forem aceitas e concluídas. As invariantes solicitadas não impõem uma única execução entre hashes distintos. O teste não converte esse comportamento em “uma única cobrança para qualquer snapshot”.

A consulta prévia da interface bloqueia novas ações quando encontra uma execução ativa, mas duas ações podem consultar antes de qualquer reserva. A RPC preserva limite e identidade por hash nessa corrida; ela não impõe exclusão global por oportunidade/perfil. Se for desejado impedir também duas solicitações explícitas distintas, será necessário definir essa regra e alterar a reserva transacional da IA, com regressões próprias. Não foi feita essa mudança de produto nesta etapa.

`ia_resultados_v1` mantém uma linha por execução; A e B não disputam uma linha mutável. `ia_consultar_interface_v1` prefere o hash atual e, sem correspondência, ordena pela criação da execução, não pela ordem de conclusão. A página usa o ID retornado por essa RPC ao buscar o conteúdo, por isso a conclusão tardia de A não substitui B no fluxo verificado.

Limitação de leitura: `buscarAnalisePorPerfil` sem `execucaoId` ordena pelo timestamp de criação do resultado (conclusão). Esse fallback não representa a ordem dos snapshots; consumidores que precisem da análise dos dados atuais devem usar o ID selecionado pela interface, como a página atual faz. O teste SQL comprova a seleção da RPC; não simula um navegador nem a ordenação de respostas HTTP fora de ordem. Também não comprova data de atualização da fonte externa ou ordenação semântica de snapshots arbitrários enviados pelo cliente; no fluxo atual o servidor prepara o snapshot/hash.

Os dois novos testes de aplicação exercitam `executarAnaliseSegura` com duas promessas de geração controladas e RPC simulada. Durante ambas as gerações, repetir A/B não chama novamente o gerador. Tanto na conclusão inversa quanto na falha de A, há exatamente uma chamada simulada por solicitação distinta e nenhuma retentativa automática. O dublê de RPC não é evidência de locks; essa evidência vem do PostgreSQL real. Não houve chamada OpenAI real ou cobrança externa.

### Validação da etapa 4.2

- Runner integrado completo, incluindo novos cenários: PASS, seis grupos `PASS snapshots` e todas as verificações anteriores.
- Runner IA isolado e concorrência: PASS.
- `npm test` com Node 24.13.0: **129/129 PASS**, zero falhas, cancelamentos ou skips.
- `npm run lint`: PASS.
- `tsc --noEmit`: PASS.
- Build local com URL Supabase localhost e chave fictícia: PASS.
- `git diff --check`: PASS.

Reprodução: mesmos comandos da etapa 4.1; o runner integrado agora chama automaticamente o módulo de snapshots. Logs locais desta rodada: `/tmp/oportuna-42-sql.log`, `/tmp/oportuna-42-ia.log`, `/tmp/oportuna-42-test.log`, `/tmp/oportuna-42-lint.log`, `/tmp/oportuna-42-tsc.log` e `/tmp/oportuna-42-build.log` (temporários).

Billing/Asaas, contrato financeiro, migrations e implementação da IA permaneceram inalterados. Nenhum merge, commit, push, SQL remoto, pagamento, ativação de worker ou chamada paga OpenAI. Homologação Supabase/Asaas real e fluxo HTTP continuam pendentes; entrega para revisão.


## Fechamento da etapa 4.2

Revisão do diff completo: somente sete arquivos de testes/documentação, incluindo a atualização da referência financeira da etapa 4.1. Não há alterações em `supabase/`, `lib/`, `services/` ou `app/`; nenhuma mudança de contrato, migration de billing ou regra de consumo. O PR #10 foi confirmado aberto e com origem `feat/analise-ia-v1`, no commit-base acima antes do fechamento.

**Impacto da leitura sem ID:** se A foi solicitada antes de B, mas terminou depois, `buscarAnalisePorPerfil(..., undefined)` pode retornar A, pois ordena `ia_resultados_v1.criado_em` pela conclusão. Isso é seleção potencialmente desatualizada para exibição, não sobrescrita de B nem novo consumo. O fluxo normal passa o ID selecionado por `ia_consultar_interface_v1`, que prefere o hash atual e mantém B nesse caso. Porém, a página também chama a leitura sem ID quando a consulta da interface falha ou não retorna resultado; no caso de falha ela marca `indisponivel`. Portanto, a garantia de seleção recente não deve ser estendida ao fallback. Antes do aceite remoto, validar falha da RPC e conclusão entre as duas leituras, conferir o aviso/resultado mostrado e decidir se esse caminho deve deixar de exibir uma análise sem identidade validada. Não foi alterado o comportamento neste fechamento.

As regressões confirmam consumo único mesmo com finalizações concorrentes repetidas, resultado B intacto após finalização tardia de A e ausência de geração automática adicional. Duas solicitações distintas aceitas continuam podendo consumir duas unidades; essa regra permanece a mesma.

Revalidação de fechamento: suítes PostgreSQL 16 integrada e isolada, 129 testes de aplicação, lint, TypeScript, build local com configuração fictícia e diff check aprovados. Logs temporários: `/tmp/oportuna-fechamento-{sql,ia,test,lint,tsc,build}.log`.

As afirmações anteriores de ausência de commit/push registram as etapas de validação antes desta autorização. O fechamento autoriza somente o commit `test: valida concorrencia e integracao financeira da IA` e push para `origin/feat/analise-ia-v1`; o hash final e a confirmação do PR serão apresentados no relatório de entrega. Merge, SQL remoto, ativação de worker, produção Vercel, pagamentos e chamadas pagas permanecem fora do escopo. As pendências de Supabase Sandbox descritas acima continuam abertas.
