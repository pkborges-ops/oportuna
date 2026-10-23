# Etapa 2.1 — integração IA com concessões financeiras

Implementação local em `feat/analise-ia-v1`. Contrato inspecionado no commit
`183e62e56c65390111744e8e8ce2249cb5cb7949`:
[docs/BILLING_CONCESSOES.md](https://github.com/pkborges-ops/oportuna/blob/183e62e56c65390111744e8e8ce2249cb5cb7949/docs/BILLING_CONCESSOES.md).

Nenhuma migration financeira foi copiada para esta branch. Para testes, arquivos
originais foram baixados em /tmp; o runner verifica seus SHA-256. Nenhuma migration
remota, chamada OpenAI, cobrança, commit, push ou merge foi executado.

Este documento substitui as propostas de integração financeira da Etapa 1 e as
pendências de contrato citadas na Etapa 2. Não altera o contrato de conteúdo v2.

## Arquivos desta etapa

Criados:
- supabase/analises_ia_billing_adapter_v1.sql
- tests/sql/analises-ia-billing-adapter.sql
- tests/sql/ia-billing-bootstrap-local.sql
- tests/sql/ia-billing-legado-local.sql
- tests/sql/run-ia-billing-local.py
- docs/IA_BILLING_ADAPTER_V1.md

Alterados:
- app/(painel)/oportunidades/actions.ts: reserva pelo cliente com JWT do usuário.
- tests/helpers/matching-doubles.mjs: identifica cliente autenticado/administrativo.
- tests/helpers/matching-integracao.mjs: verifica a separação dos clientes.

As migrations antigas de IA, código de geração, conteúdo v2, matching, billing,
Asaas, dashboard e PNCP não foram alterados nesta etapa. O workspace mantém as
alterações não commitadas das etapas anteriores.

## Contrato implementado

`public.ia_receber_concessao_financeira_v1(jsonb) RETURNS boolean`, SECURITY DEFINER,
search_path=pg_catalog, owner igual ao entregador financeiro. EXECUTE revogado de
PUBLIC, anon, authenticated e service_role. O entregador financeiro chama como
owner; service_role só solicita reserva/entrega pelo outbox oficial.

A migration exige billing e IA v1/v2 instalados e o mesmo owner. Dependência ou
owner incompatível interrompem a instalação dentro da transação.

O hook:
1. Valida versão 1 e revisão inteira positiva.
2. Obtém lock de ambiente 7105 compartilhado e confere ambiente instalado.
3. Lê a concessão financeira com FOR SHARE, antes de qualquer lock de saldo.
4. Compara o envelope canônico: identidade, usuário, assinatura, pagamento, origem,
   plano, franquia e limites explícitos. Propriedades extras também são rejeitadas.
   Datas equivalentes como timestamptz são aceitas.
5. Confere estado/revisão no registro financeiro de revisões.
6. Obtém o advisory lock 7101 por usuário e aplica a projeção IA.

Não lê catálogo vigente, paid_until, data de recebimento ou mês atual para
determinar direitos. Não trava assinatura ou pagamento a partir da IA, não consulta
Asaas e não recalcula calendário financeiro.

`ia_concessoes_financeiras_v1` guarda o envelope normalizado, maior revisão
recebida e vínculo único com o ciclo. Identidade de saldo é concessao_id:
periodo_ref recebe esse UUID, e ciclo_id é uma associação única, estável.
Revisão não cria outra identidade. ADMIN preserva assinatura/pagamento nulos.

| Evento | Efeito |
| --- | --- |
| AUTHORIZED | Cria um ciclo com termos canônicos; datas continuam sendo o filtro de consumo |
| AUTHORIZED futuro | Registrado, indisponível antes de início |
| AUTHORIZED encerrado | Registrado com fim original; nunca reabre período |
| REVIEW | Projeção sem ciclo/sem crédito |
| REVOKED antes de AUTHORIZED | Tombstone sem ciclo/sem crédito |
| REVOKED após AUTHORIZED | Atualiza revisão e revoga o ciclo original sem apagar uso |
| Mesma revisão | ACK sem novo saldo nem reset |
| Revisão menor | Não altera projeção nem reativa ciclo |
| Entrega obsoleta sem projeção | Não cria saldo; o outbox oficial a trata como superseded |
| Termos divergentes | Erro; transação de entrega não confirma e desfaz efeitos parciais |

Os termos locais são comparados novamente em cada entrega. REVIEW não é promovido
para AUTHORIZED. Mudança de plano não reescreve franquia já concedida. Um contrato
separado e autorizado pode conceder novo período, sem transferir consumo.

Sobreposição com ciclo pago antigo da IA, ainda sem vínculo financeiro, falha
fechada e exige conciliação: não inventamos correspondência nem crédito retroativo.
As antigas RPCs ia_autorizar_ciclo_v1/ia_revogar_ciclo_v1 deixam de ser executáveis
pelo serviço e passam a recusar chamadas, inclusive do owner. A autoridade de
concessão e revogação é exclusivamente financeira.

## Guard, identidade e locks

A action obtém getUser e usa:
- cliente Supabase autenticado para ia_reservar_v1;
- cliente administrativo para início, finalização e registro de falha.

A assinatura da reserva permanece compatível, mas p_usuario precisa coincidir
com auth.uid(), que é a identidade efetiva. Sem JWT, usuário diferente ou perfil
alheio: 42501. Apenas authenticated tem EXECUTE na reserva. O cliente recebe
somente código/ID da execução, nunca o token. Hash/snapshot não concedem direitos;
propriedade do perfil, acesso à oportunidade e saldo são verificados no banco.

Antes de reservar saldo pago, ia_ciclo_guardado_v1 chama
`billing_concessao_autorizada_v1(ambiente,usuario,concessao,revisao)` na própria
transação SQL da reserva. Sem autorização financeira, sem nova reserva.

Ordem:
1. Seleção preliminar da projeção IA, sem lock de saldo.
2. Guard financeiro: ambiente 7105 e origem com FOR SHARE.
3. Advisory lock IA 7101 por usuário.
4. Revalidação do ciclo selecionado, recuperação de estados e contagem de saldo.
5. Reserva/consumo, mantendo lock financeiro até commit.

A contagem de saldo não chama outro guard depois de obter 7101. Se outro ciclo
passar a ser atual enquanto a operação espera, a operação nega e permite que uma
nova requisição reavalie; não adquire lock financeiro em ordem inversa.

Início e finalização também usam guard sobre o ciclo ORIGINAL da execução.
Revogação financeira bloqueia mesmo antes da entrega da projeção:
- Pending ainda não iniciado: início negado, estado failed.
- Processing/uncertain: não finaliza nem cobra outro ciclo; conserva uncertain.
- Completed: permanece concluído; repetição com token correto devolve conclusão,
  mesmo após revogação, sem novo consumo.

Expiração e reconciliação seguem a Etapa 1. Uma execução que atravessou o fim do
período não cobra a renovação. Resultado v2 e consumo continuam atômicos.

O cancelamento da recorrência não revoga concessão paga. Para escolher franquia
paga, não exigimos coincidência com a assinatura atualmente projetada: isso
preserva períodos já pagos e permite concessões ADMIN, que não alteram a projeção.
As regras existentes de visibilidade das oportunidades continuam valendo.

Free mantém um único ciclo vitalício e o backfill de demonstração usada. Não é
fallback para erro de guard, período financeiro atual em REVIEW/REVOKED ou saldo
pago legado ainda vigente. Após o fim dos períodos e sem plano pago vigente,
a demonstração original pode continuar disponível somente se nunca foi usada.
Entrega de revisão não renova demonstração.

## Ordem exata de instalação futura

Não executada remotamente. Não repetir migrations não idempotentes em banco que
já as possui. Inventariar o schema e drenar/conciliar execuções pagas antigas
antes da troca.

Pré-requisitos comuns, na ordem usada no banco descartável:
1. perfis_empresa.sql
2. oportunidades_editais.sql
3. participacao_oportunidades.sql
4. oportunidades_origem_tipo.sql
5. analises_oportunidades.sql
6. alertas_email.sql
7. oportunidades_paginadas_v1.sql
8. oportunidades_ciclo_vida_v1.sql
9. planos_e_permissoes_v1.sql

Com a base instalada:
1. **Frente financeira:** asaas_assinaturas_v1.sql do commit publicado.
2. **Frente financeira:** billing_concessoes_v1.sql do mesmo commit.
3. **Frente IA:** analises_ia_execucoes_v1.sql, se ainda não instalada.
4. **Frente IA:** analises_ia_conteudo_v2.sql, se ainda não instalada.
5. **Frente IA:** analises_ia_billing_adapter_v1.sql, com mesmo owner das funções.
6. Publicar conjuntamente a action que reserva com JWT. A versão anterior, que
   reserva com service_role, falhará fechada após a troca dos privilégios.
7. Acionar o worker autorizado de recuperação e conferir projeção/ACK/saldo.

O runner testa a ausência de billing em outro banco e confirma que nenhuma tabela
do adaptador é criada parcialmente. A integração principal segue a ordem acima.
Migrations financeiras permanecem sob instalação e revisão da frente Windows.

Não reaplicar isoladamente funções antigas de IA depois do adaptador: elas
removeriam o guard. Rollback operacional deve suspender novas gerações e manter
versões compatíveis, revisões, outbox, histórico e o guard; não apagar tabelas.

## Testes e resultados

Execução:
`python3 tests/sql/run-ia-billing-local.py /tmp/oportuna-finance-183e62e`

O diretório externo deve conter as três migrations cujos hashes estão fixados
no runner. Não aceita URL de banco nem credencial remota. Inicializa PostgreSQL
16 UTF-8, owner postgres, socket Unix, sem TCP; remove o cluster ao terminar.

Resultado final: **51 verificações/cenários PASS**. Incluem:
- migrations reais de planos, billing e IA; sem dublê do hook ou guard;
- primeira confirmação pela RPC financeira real e entrega pelo outbox;
- renovação, reentrega, maior revisão e revogação antes de autorização;
- REVIEW, antecipação, período encerrado e saldo esgotado;
- usuário/assinatura/ambiente/origem/plano/franquia/datas adulterados;
- cancelamento e downgrade por contrato separado, sem transferência;
- ADMIN sem assinatura fictícia;
- roles reais authenticated/service_role, grants e tabelas privadas;
- JWT ausente, outro usuário/perfil, início não exposto ao cliente;
- histórico v1, conteúdo v2, reservas/consumos anteriores intactos;
- ausência de billing e sobreposição com saldo legado;
- falha intermediária com rollback do ciclo e ACK, recuperada sem webhook novo;
- reserva antes/depois de revogação, com espera de lock observada;
- conclusão antes/depois de revogação, com espera de lock observada;
- duas reservas concorrentes para a última unidade;
- virada temporal real sem transferência para o novo ciclo.

Somente o schema Auth/JWT é emulado no bootstrap. Eventos são fixtures locais
entregues ao SQL financeiro: não exercitam HTTP, validação do token Asaas ou
consulta de pagamento externo. A homologação Supabase/Asaas continua necessária.

Aplicação: **110 testes aprovados**, incluindo assertions da action com clientes
separados. lint, TypeScript e git diff --check passaram. Build passou com URL
Supabase localhost e chave pública fictícia, sem OPENAI_API_KEY. Esse build não
comprova acesso real ao Supabase.

## Worker, riscos restantes e homologação conjunta

O ponto `recuperarEntregasFinanceiras()` já existe no commit financeiro, em
lib/billing/entregas-financeiras.ts. Não foi duplicado nesta branch nem foi criado
cron/rota. Ele depende de ASAAS_ENVIRONMENT compatível com o banco e cliente
administrativo; usa somente reservar_entregas/entregar. Deve ser ligado a um
worker autorizado pela frente responsável após a instalação conjunta.

O lease de 60s, prioridade de revogação, nova tentativa após um minuto e ACK
atômico pertencem ao billing. A IA retorna true somente após aplicar/validar sua
projeção. Falta de worker impede novos créditos de chegarem; o guard continua
bloqueando revogações mesmo com a projeção atrasada. Monitorar idade do outbox,
retry/SQLSTATE, REVIEW, sobreposição e execuções uncertain.

Riscos/limitações restantes:
- Conciliação de saldos pagos antigos sem identidade financeira continua manual,
  sem reset ou remapeamento automático.
- Compatibilidade de owner/privileges/JWT e latência de locks precisa ser
  confirmada no Supabase de homologação.
- Se o provedor já foi chamado quando a concessão é revogada ou expira, pode
  existir custo do provedor sem análise entregue; a execução não migra cobrança
  para outro ciclo e exige reconciliação operacional.
- Owner administrativo é fronteira confiável: pode administrar o banco. Roles
  da aplicação não possuem poderes de concessão.
- Avaliação real de qualidade/custo OpenAI permanece fora desta etapa.

Critérios de aceite para homologação conjunta:
1. Conferir commit financeiro, owner e grants; instalar na ordem documentada.
2. Confirmar pagamento de teste pela frente financeira, recuperar o outbox e
   observar exatamente um ciclo com a franquia e datas originais.
3. Reentregar evento/entrega e comprovar que saldo/consumo não reiniciam.
4. Revogar e atrasar o worker deliberadamente: reserva e conclusão pagas devem
   ser negadas pelo guard; histórico já concluído permanece íntegro.
5. Repetir concorrência e fronteira temporal em sessões reais de homologação.
6. Validar JWT real: reserva do usuário, recusa de outro usuário e isolamento
   financeiro; início/token/finalização inacessíveis ao browser.
7. Validar Free, Pro e Business, período futuro/encerrado, ADMIN, REVIEW,
   cancelamento e contrato separado de downgrade.
8. Interromper worker durante entrega e recuperar pelo lease sem crédito duplo.
9. Conciliar qualquer saldo legado antes de liberar consumo pago; nenhum caso
   pendente pode receber nova franquia por inferência.
10. Revisar operação/monitoramento/rollback conjuntamente antes de produção.
