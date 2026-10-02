# Uso manual: as credenciais sao digitadas no terminal e nunca salvas em arquivo.
# O validador Node fixa o destino na homologacao e so imprime PASS/FAIL.
$ErrorActionPreference = 'Stop'
$resultado = 1
$resultadoPath = Join-Path $env:TEMP 'oportuna-isolamento-homolog-resultado.txt'

try {
  $env:HOMOLOG_SUPABASE_URL = 'https://uzmgxxhiedevsxedgqij.supabase.co'
  $env:HOMOLOG_ISOLAMENTO_RPC = 'v2'
  $env:HOMOLOG_SUPABASE_PUBLISHABLE_KEY = Read-Host 'Chave sb_publishable_ da homologacao'
  $env:HOMOLOG_CONTA_A_EMAIL = Read-Host 'Email da conta A'
  $env:HOMOLOG_CONTA_A_SENHA = [System.Net.NetworkCredential]::new('', (Read-Host 'Senha da conta A' -AsSecureString)).Password
  $env:HOMOLOG_PERFIL_A_ID = Read-Host 'UUID do perfil da conta A'
  $env:HOMOLOG_CONTA_B_EMAIL = Read-Host 'Email da conta B'
  $env:HOMOLOG_CONTA_B_SENHA = [System.Net.NetworkCredential]::new('', (Read-Host 'Senha da conta B' -AsSecureString)).Password
  $env:HOMOLOG_PERFIL_B_ID = Read-Host 'UUID do perfil da conta B'

  # O validador imprime somente PASS/FAIL e mensagens sanitizadas.
  & node (Join-Path $PSScriptRoot 'validar-isolamento-rpc.mjs') |
    Tee-Object -FilePath $resultadoPath
  $resultado = $LASTEXITCODE
} catch {
  # Nunca imprimir o texto da excecao: ele pode conter dados digitados.
  Write-Host ('Falha local antes do resultado: ' + $_.Exception.GetType().Name)
} finally {
  'HOMOLOG_SUPABASE_URL', 'HOMOLOG_ISOLAMENTO_RPC',
  'HOMOLOG_SUPABASE_PUBLISHABLE_KEY',
  'HOMOLOG_CONTA_A_EMAIL', 'HOMOLOG_CONTA_A_SENHA', 'HOMOLOG_PERFIL_A_ID',
  'HOMOLOG_CONTA_B_EMAIL', 'HOMOLOG_CONTA_B_SENHA', 'HOMOLOG_PERFIL_B_ID' |
    ForEach-Object { Remove-Item -LiteralPath "Env:$_" -ErrorAction SilentlyContinue }
}

Write-Host "Resultado do processo: $resultado"
Write-Host "Saida sanitizada: $resultadoPath"
Read-Host 'Pressione Enter para fechar a janela'
