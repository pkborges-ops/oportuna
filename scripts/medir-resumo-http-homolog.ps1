param([int]$Execucoes = 10)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$homologUrl = 'https://uzmgxxhiedevsxedgqij.supabase.co'
$envFile = Join-Path $PSScriptRoot '..\.env.local'

if ($Execucoes -lt 10 -or -not (Test-Path -LiteralPath $envFile)) {
  throw 'Medição não iniciada: informe pelo menos 10 execuções e configure .env.local localmente.'
}

$publicConfig = @{}
foreach ($line in Get-Content -LiteralPath $envFile) {
  if ($line -match '^\s*(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)\s*=\s*(.*)\s*$') {
    $publicConfig[$matches[1]] = $matches[2].Trim().Trim('"', "'")
  }
}
if ($publicConfig['NEXT_PUBLIC_SUPABASE_URL'] -ne $homologUrl -or
    -not $publicConfig['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'].StartsWith('sb_publishable_')) {
  throw 'Medição não iniciada: URL ou chave pública da homologação inválida.'
}

$key = $publicConfig['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']
$out = @()
$startedAt = (Get-Date).ToString('o')

foreach ($plan in @('FREE', 'PRO', 'BUSINESS')) {
  Write-Host "Conta $plan (valores digitados não serão exibidos)"
  $email = Read-Host 'E-mail'
  $securePassword = Read-Host 'Senha' -AsSecureString
  $password = ConvertFrom-SecureString -SecureString $securePassword -AsPlainText

  try {
    $auth = Invoke-RestMethod -Method Post -Uri "$homologUrl/auth/v1/token?grant_type=password" `
      -Headers @{ apikey = $key } -ContentType 'application/json' `
      -Body (ConvertTo-Json @{ email = $email; password = $password } -Compress) -TimeoutSec 20
  } catch {
    Write-Host "FAIL $plan autenticação não confirmada."
    $password = $null
    continue
  } finally {
    $password = $null
    $securePassword.Dispose()
  }

  $headers = @{ apikey = $key; Authorization = "Bearer $($auth.access_token)" }
  try {
    $actual = Invoke-RestMethod -Method Post -Uri "$homologUrl/rest/v1/rpc/plano_atual_v1" `
      -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 20
    if ($actual -ne $plan) {
      Write-Host "FAIL $plan plano observado divergente; medições ignoradas."
      continue
    }

    for ($i = 1; $i -le $Execucoes; $i++) {
      $timer = [Diagnostics.Stopwatch]::StartNew()
      $record = [ordered]@{ plano = $plan; execucao = $i; tempo_ms = $null; http = $null; sqlstate = $null; total = $null; timeout = $false }
      try {
        $response = Invoke-WebRequest -Method Post -Uri "$homologUrl/rest/v1/rpc/resumo_oportunidades_ativas_v1" `
          -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 20 -SkipHttpErrorCheck
        $record.http = [int]$response.StatusCode
        try {
          $data = $response.Content | ConvertFrom-Json
          if ($record.http -eq 200) { $record.total = [int]$data.total }
          else { $record.sqlstate = [string]$data.code }
        } catch { }
      } catch {
        $record.timeout = $true
      } finally {
        $timer.Stop()
        $record.tempo_ms = [math]::Round($timer.Elapsed.TotalMilliseconds)
      }
      $out += [pscustomobject]$record
      Write-Host "$plan #$i HTTP=$($record.http) tempo_ms=$($record.tempo_ms) SQLSTATE=$($record.sqlstate) total=$($record.total) timeout=$($record.timeout)"
      Start-Sleep -Milliseconds 500
    }
  } catch {
    Write-Host "FAIL $plan verificação de plano não concluída."
  } finally {
    $auth = $null
    $headers = $null
  }
}

foreach ($plan in @('FREE', 'PRO', 'BUSINESS')) {
  $values = @($out | Where-Object { $_.plano -eq $plan })
  if ($values.Count -ne $Execucoes) {
    Write-Host "FAIL $plan medições incompletas: $($values.Count)/$Execucoes"
    continue
  }
  $sorted = @($values.tempo_ms | Sort-Object)
  $index = ($sorted.Count - 1) * 0.95
  $lo = [math]::Floor($index)
  $hi = [math]::Ceiling($index)
  $p95 = $sorted[$lo] + ($sorted[$hi] - $sorted[$lo]) * ($index - $lo)
  $average = ($values.tempo_ms | Measure-Object -Average).Average
  $fail500 = @($values | Where-Object { $_.http -eq 500 }).Count
  $fail57014 = @($values | Where-Object { $_.sqlstate -eq '57014' }).Count
  Write-Host "$plan resumo min_ms=$($sorted[0]) media_ms=$([math]::Round($average)) p95_ms=$([math]::Round($p95)) max_ms=$($sorted[-1]) HTTP500=$fail500 SQLSTATE57014=$fail57014"
}

$outputPath = Join-Path $env:TEMP 'oportuna-resumo-http-otimizado-sanitizado.json'
[pscustomobject]@{ ambiente = 'homologacao'; iniciado_em = $startedAt; payload = '{}'; resultados = $out } |
  ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $outputPath -Encoding utf8
Write-Host "Resultado sanitizado salvo em $outputPath"
