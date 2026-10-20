# Checklist de produção do billing

Preparação técnica somente. Produção NÃO habilitada; não aplicar migration,
configurar secrets, criar cobrança real ou fazer merge nesta etapa.

## Antes da liberação

- [ ] Aprovar preços/franquias produtivos e limite comercial de perfis Business.
  Não anunciar equipes ou Assistente de Participação como disponíveis.
- [ ] Concluir E2E Sandbox: cartão recusado, vencimento, estorno, chargeback e
  cancelamento real da recorrência. Reenvios não estendem período duas vezes;
  preservar períodos pagos, auditoria e concessões manuais conforme política.
- [ ] Revisar operação do webhook síncrono, timeouts, fila pausada, reentrega e
  conciliação. A documentação Asaas recomenda persistência durável e processamento
  posterior; não considerar a entrega positiva Sandbox como prova de resiliência.
- [ ] Registrar versão de rollback compatível com schema e receptor de eventos.

## Banco — somente após autorização futura

- [ ] Conferir projeto Supabase de produção, dependências de
  `planos_e_permissoes_v1.sql`, backup e permissões/RLS.
- [ ] Revisar/aplicar manualmente `supabase/asaas_assinaturas_v1.sql`, já
  validada em homologação. Nenhum build ou teste executa SQL remotamente.
- [ ] Antes de qualquer registro de billing, administrador define exclusivamente
  nesse banco `billing_configuracao.ambiente=production`. Não há troca após
  existir histórico; nunca converter o projeto de homologação para produção.
- [ ] Conferir helpers de ambiente/gateway, grants, triggers, projeção de plano
  e assinaturas anteriores. Auditar estado antes/depois, sem limpar histórico.

## Variáveis — somente no ambiente Production

| Variável | Conferência |
|---|---|
| `ASAAS_ENVIRONMENT` | `production`, sem inferência ou fallback |
| `ASAAS_PRODUCTION_ENABLED` | Manter `false` até autorização da liberação; `true` é condição adicional |
| `ASAAS_PRODUCTION_SUPABASE_URL` | URL HTTPS exata do projeto produtivo aprovado; diferente da homologação |
| `BILLING_CANARY_ENABLED` | Somente `true` permite o canário; `false`, ausente ou inválido bloqueia todos os novos checkouts produtivos |
| `BILLING_CANARY_USER_ID` | UUID único de `auth.users` da conta controlada; somente servidor, sem prefixo `NEXT_PUBLIC_`, sem lista ou fallback |
| `NEXT_PUBLIC_SUPABASE_URL` | Igual à URL produtiva fixada acima |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Chave pública do mesmo projeto |
| `SUPABASE_SECRET_KEY` | Secret do mesmo projeto, somente no servidor |
| `ASAAS_API_KEY` | Chave própria de produção, prefixo `$aact_prod_`; nunca reutilizar Sandbox |
| `ASAAS_WEBHOOK_TOKEN` | Token exclusivo, 32–255 caracteres, sem espaços; diferente da API key e bypass |
| `PRO_MONTHLY_PRICE` | `99.00` (R$ 99 por mês), definido no servidor |
| `BUSINESS_MONTHLY_PRICE` | `197.00` (R$ 197 por mês), definido no servidor |
| `PRO_MONTHLY_AI_LIMIT` | `200` análises por mês |
| `BUSINESS_MONTHLY_AI_LIMIT` | `1000` análises por mês |
| `APP_BASE_URL` | Origin HTTPS oficial, sem caminho, query, fragmento ou Preview |

API produtiva fixa: `https://api.asaas.com/v3`. Host do checkout permitido:
`asaas.com`, HTTPS, sem porta alternativa ou credenciais na URL. Preview não
pode usar production. Nenhum secret recebe prefixo `NEXT_PUBLIC_`.

## Webhook e teste controlado — autorização específica necessária

- [ ] Cadastrar webhook na conta Asaas produtiva para
  `https://<dominio-oficial>/api/webhooks/asaas`, com token acima e eventos
  suportados pelo handler. Manter configuração Sandbox separada.
- [ ] Validar chamada externa sem sessão/cookies/login Vercel, preservando
  autenticação da aplicação; não copiar bypass Preview para produção.
- [ ] Token ausente/inválido deve retornar 401 sem persistir/processar evento.
- [ ] Confirmar correlação, preço, plano, ambiente, idempotência e persistência.
  successUrl, CHECKOUT_PAID e SUBSCRIPTION_CREATED não concedem acesso.
- [ ] Executar teste real com conta, plano, valor e recorrência autorizados.
  Confirmar PAYMENT_CONFIRMED, HTTP 200, billing_payment/subscription,
  assinaturas_usuario, franquia, paid_until e aplicação.
- [ ] Definir previamente cancelamento da recorrência de teste e eventual
  estorno autorizado. Nunca usar cartão fictício em produção.

### Eventos a conferir no webhook

Habilitar exatamente os 16 eventos aceitos pelo handler atual, sem substituir
confirmação financeira por callback ou evento de criação:

```text
CHECKOUT_CREATED
CHECKOUT_CANCELED
CHECKOUT_EXPIRED
CHECKOUT_PAID
SUBSCRIPTION_CREATED
SUBSCRIPTION_UPDATED
SUBSCRIPTION_INACTIVATED
SUBSCRIPTION_DELETED
PAYMENT_CREATED
PAYMENT_UPDATED
PAYMENT_CONFIRMED
PAYMENT_RECEIVED
PAYMENT_OVERDUE
PAYMENT_CREDIT_CARD_CAPTURE_REFUSED
PAYMENT_REFUNDED
PAYMENT_CHARGEBACK_REQUESTED
```

## Canário Pro — plano de execução, não executado

Estado desta revisão: projeto Supabase produtivo, domínio oficial, credenciais,
configuração remota e migration produtiva **não foram verificados nem alterados**.
Os exemplos acima não confirmam que tais configurações já existam em produção.

**Contenção server-side implementada localmente, ainda não publicada/configurada
em produção:** além da trava global `ASAAS_PRODUCTION_ENABLED`, novos checkouts
produtivos exigem `BILLING_CANARY_ENABLED=true`, UUID válido em
`BILLING_CANARY_USER_ID`, identidade autenticada exatamente correspondente e
plano Pro. A rota POST e o serviço de criação/reuso verificam a trava antes
de qualquer alteração de cliente, reserva ou chamada externa. Business e outras
contas recebem bloqueio controlado HTTP 403, com mensagem de liberação gradual.
Flags ausentes/desligadas ou UUID inválido bloqueiam todos os novos checkouts;
desligar o canário não significa abrir ao público. Sandbox permanece inalterado.

A página de planos calcula a elegibilidade no servidor e passa apenas booleanos
à apresentação, sem expor o ID configurado. Query/body e metadata não liberam
acesso; ocultar botão não é a proteção da API. Webhook, regras financeiras,
entitlements e concessões existentes não dependem da trava de canário. A
homologação produtiva e o canário real continuam aguardando autorização.

1. Autorizar separadamente migration/configuração/deployment e a operação
   financeira. Identificar uma única conta Free de produção autorizada, sem
   registrar e-mail, documento ou credenciais neste documento. Registrar o estado
   inicial do plano e as contagens de billing em evidência restrita.
2. Após backup e conferência das dependências, aplicar e validar a migration
   aprovada; definir o ambiente do banco como `production` antes do primeiro
   registro de billing. Preservar concessões manuais e dados preexistentes.
   Não aplicar automaticamente os SQLs de otimização do dashboard/RLS: são
   alterações separadas, ainda com investigação de latência fria aberta.
3. Configurar somente o ambiente Production autorizado e conferir a identidade
   do Supabase, domínio HTTPS e webhook. Validar token inválido/ausente (401),
   ambiente cruzado e host malicioso rejeitados antes de criar cobrança real.
   Conferir também que uma segunda conta não consegue criar checkout.
4. Pela conta controlada, abrir `/planos`, confirmar Pro R$ 99/mês e 200 IA/mês,
   preencher dados autorizados do pagador no modal e criar **um** checkout Pro.
   Registrar de forma restrita a correlação cliente/reserva/checkout. Não
   iniciar Business, outra assinatura concorrente ou nova tentativa automática.
5. O titular autorizado conclui **um pagamento real de R$ 99** no checkout
   oficial HTTPS `asaas.com`, caminho `/checkoutSession/`. O Oportuna não recebe
   número de cartão ou CVV. Não realizar essa ação sem autorização financeira
   explícita, incluindo o caráter recorrente e a política de encerramento do teste.
6. Antes do webhook, confirmar que visitar `successUrl` isoladamente não altera
   Free. Após `PAYMENT_CONFIRMED`, conferir entrega HTTP 200, evento processado,
   pagamento confirmado, assinatura Pro, `assinaturas_usuario=PRO`, franquia
   200 e `paid_until` futuro. Comparar o período com o pagamento correlacionado,
   sem presumir uma data fixa. Se o webhook chegar antes do retorno, usar a
   evidência automatizada/SQL já existente para a propriedade da successUrl e
   registrar a ordem real; não atrasar artificialmente eventos produtivos.
7. Conferir `/planos`, entitlements e logs sanitizados; reentregar o **mesmo**
   evento, quando autorizado, e comparar `paid_until`, contagens de pagamento,
   assinatura e concessão antes/depois. Não criar nova cobrança para testar
   idempotência; não reexecutar um consumo real de IA apenas para conferir cota.
8. Encerrar a observação com relatório e decisão explícita. Cancelar recorrência
   e/ou estornar somente conforme autorização financeira própria. Continuar
   bloqueando novas contratações para demais usuários; nenhuma expansão automática.

Parar o canário em caso de preço/plano incorreto, assinatura duplicada,
correlação divergente, HTTP 5xx ou evento pendente/error sem resolução. Não
limpar reservas, marcar evento como processado ou repetir pagamento para
contornar falha. Preservar histórico e manter recepção/reconciliação dos eventos.

### Pendências conhecidas antes da autorização

- Recusa Sandbox: mensagem visual de não autorizado e retorno Free; somente
  `CHECKOUT_CREATED`/HTTP 200 comprovado. Sem evento financeiro da recusa ou
  conferência final de pagamentos/reserva; cenário ainda parcial.
- Vencimento, estorno, chargeback e cancelamento da recorrência: E2E completo
  ainda pendente. Testes locais/SQL não equivalem a execução financeira no provedor.
- Dashboard: RPC rápida em chamadas aquecidas, mas primeiras chamadas após pausa
  chegaram a 6,3–6,6 s no teste discriminatório; há HTTP 500/SQLSTATE 57014 anterior.
  A causa interna da latência fria permanece aberta, sem novo SQL ou timeout.
- Restrição server-side canário implementada/testada localmente; ainda faltam
  revisão e publicação autorizada, configuração da conta real e validação no
  ambiente produtivo antes de qualquer cobrança.
- Limite comercial de perfis Business continua pendente; não impede planejar
  o canário exclusivamente Pro, mas impede anunciar um número não definido.

Exigem autorização explícita futura: aplicar SQL ou alterar configuração no
Supabase produtivo, inserir credenciais reais, cadastrar/alterar webhook real,
publicar/habilitar billing em produção, criar cobrança/recorrência e pagar
R$ 99, reentregar evento produtivo, cancelar/estornar e ampliar o acesso.
Merge também depende de autorização separada; este checklist não a concede.

## Logs e rollback

- [ ] Conferir logs Vercel/Asaas, códigos HTTP, latência, tentativas, fila
  penalizada e eventos pending/error. Alertar divergências e definir responsável.
- [ ] Logs sanitizados: sem token, documento, telefone, endereço, cartão ou
  payload financeiro completo. Segredos não são commitados nem enviados no chat.
- [ ] Bloquear novas contratações em caso de falha, mantendo receptor de eventos
  e conciliação compatíveis. Não trocar banco/ambiente para contornar erros.
- [ ] Para suspender novos checkouts produtivos, desligar
  `BILLING_CANARY_ENABLED`, mantendo a configuração global e o webhook ativos.
  A mudança de variável precisa chegar ao deployment; validar o bloqueio por
  POST direto após publicá-la. Isso bloqueia criação/reuso pelo Oportuna, mas
  não invalida links já emitidos nem cancela cobranças/recorrências no Asaas.
- [ ] A trava `ASAAS_PRODUCTION_ENABLED` é global, incluindo webhook: não a
  usar como único rollback depois de existirem cobranças. Bloquear novas
  contratações com uma versão compatível ou regra específica para checkout,
  preservando a recepção dos eventos das recorrências existentes.
- [ ] Reverter somente para versão compatível; não apagar tabelas de billing
  nem restaurar snapshot que descarte eventos/pagamentos já confirmados.
- [ ] Reverter deployment NÃO cancela recorrência/cobrança no Asaas. Qualquer
  ação financeira externa requer tratamento próprio e autorização.

Referências oficiais:
- https://docs.asaas.com/reference/comece-por-aqui
- https://docs.asaas.com/docs/link-do-checkout-e-redirecionamento-do-cliente
- https://docs.asaas.com/docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook
