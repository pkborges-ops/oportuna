# Etapa 3 — interface comercial da análise com IA

Implementação local na branch feat/analise-ia-v1, sobre o commit
7d4a21df80eb53631dbe6d7dbf7f76f8a38c43ea. A implementação inicial foi entregue
sem commit/push. A revisão posterior autorizou publicar exclusivamente nesta
branch. Sem merge, produção, ativação de worker, migrations remotas, pagamentos
ou chamadas OpenAI.

## Experiência

A seção existente da página de detalhes passa a se chamar “Análise comercial com IA”.
Não há nova página, chat, dependência de pacote ou execução automática.

Wireframe implementado:

```text
Análise comercial com IA
Descrição breve + limite da avaliação (sem edital completo e anexos)
Plano | Limite | Consumidas | Reservadas | Disponíveis
Fim do ciclo, somente quando conhecido; Free vitalício
Mensagem de estado + Consultar estado e saldo
Analisar oportunidade / Gerar análise atualizada
Aviso de consumo somente após conclusão e salvamento
Resultado salvo: data/hora, perfil histórico quando conhecido
Resumo → Compatibilidade → Pontos classificados
Informações não verificadas → Próximo passo recomendado
```

Estados: sem análise, sem perfil, pending/processing, completed, failed,
uncertain, saldo esgotado, ciclo não autorizado e consulta indisponível.
O resultado anterior continua visível durante atualização, esgotamento ou falha.

Franquia vem exclusivamente de consultarFranquiaIA(). Não há limites pagos fixos.
Contadores não são apresentados como zero quando o ciclo não está autorizado:
nesse caso o backend não informou um saldo válido. A data exibida é o FIM do
período concedido, não uma promessa de renovação. Free explica a demonstração
vitalícia e oferece /planos quando esgotada. Pro/Business não oferecem compras
avulsas nem upgrades não implementados.

A leitura do resultado não depende de saldo disponível. Matching, percentuais,
ranking, filtros e bloqueio de score no Free permanecem separados da IA.

## Atualização e reutilização

Servidor prepara o hash/snapshot com o contrato existente, nunca com dados
confiados ao formulário. A consulta prefere uma execução concluída com o hash
atual, mesmo se for anterior à última execução; na ausência, apresenta a última
concluída. A leitura seleciona o resultado pelo ID dessa execução para evitar
associar snapshot de uma versão a conteúdo de outra.

Hash igual ou snapshot equivalente evita nova geração. A equivalência normaliza
somente espaços em strings e ordem das chaves JSON; o preparador existente já
ordena listas. Não ignora mudanças de valores, prazos, status, perfil ou conteúdo.
Não modifica hashes, versões de prompt ou snapshots persistidos.

Mudança confirmada mantém o resultado antigo e oferece atualização explícita.
O servidor repete a consulta e a RPC de reserva vigente revalida identidade,
saldo e guard financeiro na transação. O campo atualizar apenas expressa a
intenção de gerar uma versão quando houver histórico; nunca concede franquia.

Histórico v1 mantém resumo/justificativa/pontos originais, sem percentual IA,
classificações ou próximo passo inventados. Nome histórico vem do snapshot,
nunca do perfil atual. Sem snapshot suficiente, a tela declara a limitação,
permite leitura gratuita e oferece nova geração manual sujeita à franquia.

## Adaptação mínima do banco

A tabela ia_execucoes_v1 é privada inclusive para service_role. Portanto não foi
adicionada consulta administrativa direta nem relaxados grants/RLS existentes.
Nova migration: supabase/analises_ia_interface_v1.sql.

RPC ia_consultar_interface_v1(uuid,uuid,text,text), SECURITY DEFINER,
search_path=pg_catalog, EXECUTE somente para authenticated. Usa auth.uid(),
confere propriedade do perfil e existência da oportunidade. Retorna estado e
metadados do resultado próprio (ID/hash/versão/snapshot). Não retorna token,
erro interno, metadados do provedor ou tabelas financeiras. Snapshot é consumido
no servidor; o componente cliente recebe somente IDs de contexto e flags.

É uma consulta sem escrita: não reserva, recupera, consome ou altera execuções.
Processing expirado aparece como uncertain; pending expirado como failed.
A reserva existente continua responsável pela transição persistida.

Pending/processing/uncertain do mesmo perfil e oportunidade bloqueiam uma nova
geração pela aplicação, inclusive com hash alterado. Estado real é consultado
a cada carregamento. Consulta indisponível bloqueia geração, mas tenta preservar
a leitura do histórico. Falhas e códigos de URL são mapeados por allowlist;
mensagens arbitrárias de query string não são exibidas na seção IA.

Instalação futura, somente após aprovação em homologação:
1. Pré-requisitos e migrations do PR #9, conforme IA_BILLING_ADAPTER_V1.md.
2. analises_ia_execucoes_v1.sql.
3. analises_ia_conteudo_v2.sql.
4. analises_ia_billing_adapter_v1.sql.
5. analises_ia_interface_v1.sql, com owner autorizado a ler as tabelas IA.
6. Aplicação desta etapa.

Não reaplicar migrations já instaladas. Nenhuma migration antiga foi editada.
A nova função não substitui nem altera o guard, o consumidor financeiro ou Asaas.

## Componentes e acessibilidade

PainelIA organiza estados e franquia no servidor; ResultadoIA organiza a leitura.
FormularioIA é a pequena fronteira cliente: useFormStatus, botão disabled,
indicador com redução de movimento, aria-busy, status anunciado e ref que bloqueia
um segundo submit imediato. A unicidade/locks da reserva continuam protegendo
requisições simultâneas com o mesmo hash.

Consulta manual usa navegação completa ao mesmo contexto para reler o servidor,
sem polling, cron ou worker. Layout preserva Card/Button, paleta slate/cyan/amber,
colunas responsivas, quebra de textos, foco visível e títulos/listas semânticos.

## Arquivos

Criados:
- components/analises/painel-ia.tsx
- components/analises/resultado-ia.tsx
- components/analises/formulario-ia.tsx
- lib/analises/apresentacao.ts
- services/interface-ia-service.ts
- supabase/analises_ia_interface_v1.sql
- tests/interface-ia.test.mjs
- tests/helpers/ia-formulario-interacao.mjs
- tests/sql/analises-ia-interface.sql
- docs/IA_INTERFACE_V1.md

Alterados:
- app/(painel)/oportunidades/[id]/page.tsx
- app/(painel)/oportunidades/actions.ts
- services/analises-service.ts
- tests/helpers/matching-doubles.mjs
- tests/helpers/matching-integracao.mjs
- tests/sql/run-ia-local.py
- tests/sql/run-ia-billing-local.py

## Validação

Node 24.13.0 (o comando de testes usa flags não disponíveis no Node padrão antigo).
- npm test: 127 testes da suíte principal, incluindo a execução da suíte de
  página/action/service em subprocesso. Mocks, sem rede/provedor.
- Cobertura da interface: Free disponível/esgotado, Pro/Business, datas conhecidas,
  ciclo não autorizado, pending/processing/failed/uncertain, sem perfil,
  v1/v2, histórico sem nome confirmado, reconsulta gratuita, dados alterados,
  mudança cosmética, atualização sem saldo, falha de consulta e sanitização.
- Teste de handlers com hooks simulados: segundo submit bloqueado, loading
  anunciado, botão desabilitado e bloqueio por autorização/saldo.
- Estrutura responsiva e atributos de acessibilidade verificados estaticamente.
- PostgreSQL 16 descartável: suíte básica, conteúdo v2, 15 verificações da nova
  RPC e quatro disputas concorrentes anteriores passaram.
- Integração financeira: 71 verificações PASS (56 existentes + 15 da interface),
  com migrations reais fixadas no commit 183e62e56c65390111744e8e8ce2249cb5cb7949,
  baixadas apenas em /tmp; hashes conferidos pelo runner. Auth/JWT emulados.
- npm run lint, npx tsc --noEmit e git diff --check passaram.
- npm run build sem variáveis falhou corretamente no prebuild. Compilação passou
  com NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 e chave pública fictícia;
  não foi criado .env.local. Fontes públicas do projeto exigem rede no build.

## Limitações e homologação

Não houve teste visual em navegador real, hidratação, leitor de tela ou medição de
layout em dispositivos. As verificações de responsividade são estruturais e os
handlers usam hooks simulados. Não declarar esta etapa homologada por isso.

O bloqueio entre hashes diferentes é conservador na leitura/action, não uma nova
unicidade transacional no SQL. Duas requisições com snapshots diferentes que
entrem exatamente juntas ainda dependem da franquia/locks existentes e podem
reservar duas análises distintas. Uma execução uncertain já visível impede nova
chamada pela interface; não há retry automático.

Snapshot com espaços equivalentes evita cobrança quando comparado com o resultado
selecionado. Não é uma busca semântica em todo o histórico nem uma normalização
retroativa de hashes; casos com dados revertidos e diferenças cosméticas em
versões antigas exigem atenção na homologação.

Próxima etapa: instalar a nova RPC em ambiente isolado aprovado e homologar junto
com PR #9. Conferir JWT/RLS reais, owner, estados pagos/Free, leitura sem saldo,
revogação, recarga durante processamento, resultado incerto, atualização com
franquia e coexistência com histórico. Validar teclado, foco, leitor de tela,
320/768/1440 px, textos longos e dupla submissão no navegador. Qualidade/custo
OpenAI exige autorização separada. Worker permanece desativado.

## Revisão para publicação

Os 17 arquivos foram revisados: identidade e propriedade na RPC, filtros por
usuário nas leituras, DTO sem tokens, grants mínimos, saldo do banco, reserva
transacional preservada, bloqueio de envio, histórico v1, conteúdo v2 sem segundo
score, mensagens sanitizadas e estrutura acessível/responsiva. Não foram
identificados bloqueadores para publicação da branch; as limitações de
homologação acima continuam abertas. Nenhuma migration anterior de IA ou
billing foi modificada.

PR #9 consultado na revisão: OPEN, base main, branch feat/asaas-assinatura-pro,
head 183e62e56c65390111744e8e8ce2249cb5cb7949, sem merge. O contrato testado
corresponde a esse head. A publicação da interface não instala esse contrato
nem ativa sua operação.
