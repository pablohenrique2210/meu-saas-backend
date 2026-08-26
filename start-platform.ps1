$ErrorActionPreference = 'Stop'

$backendPath = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$frontendCandidate = Join-Path $backendPath '..\..\FRONT\meu-saas-frontend'
$frontendPath = (Resolve-Path -LiteralPath $frontendCandidate).Path
$logPath = Join-Path $backendPath 'output\logs'
New-Item -ItemType Directory -Force -Path $logPath | Out-Null

function Test-Port([int]$Port) {
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

if (-not (Test-Port 4000)) {
  Start-Process -FilePath 'npm.cmd' `
    -ArgumentList @('run', 'start:dev') `
    -WorkingDirectory $backendPath `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logPath 'backend.log') `
    -RedirectStandardError (Join-Path $logPath 'backend-error.log')
}

if (-not (Test-Port 3000)) {
  Start-Process -FilePath 'npm.cmd' `
    -ArgumentList @('run', 'dev') `
    -WorkingDirectory $frontendPath `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logPath 'frontend.log') `
    -RedirectStandardError (Join-Path $logPath 'frontend-error.log')
}

$apiReady = $false
for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
  try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4000/api/health' -TimeoutSec 2
    if ($health.status -eq 'ok') {
      $apiReady = $true
      break
    }
  } catch {
    Start-Sleep -Seconds 1
  }
}

if (-not $apiReady) {
  throw "O backend não iniciou. Consulte $logPath\backend-error.log"
}

Write-Host 'Plataforma pronta:' -ForegroundColor Green
Write-Host '  Site: http://localhost:3000'
Write-Host '  API:  http://localhost:4000/api'
Write-Host "  Logs: $logPath"
