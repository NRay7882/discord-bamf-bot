# service-setup.ps1 - one-time setup to run BamfBot full-time under PM2 and
# have it auto-start when the Windows box boots.
#
# Run this ONCE per environment, from an elevated (Run as Administrator)
# PowerShell in that environment's working copy, after you have cloned the repo,
# run `npm install`, and created `.env`:
#
#   .\scripts\service-setup.ps1            # set up the PROD process set (bamf-*)
#   .\scripts\service-setup.ps1 -Env dev   # set up the DEV process set (bamf-dev-*)
#
# To run prod and dev side by side, use a separate working copy for each (a
# `git worktree` is ideal) so each has its own .env and data/ directory, and run
# this once in each. Both sets share one PM2 daemon; the name prefix and port
# offset (see ecosystem.config.cjs) keep them from colliding.
#
# It will:
#   1. Verify Node and npm are present and .env exists with real values.
#   2. Install pm2 and pm2-windows-startup globally (if missing).
#   3. Start this environment's core + modules from ecosystem.config.cjs.
#   4. Register PM2 to resurrect on boot and save the current process list.
#
# After this, use scripts\update.ps1 (-Env dev for the dev copy) to take updates.
# Day-to-day:  pm2 status | pm2 logs | pm2 restart <name>

[CmdletBinding()]
param(
  [Alias('Env')]
  [ValidateSet('prod', 'dev')]
  [string]$Environment = 'prod'  # which environment (process set) to set up
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

# Target this environment's PM2 process set + module port offset (ecosystem reads
# BAMF_ENV to pick the name prefix and ports).
$env:BAMF_ENV = $Environment

function Fail($message) {
  Write-Host "  ERROR: $message" -ForegroundColor Red
  exit 1
}

Write-Host "BamfBot service setup [$Environment] - $repoRoot" -ForegroundColor Cyan

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

$updateHint = if ($Environment -eq 'dev') { ".\scripts\update.ps1 -Env dev" } else { ".\scripts\update.ps1" }
Write-Host "`nDone. BamfBot [$Environment] is running and set to start on boot." -ForegroundColor Green
Write-Host "  pm2 status        # see the processes" -ForegroundColor Green
Write-Host "  pm2 logs          # watch output" -ForegroundColor Green
Write-Host "  $updateHint   # take an update later" -ForegroundColor Green
$scheduleHint = if ($Environment -eq 'dev') { ".\scripts\schedule-setup.ps1 -Env dev" } else { ".\scripts\schedule-setup.ps1" }
Write-Host "  $scheduleHint   # auto-poll for updates every 30 min (optional)" -ForegroundColor Green
