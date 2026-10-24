# Homologacao negativa do Asaas — 23/10/2026

Branch `feat/asaas-assinatura-pro`, base publicada `183e62e`, PR #9 sem merge.
Esta etapa e LOCAL. Nao houve nova operacao no Asaas, SQL remoto, publicacao,
configuracao Production ou pagamento real. Este relatorio nao declara o gateway
integralmente homologado. Estado do provedor/banco remoto hoje nao foi consultado.

## Inventario de evidencias

Fonte historica: `tests/sql/HOMOLOGACAO.md`. As execucoes abaixo ja foram
registradas naquela data; nao foram repetidas agora.

| Evidencia | Data | Nivel e limite |
|---|---|---|
| E2E Pro e Business, checkout hospedado, pagamento ficticio aprovado, PAYMENT_CONFIRMED HTTP 200, plano/franquia/validade e isolamento | 08/10 | Sandbox real, versao anterior ao contrato financeiro novo |
| Reentrega manual Business, mesmo PAYMENT_CONFIRMED, periodo e contagens preservados | 08/10 | Sandbox real; nao representa eventos arbitrariamente fora de ordem |
| Reentrega Pro, HTTP 200 e hashes/contagens preservados; tokens ausente/invalido HTTP 401 | 13/10 | Sandbox/Preview reais |
| Falha Pro HTTP 503 e nova entrega do mesmo evento apos correcao | 08/10 | Falha/recuperacao realmente observadas; nao e um teste atual de caos ou de outbox IA |
| Checkout Pro criado sem pagamento; successUrl manteve Free | 14/10 | Smoke real, nao expiracao comprovada so por ter passado o horario |
| Pagamento nao autorizado no checkout; retorno cancelado Free; CHECKOUT_CREATED HTTP 200 | 19/10 | Recusa PARCIAL: faltam correlacao final de pagamento/reserva e evidencia do cenario de recusa usado |
| Vencimento, atraso seguido de confirmacao, expiracao, estorno, chargeback, cancelamento e diversas inversoes de ordem | Antes desta etapa | Somente testes SQL/mocks; sem E2E completo do gateway documentado |
| Concessoes novas, revisoes, outbox, guard financeiro e recuperador | 21/10 | Somente local, migration nova nao aplicada remotamente |

Os E2Es de 08/10 nao comprovam `billing_concessoes`/outbox do contrato de 21/10.
As referencias antigas a concessoes/projecoes nao sao evidencias da tabela nova.
Registros historicos PASS nao foram promovidos a PASS atual sem nova observacao.

## Preflight seguro atual

- Branch correta e workspace inicialmente limpo em `183e62e`.
- `.env.local`: URL publica Supabase coincide com homologacao; chave publica
  presente. Sem `ASAAS_ENVIRONMENT`, API key, token de webhook, secret Supabase
  administrativo e `APP_BASE_URL`. Essas cinco configuracoes tambem estao
  ausentes no ambiente deste processo. Nenhum valor secreto foi impresso.
- Nao foram buscados secrets na Vercel, alteradas variaveis ou aproveitadas
  configuracoes de Production. A configuracao do Preview nao foi revalidada.
- Consequencia: nenhum teste remoto foi tentado nem marcado PASS nesta etapa.
  Credenciais podem existir no Preview historico, mas isso nao equivale a acesso
  autorizado/disponivel para executar os testes deste processo.

## Matriz de comportamento

Termos: P = plano contratado (Pro/Business); U = fim originalmente pago; G =
concessao daquele pagamento. Estados internos abaixo sao para QA, nao para a UI.
Todos os testes preservam historico e verificam ausencia de outra assinatura ou
pagamento criado por repeticao. Consumidor Linux nao foi instalado por esta frente.

| # / Cenario | Situacao inicial | Acao controlada | Assinatura e acesso esperados | Situacao financeira | Concessoes IA | Eventos esperados/se aplicaveis |
|---|---|---|---|---|---|---|
| 1 Recusa | Free, um checkout P sem pagamento confirmado | Uma tentativa com cartao de recusa oficial, exclusivamente na pagina Asaas | Free; nenhuma ativacao; nao presumir cancelamento da reserva | Sem confirmado; pode nao existir pagamento persistido | Nenhuma G autorizada | PAYMENT_CREDIT_CARD_CAPTURE_REFUSED se o fluxo emitir; CHECKOUT_CREATED sozinho nao comprova recusa financeira |
| 2 Checkout expirado | Free, checkout aberto sem pagamento | Aguardar expiracao efetiva; consultar estado, sem alterar minutos no banco | Reserva expired; acesso Free | Sem pagamento confirmado novo | Nenhuma nova G | CHECKOUT_EXPIRED; expiredUrl nao substitui evento/estado |
| 3 Vencido | Cobranca pendente, nunca paga; ou renovacao pendente com ciclo anterior pago | Aguardar vencimento real/procedimento documentado do Sandbox | Primeira cobranca continua Free; renovacao pode ficar past_due, preservando periodo anterior ate U | Pendente/vencido, sem confirmado nessa cobranca | Sem nova G; anterior permanece ate seu fim | PAYMENT_OVERDUE |
| 4 Confirmado apos atraso | Cobranca vencida e correlacionada | Aprovar a MESMA cobranca no Sandbox por procedimento autorizado | P somente enquanto periodo original permitir; nao dar mes novo a ciclo encerrado | Confirmado para o pagamento original | Uma G com franquia contratada e ciclo original; consumo so em [inicio,fim) | PAYMENT_CONFIRMED verificado; RECEIVED isolado nao ativa |
| 5 Estorno | Pagamento confirmado, G autorizada; variante com renovacao futura tambem paga | Estornar somente o pagamento previamente aprovado para este teste | Sem outro periodo pago, Free e recorrencia review ou canceled se ja encerrada; se estornar futuro, manter P atual e reduzir validade | Pagamento alvo estornado, outros intactos | Revogar so G alvo, revisao +1, sem reativacao por entrega antiga | PAYMENT_REFUNDED; acompanhar etapas intermediarias sem chama-las de conclusao |
| 6 Chargeback | Pagamento confirmado selecionado para disputa de teste | Procedimento com Asaas aprovado pelo usuario | Acesso reconciliado pelos demais periodos pagos; nao reativar cobranca disputada | Chargeback registrado para alvo | G alvo REVOKED terminal; demais periodos preservados | PAYMENT_CHARGEBACK_REQUESTED suportado; conferir fluxo real emitido |
| 7 Cancelamento | Recorrencia P com periodo ja pago | Cancelar somente recorrencia dedicada aprovada, sem estornar pagamento | Recorrencia canceled; P preservado ate U; confirmacao atrasada nao reinicia recorrencia | Pagamento anterior continua confirmado | G paga preservada, sem renovacao automatica por cancelamento | SUBSCRIPTION_DELETED/INACTIVATED conforme acao real |
| 8 Duplicado | Um evento realmente entregue e processado | Reentregar explicitamente o MESMO evento aprovado | Plano, U, assinatura e estado financeiro inalterados | Um pagamento por identidade | Mesma G/revisao/outbox; sem saldo novo | Mesmo ID novamente; SQL tambem cobre outro ID para mesmo pagamento |
| 9 Fora de ordem | Entidades ja correlacionadas e periodo pago | Local: permutar confirmacao/cancelamento/expiracao/overdue/revogacao | Cancelamento nao desaparece; expiracao/overdue antigos nao desfazem confirmado | Financeiro terminal nao regride por evento antigo | Periodos por pagamento; revisao antiga nao reativa | Apenas reentregas reais do painel contam como gateway; JSON local nao e evento do Asaas |
| 10 Falha temporaria | Evento valido, sem sucesso conclusivo ainda | Local: falha de verificacao/RPC/outbox; remoto exige plano isolado aprovado | Nao conceder acesso por ACK falso; conservar eventos e estado previo | Rollback completo se RPC falhar; estado incerto exige consulta antes de nova acao | Sem concessao parcial; pending/retry recuperavel | HTTP 503, depois reentrega do MESMO evento; 200 somente apos processamento/duplicidade valida |

## Matriz de evidencia e viabilidade

E0: baseline sanitizado com horario Brasilia, ambiente, plano efetivo, pagamentos,
assinaturas, U, G/revisoes/outbox, sem copiar PII/secrets. E1: resultado no provedor
e consulta do MESMO recurso. E2: evento do gateway, horario, entrega HTTP e estado
local correlacionado. E3: comparacao depois da repeticao, sem duplicacao ou aumento
indevido de validade/franquia. IDs necessarios a correlacao ficam em evidencia
restrita, nao neste documento publico. Estado da projecao e estado da G devem ser
conferidos separadamente; pending da entrega nao significa saldo consumivel.

| # | Local atual | Sandbox real historico | Evidencia necessaria para concluir gateway | Possibilidade segura / autorizacao |
|---|---|---|---|---|
| 1 | SQL e handler mock PASS | PARCIAL em 19/10 | E0/E1 e E2 se houve evento; se nao houve pagamento, comprovar ausencia de confirmado/G, sem inventar webhook | Sim, uma tentativa em checkout QA. Criacao/uso de checkout exige aprovacao especifica |
| 2 | SQL e mock PASS | PENDENTE | E0/E1/E2, reserva realmente expired e Free | Sim, preferir recurso existente sem pagamento; criar no maximo um se aprovado. Expiracao automatica nao precisa ser forcada |
| 3 | SQL e mock PASS | PENDENTE | E0/E1/E2 com cobranca CREDIT_CARD recorrente correta | Condicionado a pendencia real/vencimento e procedimento suportado. Nao substituir por boleto/dinheiro nem forjar datas no banco |
| 4 | SQL PASS, incluindo ciclo encerrado | PENDENTE | E0/E1/E2, mesmo pagamento e periodo; sem segunda cobranca | Condicionado ao cenario 3 e aprovacao de pagamento FICTICIO no Sandbox; nao usar confirmacao em dinheiro |
| 5 | SQL e mock PASS, correcao local abaixo | PENDENTE | E0/E1/E2/E3 para ultimo periodo, periodo antigo e renovacao antecipada | Sandbox suporta estorno; exige aprovacao especifica do recurso e efeito; nao tocar baseline Pro/Business sem aprovacao |
| 6 | SQL e mock PASS | PENDENTE | E0/E1/E2/E3 e procedimento confirmado pelo provedor | Restrito: documentacao pede solicitacao ao Asaas; nao existe simulacao automatica comprovada aqui. Nao contatar suporte sem autorizacao |
| 7 | SQL e mock PASS, correcao local abaixo | PENDENTE | E0/E1/E2/E3, recorrencia encerrada e periodo pago preservado | Sandbox suporta remocao de assinatura; exige aprovacao especifica. Nao excluir historico local |
| 8 | SQL e mock PASS | PASS registrado 08 e 13/10 | Historico comprova versao anterior; repetir contrato novo somente apos schema/revisao autorizados | Reenvio altera entrega/processamento e exige aprovacao do evento; nunca repetir pagamento |
| 9 | SQL e mock PASS | PENDENTE como conjunto | E0/E2/E3, cronologia e atual estado consultado; nenhuma reativacao por revisao antiga | Apenas eventos existentes e reenvio aprovado. Se painel nao permitir ordem, registrar limitacao; nao fabricar evento do provedor |
| 10 | SQL e mock PASS | Recuperacao real do 503 registrada 08/10 | E0/E2/E3, falha e recuperacao do mesmo evento, distinguindo auditoria e outbox | Sem degradar Preview compartilhado. Defeito induzido remoto/retentativa/backoff exigem plano e aprovacao separados |

## Defeitos demonstrados e correcoes locais

Reproducao ANTES: a suite nova falhou nos dois bancos em memoria com tres
assercoes: `05 estorno futuro preserva Pro e fim do periodo atual`, `05 paid_until
recalculado sem periodo estornado`, `09 confirmacao apos cancelamento nao reativa
recorrencia`. A suite anterior 157/157 e 143 verificacoes financeiras por ambiente
passava: eram lacunas de cobertura, nao regressao provocada pelos novos testes.

**D1 — estorno de renovacao antecipada retirava periodo atual pago.** A RPC
comparava somente `s.paid_until` com o fim do pagamento estornado; se fosse o maior,
derrubava o plano inteiro. Correcao: recalcular maximo dos fins dos pagamentos
confirmados nao estornados da mesma assinatura e atualizar a projecao vinculada.
Sem outro periodo pago, retirar acesso; com periodo atual pago, manter P/U correto.
Concessoes manuais e de outra assinatura permanecem protegidas pelo vinculo/origem.

**D2 — confirmacao atrasada reativava recorrencia cancelada.** A confirmacao
escrevia `status_local=active` incondicionalmente. Correcao: preservar canceled,
continuando a reconhecer o dinheiro/periodo efetivamente pago, sem reiniciar a
recorrencia. SQL cobre tambem Business sem projetar Pro por engano.

**Idempotencia complementar de D1:** o mesmo estorno com outro ID de evento
deixa de reescrever projecao/assinatura. Triggers descartaveis contam UPDATEs
para demonstrar ausencia de efeitos, sem depender de timestamps identicos.

Mudanca funcional restrita a `billing_processar_webhook_v1` na migration base
`supabase/asaas_assinaturas_v1.sql`. Nao foi alterado o contrato publicado:
`billing_concessoes_v1.sql`, tipo, envelope, revisoes, guard e recuperador intactos.
Nao foram alterados handler HTTP, checkout, canario, pricing, RLS ou arquivos IA.
Nada corrige retroativamente o remoto: essas correcoes ainda nao foram aplicadas.

## Execucao atual e limites

- 170/170 testes JavaScript PASS (13 testes novos de handler com dependencias
  substituidas). Request/Response executam o handler local; nao ha entrega real
  HTTP do Asaas nesses testes. Nao ha request financeiro externo assinado/forjado.
- 56 verificacoes SQL negativas PASS por ambiente simulado, mais 143 do contrato
  financeiro e suites existentes de billing/ambientes. PGlite e efemero, sem URL
  ou credencial; cada roteiro termina em ROLLBACK. Production no runner significa
  somente segundo banco EM MEMORIA para garantir isolamento de ambiente.
- Lint, TypeScript (`npx tsc --noEmit`), geradores Unicode/paridade em `--check`,
  `git diff --check` e build PASS. Build avisou ausencia de OpenAI/e-mail locais;
  nenhum servico externo de IA/notificacao foi acionado. Whitespace dos arquivos
  novos tambem conferido; .env.local permanece ignorado.
- Falha temporaria de outbox desfaz confirmacao/G e deixa evento error para retry;
  reexecucao LOCAL explicita do mesmo ID recupera uma G. A recuperacao de entregas
  ja confirmadas sem webhook tambem continua coberta pela suite financeira.
- Falha na consulta/verificacao Asaas ocorre ANTES da persistencia SQL do evento:
  o handler retorna 503 e depende da fila do provedor. Isto e limite arquitetural
  ja existente; a outbox financeira nao substitui a fila de entrada do webhook.
  Nao remover backoff automaticamente nem tratar timeout como autorizacao para
  criar outro checkout/pagamento. Conferir fila pausada e retencao de logs/eventos.
- Confirmacao antiga quando GET atual retorna REFUNDED e negada com 503, sem
  ativar. Reprocessamento automatico infinito nao foi implantado; exige conciliacao
  operacional do evento terminal, nunca editar manualmente para processed.

## Roteiro manual e aprovacoes futuras

1. Revisar esta etapa e autorizar separadamente SQL em HOMOLOGACAO, quando
   desejado. Commit/push dos ajustes foram autorizados em 24/10; migration nao.
   Ordem futura continua base Asaas atualizada, concessoes, consumidor Linux
   revisado. Fazer snapshot/auditoria, sem backfill ou limpeza ampla.
2. Disponibilizar acesso Sandbox e homologacao pelo gerenciador/painel seguro,
   nunca enviar chaves/senhas neste chat. Conferir ambiente real, URLs, versao do
   deployment e do schema antes de marcar PASS de G/outbox.
3. Selecionar uma conta QA dedicada e inventariar checkouts/assinaturas existentes
   em leitura. Nao selecionar por e-mail aproximado nem mexer nas contas dos E2Es
   antigos sem aprovacao. Se resultado anterior for incerto, parar e consultar.
4. Para recusa: apos aprovacao de UM checkout especifico, abrir somente no Asaas
   Sandbox, usar cartao de recusa da documentacao oficial, titular ficticio e
   contato proprio/autorizado. Nao salvar numero/CVV em logs ou no Oportuna.
   Registrar mensagem/codigo sanitizado, E1 e Free/G. Se nao existir cobranca,
   nao exigir webhook inexistente: comprovar ausencia de confirmacao e credito.
5. Para expiracao: usar o mesmo checkout se estiver aberto e aplicavel, sem novo
   pagamento, aguardar o prazo configurado e conferir CHECKOUT_EXPIRED/estado.
   Cancelar a jornada no navegador nao prova cancelamento da sessao no Asaas.
6. Vencimento/atraso: aprovar roteiro com cobranca recorrente pendente real,
   vencimento/aniversario coerente e cartao no fluxo suportado. A API de captura
   imediata nao e um agendador de vencimento. Nao inventar endpoint de aceleracao
   do tempo, trocar para dinheiro/boleto ou modificar tabelas para forcar sucesso.
7. Estorno/cancelamento: aprovar individualmente recurso QA, valor, acao e efeito
   esperado, incluindo preservacao dos demais ciclos e da recorrencia quando
   nao for alvo. Aprovacao de um estorno nao autoriza outro ou limpeza da reserva.
8. Chargeback: apos aprovacao, combinar procedimento com o suporte Asaas e
   disponibilizar identificador somente no canal autorizado; nenhum contato foi
   enviado nesta etapa. Se indisponivel, declarar cobertura local e limitacao.
9. Reentrega/fora de ordem/falha: aprovar IDs de eventos existentes e janela
   isolada. Aguardar resultado e consultar antes de repetir. Nao mudar token,
   derrubar endpoint compartilhado, desativar webhook ou remover penalizacao
   para provocar cenario sem aprovacao. Manter registro completo/sanitizado.

## Criterios para canario real controlado

- Defeitos D1/D2 revisados e correcoes homologadas remotamente em etapa autorizada.
- Cenarios pendentes do gateway executados; restricoes do Sandbox explicitamente
  aceitas, especialmente chargeback e cronologia. Sem classificar mock como E2E.
- Contrato financeiro e consumidor/guard/worker Linux integrados, conciliacao do
  legado aprovada, recuperacao e concorrencia de revogacao verificadas. Historico
  e cota existente nunca resetados automaticamente.
- Sem 5xx inexplicado, fila parada, pagamento de resultado desconhecido ou
  divergencia entre financeiro, concessao e plano. Observabilidade e rollback
  preservam recepcao/revogacao, sem apagar dados ou usar paid_until como ciclo.
- Revisar checklist Production e autorizar separadamente schema/credenciais,
  webhook, deployment, canario de UMA conta exclusivamente Pro e uma cobranca
  real de R$99. Canary server-side deve bloquear outras contas e Business.
- Pagamento real, estorno real, merge e ampliacao de acesso continuam proibidos
  sem aprovacao especifica. Esta etapa NAO aprova teste real em producao.

## Referencias oficiais consultadas em 23/10/2026

- [Disponibilidade Sandbox](https://docs.asaas.com/docs/o-que-pode-ser-testado):
  estorno/remocao de assinatura disponiveis; chargeback requer procedimento com
  Asaas. Suporte a um recurso nao prova sua execucao no Oportuna.
- [Cartao de credito](https://docs.asaas.com/docs/cobrancas-via-cartao-de-credito):
  na criacao com captura direta, recusa retorna erro e nao persiste cobranca;
  timeout pede consulta antes de repetir. Nao presumir que todo checkout usa
  exatamente a mesma resposta; verificar o fluxo hospedado utilizado.
- [FAQ Sandbox](https://docs.asaas.com/docs/faq-sandbox): cartoes de teste
  aprovados/recusados e uso de contatos proprios/autorizados.
- [Checkout](https://docs.asaas.com/docs/introdu%C3%A7%C3%A3o-1): retorno do
  navegador nao e confirmacao financeira; tratar eventos e repeticoes.
- [Penalizacao](https://docs.asaas.com/docs/penaliza%C3%A7%C3%A3o-de-filas):
  retentativas progressivas, pausa apos falhas consecutivas e reativacao explicita.
  A documentacao atual aceita 2xx como sucesso (o handler Oportuna usa 200);
  anotacoes historicas de "diferente de 200" nao sao contrato atual do gateway.
