# Uso manual em homologação. Execute uma vez em Free e outra em Pro.
# Não grava credenciais e mantém a janela aberta.
$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'Oportuna - medicao HTTP homologacao'
$resultado = 1
$resultadoPath = Join-Path $env:TEMP 'oportuna-planos-homolog-resultado.txt'
try {
  $env:HOMOLOG_SUPABASE_URL = 'https://uzmgxxhiedevsxedgqij.supabase.co'
  $env:HOMOLOG_TESTE_PLANO = (Read-Host 'Plano esperado agora (FREE ou PRO)').Trim().ToUpperInvariant()
  $env:HOMOLOG_SUPABASE_PUBLISHABLE_KEY = [System.Net.NetworkCredential]::new('', (Read-Host 'Chave sb_publishable_ da homologacao' -AsSecureString)).Password
  $env:HOMOLOG_CONTA_EMAIL = [System.Net.NetworkCredential]::new('', (Read-Host 'Email da conta de homologacao' -AsSecureString)).Password
  $senha = Read-Host 'Senha da conta' -AsSecureString
  $env:HOMOLOG_CONTA_SENHA = [System.Net.NetworkCredential]::new('', $senha).Password
  $env:HOMOLOG_PERFIL_ID = [System.Net.NetworkCredential]::new('', (Read-Host 'UUID do perfil dessa conta' -AsSecureString)).Password
  & node (Join-Path $PSScriptRoot 'medir-planos-homolog.mjs') |
    Tee-Object -FilePath $resultadoPath
  $resultado = $LASTEXITCODE
} catch {
  Write-Host ('Falha local: ' + $_.Exception.GetType().Name)
} finally {
  'HOMOLOG_SUPABASE_URL', 'HOMOLOG_TESTE_PLANO',
  'HOMOLOG_SUPABASE_PUBLISHABLE_KEY', 'HOMOLOG_CONTA_EMAIL',
  'HOMOLOG_CONTA_SENHA', 'HOMOLOG_PERFIL_ID' |
    ForEach-Object { Remove-Item -LiteralPath "Env:$_" -ErrorAction SilentlyContinue }
}
Write-Host "Resultado do processo: $resultado"
Write-Host "Saida sanitizada: $resultadoPath"
Read-Host 'Pressione Enter para fechar a janela'
