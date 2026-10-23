# IA — execução segura e franquia por ciclo (etapa 1)

Implementação local na branch `feat/analise-ia-v1`. A migration **não foi aplicada remotamente**. Nenhum arquivo de Asaas foi modificado. Esta etapa não redesenha a interface nem habilita atualização de análise por botão novo.

## Arquivos da entrega

Criados:

- `supabase/analises_ia_execucoes_v1.sql`: estrutura, permissões e RPCs.
- `lib/analises/contrato.ts`: snapshot, hash, versão e validação.
- `lib/analises/executar.ts`: orquestração sem repetição automática do provedor.
- `services/franquia-ia-service.ts`: DTO autenticado de saldo.
- `tests/analises-ia.test.mjs`: testes com dependências externas simuladas.
- `tests/sql/analises-ia-execucoes.sql`: testes de integridade, autorização e recuperação.
- `tests/sql/ia-bootstrap-local.sql`: base descartável de testes.
- `tests/sql/run-ia-local.py`: runner PostgreSQL e concorrência real.
- `docs/IA_EXECUCOES_V1.md`: contrato e relatório desta etapa.

Alterados:

- `app/(painel)/oportunidades/actions.ts`: troca de inserção direta pelas RPCs confiáveis.
- `lib/openai/analise-oportunidade.ts`: timeout, validação e metadados, sem chamadas reais durante desenvolvimento.
- `services/analises-service.ts`: leitura da versão nova com fallback ao legado.
- `tests/helpers/matching-doubles.mjs` e `tests/helpers/matching-integracao.mjs`: adaptação dos testes existentes ao contrato novo.

## Fronteira com billing / PR #9

Billing continua sendo a única autoridade de confirmação financeira, concessão de plano, franquia contratada, identidade da assinatura e início/fim do período pago. IA não cria pagamentos, não calcula aniversário e não estende a assinatura.

A configuração comercial aprovada é Free com uma demonstração vitalícia, Pro com 200 e Business com 1.000 análises por ciclo. Os números pagos **não estão nas regras SQL**: `ia_autorizar_ciclo_v1` lê `assinaturas_usuario.franquia_ia` e registra um snapshot imutável da franquia daquele ciclo. Alterações financeiras posteriores não reescrevem consumo histórico.

Contrato de entrada, somente backend `service_role`, após confirmação e commit do billing:

| Campo | Origem obrigatória |
| --- | --- |
| `p_usuario` | Conta proprietária da assinatura |
| `p_assinatura_ref` | Identificador estável da assinatura; com PR #9, UUID de `billing_subscriptions.id` / `billing_subscription_id` |
| `p_periodo_ref` | Identificador comercial estável do período pago, igual em todas as entregas do mesmo evento/período |
| `p_inicio`, `p_fim` | Limites exatos `[início, fim)` do período por aniversário, calculados/concedidos pelo billing |
| Franquia | Lida de `assinaturas_usuario.franquia_ia`; não é argumento da RPC |
| Plano/status/vigência | Lidos de `assinaturas_usuario`; requer Pro/Business ativo ou trial e `fim_em >= p_fim` |

O PR #9 inspecionado (`97102b8`) contém franquia, `billing_subscription_id`, vencimento e fim do período. O adaptador ainda precisa fornecer **início explícito e chave estável do período** e chamar a RPC. Não usar `inicio_em` da primeira ativação como se fosse início de toda renovação; não inferir do `created_at`, do relógio ou do mês-calendário. O adaptador de produção não foi implementado nesta frente.

A RPC não verifica o Asaas: ela confia na concessão já confirmada pelo backend financeiro. Não chamá-la com dados de formulário ou diretamente de uma rota de cliente. `trial` mantém a semântica existente de plano efetivo, mas só recebe ciclo se o backend conceder explicitamente esse período. Ausência de ciclo/limite finito/vigência conhecida bloqueia geração paga, sem fallback para ilimitado ou para a demo Free. Pro/Business devem chegar com limites aprovados no banco, inclusive os configurados por `PRO_MONTHLY_AI_LIMIT` / `BUSINESS_MONTHLY_AI_LIMIT` do PR #9.

A mesma identidade de assinatura+período devolve o mesmo ciclo, não altera limite e não reativa um ciclo revogado. Mesma identidade com datas diferentes é erro. Períodos pagos sobrepostos são rejeitados, mesmo com outro ID de evento. Para mudança de contrato no meio de um período, o billing deve revogar explicitamente o ciclo anterior e conceder um novo período autorizado, com política de franquia definida; esta etapa não inventa prorrata ou bônus de upgrade. A ativação da assinatura deve ser commitada antes da chamada ao adaptador: as RPCs de IA usam lock por usuário e leitura bloqueante da assinatura.

A main atual não precisa receber um catálogo financeiro paralelo. O resolver interno de IA compreende FREE/PRO/BUSINESS; o banco atual só terá Business após as alterações de schema do PR #9. A função lê `billing_subscription_id` via JSON quando o campo existir, permanecendo compatível com o schema anterior. O PR #9 também deve fornecer as regras de visibilidade de oportunidades para Business; a leitura de resultados respeita a RLS existente de oportunidades.

## Estrutura e permissões

Migration: `supabase/analises_ia_execucoes_v1.sql`. Requer as migrations existentes de perfis/oportunidades/análises e `planos_e_permissoes_v1.sql` (incluindo o helper de visibilidade). Nenhuma migration anterior foi editada.

| Tabela | Responsabilidade |
| --- | --- |
| `ia_ciclos_v1` | Concessão imutável do período, plano, limite e revogação |
| `ia_demonstracoes_legado_v1` | Evidência conservadora de demo já usada antes desta migration |
| `ia_execucoes_v1` | Identidade, usuário, perfil, oportunidade, hash, versão, snapshot, ciclo, estado, token, prazos e diagnóstico |
| `ia_resultados_v1` | Resultado validado de cada versão, ligado a uma única execução |
| `ia_consumos_v1` | Uma unidade definitiva por execução, no ciclo reservado |

Todas possuem RLS. Usuários podem ler somente resultados próprios autorizados e consultar saldo por RPC, que usa `auth.uid()`. Tokens/snapshots não são expostos ao cliente. As mutações e inspeção operacional são exclusivas de RPCs de backend; escrita direta nas tabelas novas é revogada até para `service_role`. Os helpers privilegiados não têm `EXECUTE` para PUBLIC, anon ou authenticated e usam `search_path=pg_catalog` com tabelas qualificadas.

A action obtém o usuário por `auth.getUser()`, verifica as leituras autenticadas e encaminha sua identidade ao backend. O banco verifica novamente propriedade do perfil e autorização da oportunidade. IDs, token, hash e ciclo não podem ser controlados por FormData. A chave administrativa já utilizada no projeto (`SUPABASE_SECRET_KEY`) permanece exclusivamente no servidor.

Na tabela legada, INSERT/UPDATE/DELETE de clientes são revogados e as respectivas policies removidas; SELECT e RLS são mantidos. As RPCs antigas de reserva/liberação perdem acesso de cliente/backend. Seus dados e triggers históricos não são removidos. Migração e código novo devem ser liberados juntos, após drenar execuções antigas: uma chamada antiga em voo poderá perder a gravação ao fechar o caminho anterior.

Novas versões usam FKs sem exclusão em cascata de perfil/oportunidade, protegendo o histórico. A exclusão desses registros com versões novas passa a ser bloqueada; exclusão de conta continua sendo governada pelas cascatas do usuário. Uma política futura de retenção/anonimização deve tratar isso explicitamente.

## RPCs e estados

| RPC | Acesso | Comportamento |
| --- | --- | --- |
| `ia_consultar_franquia_v1()` | authenticated | Plano, limite, usados, reservados, disponíveis, ciclo e datas da própria conta |
| `ia_autorizar_ciclo_v1(...)` | service_role | Entrada idempotente do contrato de billing |
| `ia_revogar_ciclo_v1(...)` | service_role | Revoga concessão paga sem apagar histórico |
| `ia_reservar_v1(...)` | service_role | Autoriza contexto, reutiliza versão, detecta execução ativa e reserva saldo |
| `ia_iniciar_v1(...)` | service_role | Transição única pending → processing, retorna token ao backend |
| `ia_finalizar_v1(...)` | service_role | Persiste resultado + consumo + completed na mesma transação |
| `ia_falhar_v1(...)` | service_role | Falha conhecida libera; resultado desconhecido fica uncertain |
| `ia_recuperar_v1(usuario)` | service_role | Pending vencido → failed; processing vencido → uncertain |
| `ia_inspecionar_v1(usuario,execução)` | service_role | Snapshot/token/diagnóstico para reconciliação operacional |

Reserva `pending` dura dois minutos. `processing` dura até três minutos, limitado ao fim do ciclo. A chamada HTTP tem timeout explícito de 90 segundos. A API nunca repete automaticamente a chamada paga. Os relógios de autorização/expiração usam `clock_timestamp()`, inclusive após espera por lock.

`pending`, `processing` e `uncertain` ocupam uma unidade no ciclo original; `completed` ocupa consumo definitivo; `failed` não ocupa unidade. A exclusividade por conta/perfil/oportunidade/hash/versão impede outra execução ativa ou concluída da mesma versão. Todas as mutações de franquia são serializadas pelo mesmo advisory lock transacional por usuário. Token e estado impedem que uma tentativa antiga finalize uma nova.

Finalizar novamente uma execução concluída retorna a conclusão sem atualizar conteúdo e sem novo consumo. Não existe intervalo entre resultado salvo e reserva liberada. Uma execução que cruza o limite do ciclo não pode cobrar o próximo; torna-se incerta. Novas versões podem usar o ciclo novo, mas repetir a versão incerta exige reconciliação. `renovacao` no DTO é a fronteira do período atual, **não uma promessa de renovação automática**.

## Recuperação operacional

1. Consultar `ia_inspecionar_v1` pelo backend. Nunca retornar token ou snapshot em mensagens/UI.
2. Se completed: devolver resultado existente; uma perda de resposta após commit não muda o estado.
3. Se pending vencido: `ia_recuperar_v1` libera com segurança, pois a chamada ainda não foi autorizada por `ia_iniciar_v1`.
4. Se processing vencido/uncertain: não disparar OpenAI. A reserva permanece no ciclo original.
5. Se há resultado conhecido e validado, executar `ia_finalizar_v1` com o mesmo token e `p_reconciliar=true`. Só conclui se ciclo e contexto ainda forem autorizados.
6. Se for comprovado que não há resultado a persistir, executar `ia_falhar_v1` com o mesmo token, `p_incerta=false`, `p_reconciliar=true` e um código de diagnóstico.
7. Se ainda desconhecido, manter uncertain. Período encerrado não recebe conclusão tardia; reconciliação deve encerrar sem consumo quando não for possível entregar resultado no ciclo autorizado.

A action tenta guardar metadados mínimos (ID da resposta, modelo, tokens e duração) ao falhar após geração. Uma indisponibilidade total do banco ou queda de processo antes desse registro pode perder o ID e o resultado em memória. Não há armazenamento durável intermediário da resposta nem worker/cron instalado nesta etapa. A recuperação por leitura/reserva chama o tratamento de expiração; a RPC também fica disponível para operação futura. Não se promete exatamente uma cobrança do provedor quando a resposta é desconhecida.

## Hash, legado e interface

O hash SHA-256 representa exatamente os campos enviados ao modelo; palavras-chave e tags são ordenadas. Versão do contrato é independente do modelo e precisa ser incrementada quando o prompt/semântica mudar. CNPJ não é enviado. O limite de entrada é 60 KB e a saída é validada sem coerções ou truncamento silencioso antes da finalização. O banco também valida o resultado.

As análises antigas ficam na tabela original, sem hash/ciclo/execução inventados. Não são convertidas em consumo pago do ciclo atual. Qualquer evidência em `analises_ia_consumos` ou `analises_oportunidades` gera a marca conservadora de demo usada, inclusive quando o conteúdo antigo já foi excluído mas existe consumo. O legado não informa em qual plano ocorreu o consumo: essa ambiguidade é preservada e não pode recriar demonstrações.

O serviço lê primeiro a versão nova mais recente e depois o legado. A action preserva a reutilização legada; não cobra atualização automática de conteúdo cujo hash histórico é desconhecido. Novas execuções com dados relevantes diferentes têm outro hash e consomem uma nova unidade. A consulta de resultado salvo não inicia geração nem consumo.

A tela permanece como estava, inclusive botão desabilitado quando existe análise e score IA exibido. Portanto, atualização deliberada, aviso de desatualização, saldo visual e remoção do segundo score ficam para a próxima etapa. A infraestrutura permite versões; não foi criado um atalho de UI para gerar novamente. Downgrade preserva dados e segue as autorizações de acesso às oportunidades.

## Testes e reprodução

Use Node 24.13.0 neste ambiente (Node 22.22.0 padrão não aceita `--test-isolation=none`).

```sh
npm test
npm run lint
npx tsc --noEmit --incremental false
git diff --check
npm run build
python3 tests/sql/run-ia-local.py
```

O runner SQL cria e destrói seu próprio cluster PostgreSQL 16 em `/tmp`, com UTF-8, socket privado e TCP desabilitado. Não aceita URL remota e descarta variáveis `PG*` herdadas. Usa as migrations reais de perfis/oportunidades/análises, um contrato mínimo de Auth/assinaturas/visibilidade e a migration nova real. Não é uma validação do conjunto completo de migrations nem do PostgREST/Supabase gerenciado. O fixture permite Business; não altera o schema do projeto real.

Os testes Node usam mocks de OpenAI e RPC. Os testes SQL executam funções, privilégios e RLS reais. O runner cria sessões concorrentes reais para dois cliques, dois itens na última vaga, duas finalizações e duas concessões do mesmo período. Os testes cobrem Free, Pro, Business, ausência de ciclo, renovação explícita, duplicação/revogação, downgrade, legado, novas versões, falha conhecida, resultado incerto, expiração, virada de ciclo, token incorreto, acesso cruzado e escrita não autorizada. Limites pequenos nas fixtures provam que não há 200/1.000 fixos na regra.

Validação local em 20/10/2026:

- `npm test`: 90 testes aprovados com Node 24.13.0, incluindo o grupo de integração que executa 21 cenários em subprocesso. No sandbox, a primeira tentativa teve 89 PASS e um bloqueio `spawnSync EPERM`; a execução com subprocessos autorizados passou integralmente.
- `npm run lint`, TypeScript e `git diff --check`: aprovados.
- `npm run build`: sem configuração, parou corretamente no prebuild por ausência das duas variáveis públicas Supabase. Com valores fictícios (`http://127.0.0.1:54321`, chave pública local sem validade), o sandbox bloqueou Google Fonts. Com acesso às fontes e subprocessos autorizado, compilação, TypeScript e geração de 18 páginas passaram. Não havia chave OpenAI e não foi configurado banco remoto.
- `python3 tests/sql/run-ia-local.py`: aprovado no PostgreSQL 16.15 real, com RLS/privilégios e quatro cenários concorrentes reais. O sandbox inicialmente bloqueou o socket; o runner foi executado com permissão de socket local e apagou seu cluster ao terminar.
- Não foram executados HTTP PostgREST real, migrations remotas, testes financeiros reais, chamadas pagas, deploy ou operações Git de publicação.

Esta proposta exige revisão e homologação integrada com o contrato final do PR #9 antes de qualquer aplicação remota.
