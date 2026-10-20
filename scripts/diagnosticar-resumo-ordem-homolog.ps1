param([ValidateRange(5, 10)][int]$IdleMinutes = 5)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$homologUrl = 'https://uzmgxxhiedevsxedgqij.supabase.co'
$envFile = Join-Path $PSScriptRoot '..\.env.local'
$outputPath = Join-Path ([IO.Path]::GetTempPath()) 'oportuna-resumo-ordem-sanitizado.json'

if (-not (Test-Path -LiteralPath $envFile)) {
  throw 'Teste não iniciado: .env.local da homologação não encontrado.'
}

$publicConfig = @{}
foreach ($line in Get-Content -LiteralPath $envFile) {
  if ($line -match '^\s*(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)\s*=\s*(.*)\s*$') {
    $publicConfig[$matches[1]] = $matches[2].Trim().Trim('"', "'")
  }
}
if ($publicConfig['NEXT_PUBLIC_SUPABASE_URL'] -ne $homologUrl -or
    -not $publicConfig['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'].StartsWith('sb_publishable_')) {
  throw 'Teste não iniciado: URL ou chave pública da homologação inválida.'
}

$script:key = $publicConfig['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']
$script:tokens = @{}
$script:results = [Collections.Generic.List[object]]::new()
$script:startedAt = [DateTimeOffset]::UtcNow.ToString('o')
$script:lastCompletedAt = $null
$script:consecutive429 = 0

function Save-SanitizedResults {
  [pscustomobject]@{
    ambiente = 'homologacao'
    projeto = 'uzmgxxhiedevsxedgqij'
    iniciado_utc = $script:startedAt
    atualizado_utc = [DateTimeOffset]::UtcNow.ToString('o')
    payload = '{}'
    espera_minutos = $IdleMinutes
    resultados = $script:results.ToArray()
  } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $outputPath -Encoding utf8
}

function Invoke-Resumo {
  param(
    [string]$Plan,
    [string]$Stage,
    [int]$CallInPlan,
    [bool]$FirstAfterIdle
  )

  $started = [DateTimeOffset]::UtcNow
  $gapSeconds = if ($null -eq $script:lastCompletedAt) { $null } else {
    [math]::Round(($started - $script:lastCompletedAt).TotalSeconds, 1)
  }
  $timer = [Diagnostics.Stopwatch]::StartNew()
  $record = [ordered]@{
    ordem_global = $script:results.Count + 1
    etapa = $Stage
    plano = $Plan
    chamada_no_plano = $CallInPlan
    inicio_utc = $started.ToString('o')
    intervalo_desde_anterior_s = $gapSeconds
    primeira_apos_inatividade = $FirstAfterIdle
    tempo_ms = $null
    http = $null
    sqlstate = $null
    total = $null
    total_base = $null
    falha_transporte = $false
    timeout_transporte = $false
  }
  $headers = @{ apikey = $script:key; Authorization = "Bearer $($script:tokens[$Plan])" }
  try {
    $response = Invoke-WebRequest -Method Post -Uri "$homologUrl/rest/v1/rpc/resumo_oportunidades_ativas_v1" `
      -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 20 -SkipHttpErrorCheck
    $record.http = [int]$response.StatusCode
    try {
      $data = $response.Content | ConvertFrom-Json
      if ($record.http -eq 200) {
        $record.total = [int]$data.total
        $record.total_base = [int]$data.totalBase
      } else {
        $record.sqlstate = [string]$data.code
      }
    } catch { }
  } catch {
    $record.falha_transporte = $true
    $record.timeout_transporte = [bool]($_.Exception.Message -match '(?i)timed?\s*out|timeout')
  } finally {
    $timer.Stop()
    $script:lastCompletedAt = [DateTimeOffset]::UtcNow
    $record.tempo_ms = [math]::Round($timer.Elapsed.TotalMilliseconds)
    $script:results.Add([pscustomobject]$record)
    Save-SanitizedResults
    Write-Host "$($record.ordem_global) $Stage $Plan #$CallInPlan $($record.tempo_ms)ms HTTP=$($record.http) SQLSTATE=$($record.sqlstate) primeira_apos_espera=$FirstAfterIdle"
    $headers = $null
  }

  if ($record.http -eq 429) { $script:consecutive429++ } else { $script:consecutive429 = 0 }
  if ($script:consecutive429 -ge 2) { throw 'Teste interrompido: HTTP 429 repetido.' }
}

try {
  foreach ($plan in @('FREE', 'PRO', 'BUSINESS')) {
    Write-Host "Conta $plan (credenciais não serão exibidas nem salvas)"
    $email = Read-Host 'E-mail' -MaskInput
    $securePassword = Read-Host 'Senha' -AsSecureString
    $password = ConvertFrom-SecureString -SecureString $securePassword -AsPlainText
    try {
      $auth = Invoke-RestMethod -Method Post -Uri "$homologUrl/auth/v1/token?grant_type=password" `
        -Headers @{ apikey = $script:key } -ContentType 'application/json' `
        -Body (ConvertTo-Json @{ email = $email; password = $password } -Compress) -TimeoutSec 20
      $headers = @{ apikey = $script:key; Authorization = "Bearer $($auth.access_token)" }
      $observed = Invoke-RestMethod -Method Post -Uri "$homologUrl/rest/v1/rpc/plano_atual_v1" `
        -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 20
      if ($observed -ne $plan) { throw 'Plano efetivo divergente.' }
      $script:tokens[$plan] = $auth.access_token
    } catch {
      throw "Teste não iniciado: autenticação ou plano $plan não confirmado."
    } finally {
      $email = $null
      $password = $null
      $auth = $null
      $headers = $null
      $securePassword.Dispose()
    }
  }

  Save-SanitizedResults
  $cycles = @(
    @{ Name = 'A'; Order = @('BUSINESS', 'PRO', 'FREE') },
    @{ Name = 'B'; Order = @('PRO', 'FREE', 'BUSINESS') },
    @{ Name = 'C'; Order = @('FREE', 'BUSINESS', 'PRO') }
  )
  foreach ($cycle in $cycles) {
    foreach ($plan in $cycle.Order) {
      for ($i = 1; $i -le 3; $i++) {
        Invoke-Resumo -Plan $plan -Stage "ciclo_$($cycle.Name)" -CallInPlan $i -FirstAfterIdle $false
        Start-Sleep -Milliseconds 500
      }
    }
  }

  foreach ($plan in @('BUSINESS', 'PRO', 'FREE')) {
    Write-Host "Aguardando $IdleMinutes minutos sem chamadas desta RPC pelo script. Não abra o dashboard nesse intervalo."
    Start-Sleep -Seconds ($IdleMinutes * 60)
    for ($i = 1; $i -le 3; $i++) {
      Invoke-Resumo -Plan $plan -Stage "apos_inatividade_$($plan.ToLowerInvariant())" `
        -CallInPlan $i -FirstAfterIdle ($i -eq 1)
      Start-Sleep -Milliseconds 500
    }
  }

  Write-Host "Resultado sanitizado salvo em $outputPath"
} finally {
  $script:tokens.Clear()
  $script:key = $null
}
