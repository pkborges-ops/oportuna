# Contrato financeiro de franquias IA — v1

Implementação preparada para integração, sem aplicação remota. Complementa o PR #9 na branch
`feat/asaas-assinatura-pro`. Não contém a implementação de consumo da branch
`feat/analise-ia-v1`. Não habilita produção nem altera canário, checkout, token,
validação de preço ou verificação de pagamento no Asaas.

## Fonte de autorização

Um pagamento confirmado cria no máximo uma concessão, identificada por UUID
próprio e pela chave única `(ambiente, pagamento_id)`. IDs diferentes de webhook
para o mesmo pagamento não criam outra concessão ou estendem seu período.
`paid_until` continua sendo uma projeção de acesso existente; **não identifica
um ciclo nem autoriza uma nova franquia de IA**.

O contrato é capturado no primeiro registro local do pagamento, a partir dos
termos persistidos da assinatura: ambiente, usuário, assinatura, plano, valor,
franquia, ciclo e aniversário. O vencimento inicialmente conhecido é preservado.
Após esse registro, esses termos da assinatura ficam protegidos contra mudança.
Alterar variáveis de catálogo não reescreve contratos/pagamentos já registrados.
Não existe fallback para franquias fixas de Pro ou Business.

O trigger de confirmação grava concessão, revisão de auditoria e outbox **na
mesma transação** da RPC financeira existente. Falha nessa gravação desfaz a
confirmação e mantém o webhook em `error`, com retorno `retry`, para reentrega.
`CHECKOUT_PAID`, retorno de navegador, criação de assinatura, pagamento criado,
recebimento isolado e atraso não autorizam uma concessão. O handler continua
validando token, consultando o pagamento no Asaas e correlacionando as entidades.

## Envelope privado para a frente IA

Tipo publicado em `lib/billing/contrato-concessao.ts`. Exemplo estrutural, sem
identificadores reais:

```json
{
  "contrato_versao": 1,
  "concessao_id": "<uuid estável>",
  "ambiente": "sandbox",
  "usuario_id": "<uuid>",
  "assinatura_id": "<uuid ou null para ADMIN>",
  "pagamento_id": "<uuid local ou null para ADMIN>",
  "origem": "PAYMENT",
  "plano": "PRO",
  "franquia": 17,
  "inicio": "2026-01-31T03:00:00+00:00",
  "fim": "2026-02-28T03:00:00+00:00",
  "estado": "AUTHORIZED",
  "revisao": 1
}
```

`17` é apenas exemplo de termo contratado, não preço/franquia comercial.
`pagamento_id` é o ID interno de `billing_payments`, não o ID do Asaas.
O envelope não contém cartão, documento, endereço, e-mail, tokens, URL de checkout
ou justificativa administrativa. É uma interface de banco/servidor, sem rota
pública e sem acesso direto para `anon`/`authenticated`.

Estados:

| Estado | Significado e efeito |
|---|---|
| `AUTHORIZED` | Termos financeiros válidos; consumo somente dentro de `[inicio, fim)` e na revisão atual |
| `REVIEW` | Não autoriza consumo: termos legados, franquia ausente, vencimento desalinhado ou sobreposição |
| `REVOKED` | Terminal; não autoriza consumo nem reativação por confirmação/entrega antiga |

Termos e identidade são imutáveis. A única transição permitida é para `REVOKED`,
incrementando a revisão exatamente uma vez. Cada revisão tem auditoria e entrega
próprias. `franquia` pode ser nula em revisão/revogação de termos incompletos;
jamais em `AUTHORIZED`. Corrigir um caso em revisão exige conciliação explícita;
não se promove a concessão reescrevendo o histórico.

## Períodos e políticas financeiras

Todos os limites são meia-noite de Brasília (`America/Sao_Paulo`), convertidos
para `timestamptz`. Início inclusivo, fim exclusivo.

| Situação | Política v1 |
|---|---|
| Aniversário | Dia original da criação da reserva/contrato, persistido em `cobranca_ancora`; pagamento usa o mês de seu vencimento |
| Dias 29, 30 e 31 | Ajustar ao último dia do mês curto, conservando o dia original para o mês seguinte; 31/jan → 28 ou 29/fev → 31/mar |
| Antecipado | Registrar a concessão futura; não permitir consumo antes do início e não acumular saldo no período atual |
| Atrasado | Manter o ciclo original do vencimento; não criar novo mês a partir da data de confirmação; período já encerrado não é consumível |
| Fora de ordem | Cada pagamento mantém sua identidade/ciclo, mesmo que o de mês posterior chegue primeiro |
| Vencimento alterado após captura | Não deslocar o período originalmente registrado; não usar novo webhook para estender a franquia |
| Primeiro vencimento desalinhado | `REVIEW / DUE_DATE_CHANGED`; conferir manualmente o contrato, sem adivinhar outro aniversário |
| Sobreposição | Outro pagamento para intervalo já autorizado fica `REVIEW / OVERLAPPING_PERIOD`; não soma nem reinicia franquia. Adjacência é permitida |
| Estorno/chargeback | Revogar somente a concessão do pagamento correspondente, inclusive se outro período posterior estiver pago. Revogação imediata e terminal; não devolver saldo usado nem oferecer saldo novo |
| Cancelamento da recorrência | Preservar concessões e períodos já pagos até seus fins; não criar renovação sem outro pagamento confirmado |
| Upgrade/downgrade | Não oferecidos automaticamente. Proibida alteração dos termos de contrato já com pagamento. Exigem política comercial própria e contrato separado, revisado, sem sobreposição/duplo saldo |

Não há rateio, transferência de saldo, recuperação automática de dias perdidos
por atraso ou soma de franquias sobrepostas. O contrato administrativo admite
intervalo próprio, explicitamente justificado, com a mesma proteção contra
sobreposição e revogação. A projeção legada de plano e suas regras existentes
não substituem a verificação temporal da franquia.

## Recuperação independente de webhook

Outbox `billing_concessoes_entregas`, com chave única `(concessao_id, revisao)`:

1. Serviço chama `billing_concessoes_reservar_entregas_v1(ambiente, limite)`
   (1–100). `SKIP LOCKED` reserva o lote, prioriza revogações e devolve somente
   `{entrega_id, token}`. Lease de 60 segundos, novo token a cada recuperação.
2. Serviço chama `billing_concessoes_entregar_v1(ambiente, entrega_id, token)`.
   A função trava a concessão de origem e confere revisão, token e lease.
3. Dentro da **mesma transação**, entrega o envelope atual ao hook SQL fixo
   `public.ia_receber_concessao_financeira_v1(jsonb) RETURNS boolean`.
4. Somente `true` confirma a entrega. Escrita do consumidor e ACK são atômicos.
   Erro/`false` desfaz efeitos parciais do consumidor, mantém pendência com espera
   de um minuto e registra somente SQLSTATE. Ausência/incompatibilidade do hook
   mantém pendência com código controlado, sem fingir sucesso.

O hook deve pertencer ao **mesmo owner de instalação da função financeira**,
retornar um booleano escalar e não ser executável por usuários da aplicação.
Hook de role não confiável é recusado antes da execução. Não chamar rede/Asaas
dentro do hook. O worker não recebe envelope ou permissão do navegador.

`recuperarEntregasFinanceiras()` em `lib/billing/entregas-financeiras.ts` é o
ponto server-only para um worker recuperar lotes, sem webhook novo, chave Asaas,
checkout ou pagamento. Usa `ASAAS_ENVIRONMENT` e o cliente Supabase administrativo;
o banco confirma que o ambiente é compatível. Não há cron/rota/keep-alive novo.
Ainda é necessário ligar esse ponto a um worker autorizado após a integração IA.
Falha de transporte não confirma entrega: lease expirado permite nova tentativa.

## Obrigações da integração IA

A frente Linux deve implementar o hook acima em **sua própria migration** e
integrá-lo ao seu modelo de saldo/consumo. Não copiar a migration de consumo
para a branch financeira. A assinatura SQL e o envelope v1 são o ponto de acordo.

- Chave de saldo: `concessao_id`; guardar a maior `revisao` observada por origem.
  Aplicação repetida da mesma revisão não credita/reinicia saldo; revisão antiga
  não substitui nova. `REVOKED` precisa manter tombstone, mesmo sem saldo anterior.
- Rejeitar versão de envelope desconhecida, sem presumir compatibilidade futura.
- Usar franquia, usuário, ambiente e intervalo do envelope canônico, não catálogo
  atual, `paid_until`, plano enviado pelo browser ou consulta ao Asaas.
- Saldo futuro não é consumível antes do início; saldo encerrado não é renovado
  pela entrega tardia. Revisões não criam nova identidade de ciclo.
- **Antes de reservar um consumo**, a RPC SQL da IA deve obter identidade por
  `auth.uid()` (sem aceitar outro usuário do cliente) e chamar
  `billing_concessao_autorizada_v1(ambiente, usuario, concessao, revisao)`
  **na mesma transação** da reserva. Se `false`, negar o consumo.
- Esse guard trava a concessão com `FOR SHARE` até o fim da transação. Uma
  revogação usa lock incompatível. Assim o consumo e a revogação são ordenados,
  mesmo que a entrega da revogação ainda esteja pendente. Uma checagem por HTTP
  seguida de escrita separada **não** fornece essa proteção.
- Ordem de locks: origem financeira antes dos registros de saldo/consumo. O hook
  não deve adquirir locks de assinatura/pagamento no sentido inverso.
- A RPC pública de consumo deve negar acesso direto ao hook/guard e às tabelas
  financeiras. O guard só tem EXECUTE para `service_role` e owner; seu parâmetro
  de usuário não substitui a autenticação exigida na RPC de consumo.

A entrega também mantém lock da origem durante o consumidor: revisão antiga
reservada antes de um estorno torna-se `superseded` e não é executada depois da
revogação. Se a entrega terminou antes, a origem já revogada impede novo consumo
mesmo enquanto a projeção da IA aguarda revisão 2.

## SQL, administração e legado

Ordem de instalação/reaplicação, **somente mediante autorização futura**:

1. `supabase/asaas_assinaturas_v1.sql` atualizada;
2. `supabase/billing_concessoes_v1.sql`;
3. migration/consumidor da frente IA, quando revisado conjuntamente.

O ajuste na primeira migration é mínimo: projeção de plano usa o fim persistido
do pagamento (incluindo o ajuste de calendário); estorno já registrado não ganha
outra data a cada evento. A segunda migration adiciona termos/âncora, concessões,
revisões, outbox, triggers e RPCs privadas. Não modifica policy de oportunidades,
matching, dashboard, timeout, canário ou configuração Production.

Reaplicar somente a migration base não é a instalação completa do contrato:
a complementar deve vir depois, inclusive para restabelecer os grants mínimos.

Dados antigos de billing, projeções e histórico são preservados. A instalação
**não emite créditos para pagamentos históricos**, pois não prova seus termos
originais nem quanto já foi consumido. Ao tocar um pagamento legado, o snapshot
fica `LEGACY`; confirmação antiga gera somente `REVIEW`, ou `REVOKED` se estornado.
Antes da adoção pela IA, conciliar saldos/períodos existentes em operação separada,
revisada, sem resetar consumo nem inventar franquias retroativas.

`billing_conceder_administrativa_v1(...)` e
`billing_revogar_administrativa_v1(...)` são exclusivas do owner administrativo,
não do `service_role`/webhook/browser. Exigem origem `ADMIN`, referência idempotente,
justificativa, autor, usuário, plano, franquia e intervalo explícitos; não criam
cliente, assinatura ou pagamento fictício. Não alteram a projeção legada de plano.

RLS permanece ativa nas três novas tabelas, sem acesso de `anon`/`authenticated`.
Serviço tem SELECT e as três RPCs de guard/reserva/entrega, sem mutação direta de
concessões/outbox/pagamentos. Escrita financeira continua nas funções existentes
SECURITY DEFINER. Histórico de concessões usa FKs `RESTRICT`: exclusão física de
usuário/pagamento/assinatura com concessão passa a ser bloqueada. Retenção e
anonimização administrativa exigem procedimento próprio, sem apagar auditoria.

## Validação e limites desta etapa

`tests/sql/billing-concessoes.sql` usa fixtures descartáveis e ROLLBACK; seu hook
é apenas um dublê de testes, não o consumidor de IA. O runner local PGlite exercita
Sandbox e Production **simulados em memória**, preservação do legado, reaplicação,
atomicidade sob falha, deduplicação, calendários, revisão/revogação, leases,
recuperação e permissões reais de roles. Não é execução produtiva nem prova de
concorrência distribuída no Supabase.

Pendências: revisão conjunta da interface Linux, instalação do consumidor, worker
de recuperação/monitoramento, conciliação do legado, testes concorrentes em
homologação e E2Es negativos financeiros no Asaas. Manter os status anteriores
de billing e latência fria separados. Nenhuma dessas pendências autoriza merge,
migration remota, configuração produtiva ou cobrança real.

Rollback operacional futuro: bloquear novas contratações/consumos se necessário,
preservando recepção de eventos, revogações, concessões, revisões e outbox. Repor
somente versões de aplicação/consumidor compatíveis com o contrato; não apagar
grants nem voltar a autorizar IA apenas pela projeção legada. Pausar o worker
pode atrasar a projeção, mas nunca dispensar o guard financeiro no consumo.
