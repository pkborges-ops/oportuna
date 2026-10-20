param([ValidateRange(5, 10)][int]$IdleMinutes = 5)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$homologUrl = 'https://uzmgxxhiedevsxedgqij.supabase.co'
$envFile = Join-Path $PSScriptRoot '..\.env.local'
$outputPath = Join-Path ([IO.Path]::GetTempPath()) 'oportuna-resumo-cold-http-sanitizado.json'

if (-not (Test-Path -LiteralPath $envFile)) {
  throw 'Teste não iniciado: .env.local da homologação não encontrado.'
}

$publicConfig = @{}
foreach ($line in Get-Content -LiteralPath $envFile) {
  if ($line -match '^\s*(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)\s*=\s*(.*)\s*$') {
    $publicConfig[$matches[1]] = $matches[2].Trim().Trim('"', "'")
  }
}
$key = $publicConfig['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']
if ($publicConfig['NEXT_PUBLIC_SUPABASE_URL'] -ne $homologUrl -or
    [string]::IsNullOrWhiteSpace($key) -or -not $key.StartsWith('sb_publishable_')) {
  throw 'Teste não iniciado: URL ou chave pública da homologação inválida.'
}

$script:results = [Collections.Generic.List[object]]::new()
$script:lastCompletedAt = $null
$script:startedAt = [DateTimeOffset]::Now.ToString('o')
$script:token = $null
$script:key = $key

function Save-SanitizedResults {
  [pscustomobject]@{
    ambiente = 'homologacao'
    projeto = 'uzmgxxhiedevsxedgqij'
    iniciado = $script:startedAt
    atualizado = [DateTimeOffset]::Now.ToString('o')
    espera_minutos = $IdleMinutes
    operacao_simples = 'POST /rest/v1/rpc/plano_atual_v1'
    operacao_resumo = 'POST /rest/v1/rpc/resumo_oportunidades_ativas_v1'
    payload = '{}'
    resultados = $script:results.ToArray()
  } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $outputPath -Encoding utf8
}

function Invoke-MeasuredRpc {
  param([string]$Scenario, [string]$Operation)

  $started = [DateTimeOffset]::Now
  $gap = if ($null -eq $script:lastCompletedAt) { $null } else {
    [math]::Round(($started - $script:lastCompletedAt).TotalSeconds, 1)
  }
  $record = [ordered]@{
    ordem_global = $script:results.Count + 1
    cenario = $Scenario
    operacao = $Operation
    inicio_brt = $started.ToString('o')
    intervalo_desde_anterior_s = $gap
    tempo_ms = $null
    http = $null
    sqlstate = $null
    resultado_valido = $false
    total = $null
    total_base = $null
    falha_transporte = $false
    timeout_transporte = $false
  }
  $path = if ($Operation -eq 'simples') { 'plano_atual_v1' } else { 'resumo_oportunidades_ativas_v1' }
  $timer = [Diagnostics.Stopwatch]::StartNew()
  $headers = @{ apikey = $script:key; Authorization = "Bearer $script:token" }
  try {
    $response = Invoke-WebRequest -Method Post -Uri "$homologUrl/rest/v1/rpc/$path" `
      -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 20 -SkipHttpErrorCheck
    $record.http = [int]$response.StatusCode
    try {
      $data = $response.Content | ConvertFrom-Json
      if ($record.http -eq 200 -and $Operation -eq 'simples') {
        $record.resultado_valido = $data -in @('FREE', 'PRO', 'BUSINESS')
      } elseif ($record.http -eq 200) {
        $record.total = [int]$data.total
        $record.total_base = [int]$data.totalBase
        $record.resultado_valido = $record.total -ge 0 -and $record.total_base -ge $record.total
      } else {
        $record.sqlstate = [string]$data.code
      }
    } catch { }
  } catch {
    $record.falha_transporte = $true
    $record.timeout_transporte = [bool]($_.Exception.Message -match '(?i)timed?\s*out|timeout')
  } finally {
    $timer.Stop()
    $record.tempo_ms = [math]::Round($timer.Elapsed.TotalMilliseconds)
    $script:lastCompletedAt = [DateTimeOffset]::Now
    $script:results.Add([pscustomobject]$record)
    Save-SanitizedResults
    Write-Host "$Scenario $Operation $($record.tempo_ms)ms HTTP=$($record.http) SQLSTATE=$($record.sqlstate)"
    $headers = $null
  }
}

try {
  Write-Host 'Digite uma conta real da homologação. Credenciais não serão exibidas nem salvas.'
  $email = Read-Host 'E-mail' -MaskInput
  $securePassword = Read-Host 'Senha' -AsSecureString
  $password = ConvertFrom-SecureString -SecureString $securePassword -AsPlainText
  try {
    $auth = Invoke-RestMethod -Method Post -Uri "$homologUrl/auth/v1/token?grant_type=password" `
      -Headers @{ apikey = $script:key } -ContentType 'application/json' `
      -Body (ConvertTo-Json @{ email = $email; password = $password } -Compress) -TimeoutSec 20
    if ([string]::IsNullOrWhiteSpace($auth.access_token)) { throw 'Token ausente.' }
    $script:token = $auth.access_token
  } catch {
    throw 'Teste não iniciado: autenticação de homologação não confirmada.'
  } finally {
    $email = $null
    $password = $null
    $auth = $null
    $securePassword.Dispose()
  }

  Save-SanitizedResults
  Write-Host "Cenário A: aguarde $IdleMinutes minutos sem abrir o dashboard ou chamar a RPC."
  Start-Sleep -Seconds ($IdleMinutes * 60)
  Invoke-MeasuredRpc -Scenario 'A' -Operation 'simples'
  Invoke-MeasuredRpc -Scenario 'A' -Operation 'resumo'

  Write-Host "Cenário B: nova pausa de $IdleMinutes minutos sem abrir o dashboard ou chamar a RPC."
  Start-Sleep -Seconds ($IdleMinutes * 60)
  Invoke-MeasuredRpc -Scenario 'B' -Operation 'resumo'
  Invoke-MeasuredRpc -Scenario 'B' -Operation 'resumo'

  Write-Host "Resultado sanitizado salvo em $outputPath"
} finally {
  $script:token = $null
  $script:key = $null
}
