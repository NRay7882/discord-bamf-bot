# service-setup.ps1 - one-time setup to run BamfBot full-time under PM2 and
# have it auto-start when the Windows box boots.
#
# Run this ONCE, from an elevated (Run as Administrator) PowerShell on the host,
# after you have cloned the repo, run `npm install`, and created `.env`:
#
#   .\scripts\service-setup.ps1
#
# It will:
#   1. Verify Node and npm are present and .env exists with real values.
#   2. Install pm2 and pm2-windows-startup globally (if missing).
#   3. Start the core + modules from ecosystem.config.cjs.
#   4. Register PM2 to resurrect on boot and save the current process list.
#
# After this, use scripts\update.ps1 to take updates. Day-to-day:
#   pm2 status | pm2 logs | pm2 restart all

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Fail($message) {
  Write-Host "  ERROR: $message" -ForegroundColor Red
  exit 1
}

Write-Host "BamfBot service setup - $repoRoot" -ForegroundColor Cyan

# --- 1. Prerequisites ------------------------------------------------------
foreach ($cmd in @("node", "npm")) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Fail "'$cmd' is not on PATH. Install Node 24+ and reopen the shell."
  }
}
$envFile = Join-Path $repoRoot ".env"
if (-not (Test-Path $envFile)) {
  Fail ".env not found. Create it first:  copy .env.example .env  (then fill in real values)."
}
if (Select-String -Path $envFile -Pattern '^\s*DISCORD_TOKEN\s*=\s*(your-bot-token)?\s*$' -Quiet) {
  Fail ".env still has the placeholder DISCORD_TOKEN. Put the real bot token in .env before starting the service."
}

# --- 2. PM2 + startup helper ----------------------------------------------
Write-Host "`nInstalling pm2 and pm2-windows-startup (skips if already present)..." -ForegroundColor Cyan
if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
  npm install -g pm2
  if ($LASTEXITCODE -ne 0) { Fail "Failed to install pm2." }
}
npm install -g pm2-windows-startup
if ($LASTEXITCODE -ne 0) { Fail "Failed to install pm2-windows-startup." }

# --- 3. Start the processes -----------------------------------------------
Write-Host "`nStarting core + modules from ecosystem.config.cjs..." -ForegroundColor Cyan
pm2 start ecosystem.config.cjs
if ($LASTEXITCODE -ne 0) { Fail "pm2 start failed - check `pm2 logs`." }

# --- 4. Boot persistence ---------------------------------------------------
Write-Host "`nRegistering PM2 to start on boot..." -ForegroundColor Cyan
pm2-startup install
if ($LASTEXITCODE -ne 0) {
  Write-Host "  pm2-startup install returned non-zero. Re-run this script in an" -ForegroundColor Yellow
  Write-Host "  ELEVATED (Run as Administrator) PowerShell if boot-start didn't register." -ForegroundColor Yellow
}
pm2 save
if ($LASTEXITCODE -ne 0) { Fail "pm2 save failed." }

Write-Host "`nDone. BamfBot is running and set to start on boot." -ForegroundColor Green
Write-Host "  pm2 status        # see the processes" -ForegroundColor Green
Write-Host "  pm2 logs          # watch output" -ForegroundColor Green
Write-Host "  .\scripts\update.ps1   # take an update later" -ForegroundColor Green
