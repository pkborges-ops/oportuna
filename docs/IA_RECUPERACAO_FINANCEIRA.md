# Etapa 2.2 — recuperação financeira por lotes

Implementação local em feat/analise-ia-v1. Nenhum agendamento foi ativado, nenhuma
variável remota foi alterada e nenhuma chamada a produção, Asaas ou OpenAI foi feita.

## Inspeção e decisão

Foram lidos IA_BILLING_ADAPTER_V1.md e o contrato/worker publicados no commit
183e62e56c65390111744e8e8ce2249cb5cb7949:
- [Contrato financeiro](https://github.com/pkborges-ops/oportuna/blob/183e62e56c65390111744e8e8ce2249cb5cb7949/docs/BILLING_CONCESSOES.md)
- [Worker da frente billing](https://github.com/pkborges-ops/oportuna/blob/183e62e56c65390111744e8e8ce2249cb5cb7949/lib/billing/entregas-financeiras.ts)

Há dois mecanismos: cron diário de alertas em vercel.json e workflow
.github/workflows/pncp-sync.yml, disparado a cada 15 minutos, também manualmente.
O segundo permite recuperação mais frequente e já tem concurrency com
cancel-in-progress=false. Foi acrescentado um job independente no MESMO workflow,
sem novo schedule, sem alterar o job/endpoint de sincronização PNCP nem o cron de alertas.

Não copiamos nem alteramos lib/billing/entregas-financeiras.ts. O executor operacional
usa diretamente as MESMAS duas RPCs oficiais. Não recria regras financeiras,
leases ou ACK em TypeScript. Essa escolha mantém esta branch compilável antes
da integração e permite orçamento/timeout por chamada sem modificar o helper
exclusivo da frente Windows. Depois da integração, apenas o job documentado deve
ser agendado; o helper financeiro original pode continuar disponível sem receber
um segundo agendamento. Não há mudança obrigatória em arquivo exclusivo do billing.

## Arquivos

Criados:
- lib/analises/recuperacao-financeira.ts: executor server-only das duas RPCs.
- app/api/cron/concessoes-financeiras/route.ts: endpoint administrativo.
- tests/worker-financeiro.test.mjs: executor/rota com mocks.
- docs/IA_RECUPERACAO_FINANCEIRA.md: operação e entrega.

Alterados:
- .github/workflows/pncp-sync.yml: job independente, desativado por padrão.
- tests/sql/run-ia-billing-local.py: cinco cenários adicionais de outbox real.

Não há migration nova nesta etapa. O guard e as migrations da Etapa 2.1 não mudaram.

## Segurança e execução

GET /api/cron/concessoes-financeiras:
1. Exige Authorization: Bearer CRON_SECRET, também em desenvolvimento.
   Segredo ausente, vazio ou incorreto: 401, sem criar cliente/buscar entregas.
2. Exige FINANCEIRO_WORKER_ENABLED=true no servidor.
3. Exige ASAAS_ENVIRONMENT=sandbox ou production, NEXT_PUBLIC_SUPABASE_URL e
   SUPABASE_SECRET_KEY. Não recebe ambiente, limite, IDs ou tokens do navegador.
4. Usa cliente administrativo exclusivamente no servidor.
5. Reserva um lote de até 10 por billing_concessoes_reservar_entregas_v1.
6. Entrega cada par ID/token por billing_concessoes_entregar_v1.
7. Retorna somente códigos e contadores; Cache-Control: no-store.

Há orçamento de 40 segundos e AbortSignal por RPC de até 5 segundos, com
maxDuration=60 na rota. Itens ainda não enviados quando o orçamento termina
ficam para recuperação do lease. Nunca drenamos indefinidamente a fila nem
criamos retentativa imediata na mesma execução.

Abortar o HTTP não comprova que o banco desfez a transação. Resultado desconhecido
incrementa falhas; não há ACK local, liberação manual de lease ou novo pagamento.
Na próxima rodada, o banco omite delivered ou recupera processing expirado com
novo token. A rotina de rede não chama webhook, checkout, pagamento ou Asaas.

Sem lock global adicional na IA: SKIP LOCKED e leases de 60s são a coordenação
distribuída oficial. Workers podem executar simultaneamente em lotes distintos;
a mesma entrega tem revisão/token conferidos pelo SQL. Concurrency do workflow
reduz sobreposição agendada, mas a correção não depende dele nem de mutex em memória.

O hook valida a concessão atual. REVIEW/REVOKED podem ser entregues e reconhecidos
sem conceder crédito. Portanto, contador entregues significa ACK do outbox, não
quantidade de ciclos autorizados. Revisão obsoleta, lease_lost e not_found são
contados em obsoletas. Pending, retry, erro RPC ou transporte resultam em 503 para
sinalizar recuperação incompleta. Não repete o lote dentro dessa requisição.

Logs usam apenas ambiente, duração, código e contadores. Não incluem envelopes,
usuários, IDs de pagamento/entrega, tokens, headers, credenciais ou mensagens RPC.
O SQL financeiro persiste erros controlados no outbox quando aplicável; falha de
transporte pode deixar processing até vencer o lease.

## Ativação futura após integração/homologação

1. Integrar as branches por procedimento aprovado, não realizado nesta etapa.
2. Instalar/verificar as migrations na ordem de IA_BILLING_ADAPTER_V1.md:
   billing base, concessões, IA v1, conteúdo v2 e adaptador, com owner compatível.
3. Publicar aplicação com endpoint e action da Etapa 2.1.
4. No ambiente servidor aprovado, configurar CRON_SECRET, Supabase administrativo,
   ASAAS_ENVIRONMENT correto e FINANCEIRO_WORKER_ENABLED=true.
5. No GitHub, configurar secret CRON_SECRET correspondente e repository variables:
   - FINANCEIRO_WORKER_ENABLED=true;
   - FINANCEIRO_RECOVERY_URL=https://<host-aprovado>/api/cron/concessoes-financeiras.
6. O job só roda em main e quando habilitado. Usa o disparo existente a cada
   15 minutos e também workflow_dispatch, sem depender do sucesso do PNCP.
7. Executar homologação com concessões fictícias e conferir outbox/projeção antes
   de habilitar qualquer operação produtiva.

Nada disso foi configurado remotamente. Sem integração/migrations, ativar o job
não corrige dependências: ele falha fechado e sinaliza 503.

O job limita cada execução a dois minutos; curl tem timeout de 70 segundos, não
segue redirects, não imprime corpo e não repete requests. HTTP diferente de 200
ou falha de transporte faz o job falhar de forma visível, sem bloquear o job PNCP.
URLs do scheduler são configuração administrativa confiável, nunca entrada pública.

Capacidade nominal: até 10 entregas por disparo (aproximadamente 40/h no schedule
atual, antes de falhas/atrasos). GitHub não garante pontualidade; confirmação
financeira pode aguardar o próximo disparo. A capacidade e esse atraso devem ser
aceitos na homologação. Se houver backlog, revisar capacidade operacional com
medição, sem contornar limites de lote/lease ou criar outro cron automaticamente.

## Monitoramento

Verificar o job recuperar-concessoes no workflow existente e os logs
[concessoes-worker]. A resposta 200 não prova que o outbox global está vazio:
apenas que o lote recebido terminou sem falha reportada.

Consultas somente administrativas, no ambiente correspondente. Exemplo sandbox,
sem retornar IDs, documentos, tokens ou pagamentos:

```sql
select status,
       count(*) as quantidade,
       min(criado_em) as entrega_mais_antiga,
       count(*) filter (where ultimo_erro is not null) as com_erro,
       count(*) filter (
         where status='processing' and lease_ate<=clock_timestamp()
       ) as leases_expirados
from public.billing_concessoes_entregas
where ambiente='sandbox'
group by status;

select ultimo_erro, count(*) as quantidade, min(criado_em) as mais_antiga
from public.billing_concessoes_entregas
where ambiente='sandbox' and status in ('pending','processing')
group by ultimo_erro;

select estado, count(*) as quantidade
from public.billing_concessoes
where ambiente='sandbox'
group by estado;
```

Alertas sugeridos para a operação: falhas repetidas do job; pendências que
atravessam dois disparos previstos; backlog crescente; CONSUMER_NOT_INSTALLED,
CONSUMER_INCOMPATIBLE e SQLSTATE recorrente. Não foram criados alertas externos.

- 401: conferir CRON_SECRET/Authorization no scheduler e servidor.
- WORKER_DESABILITADO: conferir habilitação de ambos os lados.
- CONFIGURACAO_INVALIDA: conferir presença das variáveis, sem imprimir valores.
- RESERVA_INDISPONIVEL: conferir ambiente instalado, grants, migrations e transporte.
- Pending por consumidor ausente/incompatível: instalar/revisar hook e owner.
- SQLSTATE de sobreposição: conciliar saldo legado conforme Etapa 2.1.
- REVIEW: procedimento financeiro próprio; nunca liberar crédito no worker.

Não editar status/token/revisão manualmente para "destravar" produção. O contrato
já recupera leases e usa espera de um minuto para erros conhecidos. A suite altera
timestamps apenas no banco descartável para simular passagem de tempo.

Worker indisponível atrasa a projeção e o saldo novo. O guard transacional permanece
ativo e continua negando concessões revogadas, mesmo com a projeção atrasada.
Desativar o job/endpoint é uma pausa operacional segura; não desabilitar o guard.

## Validação

- 124 testes Node aprovados, com mocks de RPC/cliente: entrega, duplicate, pending,
  stale, lease_lost, retry, rede incerta, ambiente, credenciais, autenticação,
  limite de lote, orçamento e logs sanitizados.
- PostgreSQL 16 descartável: 56 cenários/verificações PASS, com migrations
  financeiras reais do commit fixado. Inclui concorrência de dois consumidores,
  lease expirado/token antigo, entrega após ACK perdido, revogação antes da
  recuperação, revisão antiga e ausência/reinstalação do hook. A suite anterior
  também cobre REVIEW, falha temporária com rollback e ambientes divergentes.
- O SQL valida as RPCs reais; não é E2E HTTP Supabase/Asaas. Schema Auth é emulado.
- lint, TypeScript e git diff --check. Build com configuração Supabase fictícia,
  sem OPENAI_API_KEY nem habilitar worker.

Comandos locais:
```sh
npm test
npm run lint
npx tsc --noEmit
git diff --check
python3 tests/sql/run-ia-billing-local.py /tmp/oportuna-finance-183e62e
```

Ainda precisam de homologação: JWT/roles e credentials reais do ambiente de teste,
URL/segredo do scheduler, tempo das RPCs sob carga, atraso/capacidade do lote,
notificação operacional e recuperação entre instâncias reais. Sem commit, push,
merge, publicação, migrations remotas, chamadas OpenAI ou cobrança nesta etapa.
