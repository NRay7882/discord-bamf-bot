# update.ps1 - pull the latest BamfBot, then reload only what actually changed.
#
# Run it from an RDP session on the host whenever you want to take an update:
#
#   .\scripts\update.ps1            # pull, then restart/redeploy only if needed
#   .\scripts\update.ps1 -Global    # if commands changed, deploy them globally
#   .\scripts\update.ps1 -NoDeploy  # never touch Discord command registration
#   .\scripts\update.ps1 -Force     # restart even if nothing changed
#
# What it does, in order:
#   1. git pull (fast-forward only - aborts if the local tree has diverged).
#   2. If HEAD did not move and -Force was not given: stop, nothing to do.
#   3. Look at exactly which files changed between the old and new HEAD and:
#        - run `npm install`         only if the root lockfile changed
#        - re-deploy slash commands  only if a module manifest changed
#        - `pm2 restart all`         only if runtime code changed (docs-only
#                                    updates do not trigger a restart)
#
# Requires: git and pm2 on PATH. The deploy step reads secrets from the local
# .env file (see src/config.js) - no external tooling needed.

[CmdletBinding()]
param(
  [switch]$Global,    # deploy commands globally instead of guild-scoped
  [switch]$NoDeploy,  # skip command deployment even if manifests changed
  [switch]$Force      # restart even when nothing changed
)

$ErrorActionPreference = "Stop"

# Always operate from the repo root (this script lives in scripts/).
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Fail($message) {
  Write-Host "  ERROR: $message" -ForegroundColor Red
  exit 1
}

function Require-Command($name, $hint) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    Fail "'$name' is not on PATH. $hint"
  }
}

Write-Host "BamfBot update - $repoRoot" -ForegroundColor Cyan

Require-Command git  "Install Git and reopen the shell."
Require-Command pm2  "Install it with: npm install -g pm2"

# --- 1. Pull ---------------------------------------------------------------
$before = (git rev-parse HEAD).Trim()

Write-Host "`n[1/4] Pulling latest..." -ForegroundColor Cyan
git pull --ff-only
if ($LASTEXITCODE -ne 0) {
  Fail "git pull failed (local history may have diverged from the remote). Resolve it by hand, then re-run."
}

$after = (git rev-parse HEAD).Trim()

if ($before -eq $after -and -not $Force) {
  Write-Host "`nAlready up to date ($after). Nothing to restart." -ForegroundColor Green
  exit 0
}

# --- 2. Classify what changed ---------------------------------------------
if ($before -eq $after) {
  # -Force with no new commits: treat everything as "restart, deploy nothing".
  $changed = @()
  Write-Host "`n[2/4] No new commits; -Force given, restarting anyway." -ForegroundColor Yellow
} else {
  $changed = git diff --name-only $before $after | Where-Object { $_ }
  Write-Host "`n[2/4] Changed since ${before}:" -ForegroundColor Cyan
  $changed | ForEach-Object { Write-Host "        $_" }
}

$depsChanged     = $changed | Where-Object { $_ -match '^package-lock\.json$' }
$manifestChanged = $changed | Where-Object { $_ -match '^modules/.+/manifest\.json$' }
$moduleDeps      = $changed | Where-Object { $_ -match '^modules/.+/package(-lock)?\.json$' }

# Files that never require a bot restart when they are the only thing that moved.
$docPattern = '^(docs/|images/|README\.md|LICENSE|MODULE_SPEC\.md|\.gitattributes|\.gitignore|extras/)'
$runtimeChanged = $changed | Where-Object { $_ -notmatch $docPattern }
$needRestart = $Force -or ($runtimeChanged.Count -gt 0)

# --- 3. Dependencies -------------------------------------------------------
Write-Host "`n[3/4] Dependencies & commands..." -ForegroundColor Cyan

if ($depsChanged) {
  Write-Host "        root lockfile changed -> npm install"
  npm install
  if ($LASTEXITCODE -ne 0) { Fail "npm install failed." }
} else {
  Write-Host "        root dependencies unchanged - skipping npm install"
}

if ($moduleDeps) {
  Write-Host "        NOTE: a module's package.json changed. If that module has" -ForegroundColor Yellow
  Write-Host "        its own dependencies, install them in its folder manually." -ForegroundColor Yellow
  $moduleDeps | ForEach-Object { Write-Host "          $_" -ForegroundColor Yellow }
}

# Command (re)deployment - only when a manifest changed.
if ($manifestChanged -and -not $NoDeploy) {
  $scope = if ($Global) { "global" } else { "guild-scoped" }
  Write-Host "        manifest changed -> deploying slash commands ($scope)"
  if ($Global) {
    npm run deploy:global
  } else {
    npm run deploy
  }
  if ($LASTEXITCODE -ne 0) { Fail "Command deploy failed. The bot was NOT restarted; check .env and re-run." }
} elseif ($manifestChanged -and $NoDeploy) {
  Write-Host "        manifest changed but -NoDeploy set - skipping command deploy" -ForegroundColor Yellow
} else {
  Write-Host "        no manifest changes - skipping command deploy"
}

# --- 4. Restart ------------------------------------------------------------
Write-Host "`n[4/4] Restart..." -ForegroundColor Cyan

if ($needRestart) {
  pm2 restart all --update-env
  if ($LASTEXITCODE -ne 0) {
    Fail "pm2 restart failed. Is the process list running? Try: pm2 start ecosystem.config.cjs"
  }
  pm2 save | Out-Null
  Write-Host "`nUpdated to $after and restarted." -ForegroundColor Green
} else {
  Write-Host "        only docs/assets changed - no restart needed"
  Write-Host "`nUpdated to $after (docs only; bot left running)." -ForegroundColor Green
}
