$ErrorActionPreference = "Stop"

$workspace = Split-Path -Parent $MyInvocation.MyCommand.Path
$contracts = Join-Path $workspace "contracts-main"
$frontend = Join-Path $workspace "landing-page-main"

function Test-PortListening {
  param([int] $Port)
  return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

if (-not (Test-PortListening -Port 8545)) {
  Write-Host "Starting Hardhat node on http://127.0.0.1:8545"
  Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c", "npm run node > hardhat-node.log 2>&1" `
    -WorkingDirectory $contracts | Out-Null

  for ($i = 0; $i -lt 60 -and -not (Test-PortListening -Port 8545); $i++) {
    Start-Sleep -Seconds 1
  }
}

if (-not (Test-PortListening -Port 8545)) {
  throw "Hardhat node did not start on port 8545."
}

Write-Host "Deploying local demo contracts"
Push-Location $contracts
npm run deploy:local
Pop-Location

if (Test-PortListening -Port 3000) {
  Write-Host "Restarting Next.js on http://localhost:3000"
  Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
}

$nextCache = Join-Path $frontend ".next"
if (Test-Path -LiteralPath $nextCache) {
  Remove-Item -LiteralPath $nextCache -Recurse -Force
}

Write-Host "Starting Next.js on http://localhost:3000"
Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c", "set SKIP_ENV_VALIDATION=1&& npm run dev -- -p 3000 > next-dev.log 2>&1" `
  -WorkingDirectory $frontend | Out-Null

for ($i = 0; $i -lt 60 -and -not (Test-PortListening -Port 3000); $i++) {
  Start-Sleep -Seconds 1
}

if (-not (Test-PortListening -Port 3000)) {
  throw "Next.js did not start on port 3000."
}

Write-Host ""
Write-Host "Local settlement demo is running:"
Write-Host "  Frontend: http://localhost:3000"
Write-Host "  Hardhat:  http://127.0.0.1:8545"
Write-Host ""
Write-Host "Use the local demo wallet button, or connect MetaMask to chain 31337."
