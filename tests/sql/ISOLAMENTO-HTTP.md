# Isolamento da RPC com duas contas reais

Execução manual de `scripts/validar-isolamento-rpc.mjs`, Node 20+.
Destino fixo: `https://uzmgxxhiedevsxedgqij.supabase.co` (oportuna-homologacao).
Não lê `.env.local`, não utiliza service role, não executa migrations e não escreve
nas tabelas da aplicação. O login normal cria sessões e registros operacionais do
Supabase Auth; tokens ficam apenas na memória do processo, sem refresh automático.

Pré-requisitos: duas contas reais de teste já criadas/confirmadas, cada uma com um
perfil próprio. Copie o UUID de cada perfil da URL de edição em `/perfis/<UUID>`
ao entrar com a respectiva conta. Não use o perfil sintético dos benchmarks para
uma conta diferente. A massa de oportunidades deve existir para validar o controle
positivo. O script não cria contas, perfis ou oportunidades.

O UUID B deve ser copiado do perfil criado na Conta B. Não altere um dígito do
UUID A para inventar um identificador diferente. A chave publicável completa pode
ser copiada em Settings > API Keys > Publishable key do projeto de homologação.

No PowerShell, na raiz `code/oportuna`, execute o bloco inteiro abaixo. Digite os
valores nos prompts locais; não os cole no chat. As senhas são solicitadas de forma
oculta, sem literais no histórico. As variáveis são removidas ao terminar.

```powershell
Set-Location 'C:\Users\dhiei\OneDrive\Desktop\Patrick\Projetos\oportuna\code\oportuna'
try {
  $env:HOMOLOG_SUPABASE_URL = 'https://uzmgxxhiedevsxedgqij.supabase.co'
  $env:HOMOLOG_SUPABASE_PUBLISHABLE_KEY = Read-Host 'Chave sb_publishable_ da homologacao'
  $env:HOMOLOG_CONTA_A_EMAIL = Read-Host 'Email da conta A'
  $env:HOMOLOG_CONTA_A_SENHA = [System.Net.NetworkCredential]::new('', (Read-Host 'Senha da conta A' -AsSecureString)).Password
  $env:HOMOLOG_PERFIL_A_ID = Read-Host 'UUID do perfil da conta A'
  $env:HOMOLOG_CONTA_B_EMAIL = Read-Host 'Email da conta B'
  $env:HOMOLOG_CONTA_B_SENHA = [System.Net.NetworkCredential]::new('', (Read-Host 'Senha da conta B' -AsSecureString)).Password
  $env:HOMOLOG_PERFIL_B_ID = Read-Host 'UUID do perfil da conta B'
  node scripts/validar-isolamento-rpc.mjs
  $resultadoIsolamento = $LASTEXITCODE
} finally {
  'HOMOLOG_SUPABASE_URL','HOMOLOG_SUPABASE_PUBLISHABLE_KEY',
  'HOMOLOG_CONTA_A_EMAIL','HOMOLOG_CONTA_A_SENHA','HOMOLOG_PERFIL_A_ID',
  'HOMOLOG_CONTA_B_EMAIL','HOMOLOG_CONTA_B_SENHA','HOMOLOG_PERFIL_B_ID' |
    ForEach-Object { Remove-Item -LiteralPath "Env:$_" -ErrorAction SilentlyContinue }
}
```

Apenas a chave moderna `sb_publishable_...` é aceita; JWT legado e `sb_secret_...`
são rejeitados antes de qualquer conexão. Não há fallback para variáveis de produção.
Requisições têm timeout de 45 s e recusam redirecionamentos. São enviados dois POSTs
de login; validação de usuário, propriedade e chamadas da RPC usam GET. No PostgREST,
a chamada GET da função STABLE ocorre em transação somente leitura.

O script mostra exatamente quatro linhas, com PASS/FAIL e mensagens fixas,
sem emails, UUIDs, dados de oportunidades, senhas, chaves ou corpos de erro externos.
Retorna código 0 somente se as quatro linhas forem PASS; qualquer FAIL retorna 1.

Critérios:

- Conta A / Perfil A e Conta B / Perfil B: identidade autenticada confirmada,
  propriedade do perfil confirmada sob RLS, HTTP 200 com página não vazia (até 21
  linhas) e scores/níveis válidos. As duas contas e os dois perfis devem ser distintos.
- Conta A / Perfil B e Conta B / Perfil A: ambos os controles positivos devem
  passar; rejeição deve ser HTTP 403, SQLSTATE 42501 e `Perfil indisponível`, conforme
  contrato da migration atual. HTTP 200 vazio, timeout, 401, 5xx, erro de permissão
  genérico ou falha nos controles positivos são FAIL, nunca prova de isolamento.
- Falta de configuração/autenticação/propriedade: quatro FAIL com explicação
  `Não executado`; isso não afirma uma vulnerabilidade, apenas ausência de validação.
  Erros de configuração indicam os campos inválidos, sem revelar seus valores.
  Falhas de login identificam Conta A e Conta B separadamente, com mensagens fixas
  para credenciais inválidas, confirmação pendente, limite de tentativas e problemas
  do serviço. `login confirmado` não é PASS de isolamento: as quatro RPCs só são
  chamadas depois que ambas as contas e a propriedade dos perfis forem confirmadas.

Testes locais do validador (respostas simuladas, sem rede):
`node --test tests/isolamento-rpc.test.mjs`. Esses testes verificam o validador,
não comprovam o isolamento do banco. Para homologar, execute o script com as contas
reais e compartilhe apenas suas quatro linhas sanitizadas de resultado.
