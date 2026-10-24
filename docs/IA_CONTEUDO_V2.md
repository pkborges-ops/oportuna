# Etapa 2 — conteúdo comercial da análise de IA

Implementação local em `feat/analise-ia-v1`. Sem chamadas reais à OpenAI, migrations remotas, alterações financeiras ou publicação. Este documento atualiza apenas o contrato de conteúdo descrito na Etapa 1.

## Contrato

Versão de prompt/hash: `analise-v2-comercial-p1`. Versão de armazenamento: `versao_schema=2`.

| Campo | Validação |
| --- | --- |
| resumo | Texto não vazio, até 800 caracteres |
| compatibilidade_empresa | Texto não vazio, até 800 caracteres |
| pontos_atencao | Zero a cinco objetos |
| ponto.titulo | Texto não vazio, até 100 caracteres |
| ponto.classificacao | fato_identificado ou informacao_a_confirmar |
| ponto.explicacao | Texto não vazio, até 400 caracteres |
| ponto.acao_recomendada | Texto não vazio, até 300 caracteres |
| informacoes_nao_verificadas | Zero a três textos não vazios, até 250 caracteres cada |
| proximo_passo | Texto não vazio, até 400 caracteres |

Campos adicionais são rejeitados, inclusive score. Listas vazias são válidas para não obrigar o modelo a inventar riscos. O schema estrito da Responses API é validado novamente em TypeScript e no banco. A tela mantém o layout, apresenta a classificação de cada ponto e o próximo passo. Somente o percentual determinístico continua visível, sujeito às mesmas regras de desbloqueio do plano.

## Prompt e dados

Instruções fixas separadas do JSON de entrada. Campos do PNCP e do perfil são explicitamente tratados como dados não confiáveis, nunca como instruções. Não há ferramentas, acesso a URLs, download de edital ou anexos.

O prompt exige correspondências concretas, diferencia hipótese de fato e proíbe conclusões de habilitação/capacidade, parecer jurídico, score e exigências inventadas. Prazo ausente permanece ausente; publicação/abertura não são substitutos. Encerramento e divergências devem ser destacados. A tela informa que edital completo/anexos não foram analisados.

Snapshot usa título, objeto, órgão, modalidade, cidade/UF, valor, publicação/abertura, status/situação operacional, origem/tipo, participação e perfil comercial. Não inclui CNPJ, identificadores pessoais ou conteúdo do matching, inclusive bloqueado no Free. Ausências viram null, sem datas fabricadas. Palavras-chave/tags ordenadas estabilizam o hash.

Entrada limitada a 24.000 bytes UTF-8, com limites por campo: objeto 8.000 caracteres, título 1.000, órgão 500, observações 2.000, URL 1.500, forma de participação 1.000, até 30 palavras-chave/tags de 150 caracteres. Excesso falha antes de chamar o provedor; não há truncamento silencioso.

## Provedor, falhas e custo

Endpoint Responses API, módulo marcado server-only. Modelo preservado: OPENAI_MODEL ou gpt-5.1. A mudança não seleciona modelo mais caro automaticamente.

Timeout de 90 segundos; max_output_tokens=2.500; store=false. O orçamento anterior de 700 tokens foi ampliado para comportar o conteúdo estruturado. Isso limita a saída, mas não demonstra redução de custo nem garante conclusão dentro do limite. Custo real e qualidade precisam de avaliação posteriormente autorizada.

Aceita somente status completed, sem erro/incomplete_details/recusa, uma mensagem assistant completed com output_text e JSON válido. Recusa em qualquer mensagem invalida inclusive uma resposta que também tenha texto.

| Ocorrência | Tratamento |
| --- | --- |
| 401/429 e demais 4xx, exceto 408 | Falha conhecida, sem consumo definitivo |
| 408/5xx, timeout ou falha de transporte | Incerta, reserva mantida |
| incomplete/failed/cancelled, recusa, JSON/schema inválido | Falha conhecida, sem análise concluída |
| queued/in_progress ou status desconhecido | Incerta |
| Falha de persistência depois de resposta válida | Incerta; preserva metadados quando banco responde |
| Resposta do commit perdida, execução já completed | Reconhece conclusão sem repetir geração |

Não há retentativa automática. Erros do provedor não são exibidos ao usuário. Metadados permitidos: modelo retornado, versão do prompt, ID da resposta, tokens de entrada/saída, duração e resultado da tentativa. Ausentes permanecem null; chave e corpo de erro não são gravados. Falhas incompletas também conservam uso retornado. Falha conhecida sem consumo de franquia pode ter gerado custo no provedor; são métricas distintas.

## Migration e histórico

Nova migration: `supabase/analises_ia_conteudo_v2.sql`, após `analises_ia_execucoes_v1.sql`. Não modifica o arquivo da Etapa 1 nem migrations de billing.

Adiciona versao_schema (default 1) e conteudo JSONB. Score/justificativa/pontos antigos permitem NULL somente no formato v2, protegido por constraint; v2 exige esses três campos NULL. Não fabrica score zero nem migra score histórico para matching. Resumo permanece disponível para compatibilidade.

Substitui apenas o corpo da finalização para escolher validação/gravação pelo contrato da execução. Locks, token, autorização, ciclo, expiração, reconciliação e transação resultado+consumo permanecem iguais. Execuções v1 em andamento continuam finalizáveis após a migration. Privilégios da RPC são preservados e helpers novos são privados.

O leitor distingue versões: exibe os campos originais de históricos, sem atribuir classificações ou próximos passos inexistentes. A coluna score histórica continua íntegra no banco, mas não é apresentada como percentual. Leitura não gera nem cobra análise. Não há sobrescrita automática, botão de atualização ou conversão de registros.

Aplicar primeiro a migration em homologação, depois o código novo. Código v2 não deve ser liberado sem as colunas novas. Rollback somente do aplicativo antigo não é seguro para ler conteúdo v2; manter leitor compatível e suspender novas gerações se necessário. Não remover colunas/resultados para fazer rollback.

## Validação local

- npm test: 110 testes aprovados, incluindo a suíte de integração em subprocesso; mocks de todos os cenários solicitados e regressões existentes; nenhuma requisição real ao provedor.
- Testes de integração de página/action/service: legado, armazenamento v1 e v2; matching Free permanece bloqueado; leitura não gera chamadas.
- PostgreSQL 16 descartável, socket Unix em /tmp: migrations reais, histórico antes/depois, contrato inválido sem consumo, v2 sem score, metadados, idempotência, privilégios/RLS e quatro disputas concorrentes da Etapa 1.
- lint e TypeScript.
- git diff --check.
- Build padrão sem ambiente falha no prebuild pela ausência de variáveis Supabase. Build concluído com sucesso usando URL localhost e chave pública fictícia, sem arquivo .env ou credenciais reais. Isso não homologa conexão com Supabase.

Mocks de prompt injection, prazo ausente e encerramento verificam as instruções e o payload. Não provam que um modelo real seguirá todas as regras nem eliminam alucinação.

## Arquivos desta etapa

Criados:
- lib/openai/prompt-analise.ts
- supabase/analises_ia_conteudo_v2.sql
- tests/helpers/analise-v2-fixture.mjs
- tests/sql/analises-ia-conteudo-v2.sql
- docs/IA_CONTEUDO_V2.md

Alterados:
- lib/analises/contrato.ts
- lib/analises/executar.ts
- lib/openai/analise-oportunidade.ts
- services/analises-service.ts
- types/domain.ts
- app/(painel)/oportunidades/[id]/page.tsx
- tests/analises-ia.test.mjs
- tests/helpers/matching-doubles.mjs
- tests/helpers/matching-integracao.mjs
- tests/register.mjs
- tests/sql/run-ia-local.py

actions.ts, franquia-ia-service.ts e migration de execuções mantêm as mudanças da Etapa 1, sem alteração nesta etapa.

## Dependências e próxima etapa

O conteúdo v2 não introduz dependência financeira nova. Permanecem abertos os pontos da revisão Etapa 1.1 do PR #9: início/fim explícitos por pagamento, identidade estável, snapshot dos termos concedidos, revogação e recuperação idempotente entre confirmação financeira e concessão da franquia. Não foi implementado adaptador Asaas, outbox ou alteração de assinatura nesta etapa.

Homologar depois da revisão: aplicar as duas migrations em ambiente isolado com dados fictícios, conferir os formatos históricos e v2 e os estados da franquia. A integração paga depende da resolução do contrato com a frente Windows; não é declarada pronta para produção.

Uma avaliação real de qualidade/custo exigirá autorização separada, conjunto pequeno de oportunidades representativas (abertas, encerradas, prazos ausentes, campos conflitantes e injeção), revisão humana de factualidade e medição de tokens/latência. Nenhuma chamada paga foi feita aqui. Store=false reduz persistência no provedor, mas limita recuperação posterior por ID; queda do processo antes de persistir continua sendo risco operacional da Etapa 1.
