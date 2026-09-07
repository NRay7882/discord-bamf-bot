# schedule-setup.ps1 - register a Windows Scheduled Task that polls for new
# commits and deploys them by running update.ps1 on a fixed interval.
#
# This is the deploy trigger for a home server with no inbound ports: instead of
# GitHub reaching in, the box checks GitHub on a schedule. update.ps1 is
# idempotent - it fast-forwards the branch and only restarts/redeploys when
# something actually changed - so a poll that finds nothing new does nothing.
#
# Run this ONCE per environment, from that environment's working copy:
#
#   .\scripts\schedule-setup.ps1                       # PROD, every 30 min
#   .\scripts\schedule-setup.ps1 -Env dev              # DEV,  every 30 min
#   .\scripts\schedule-setup.ps1 -Env dev -IntervalMinutes 15
#   .\scripts\schedule-setup.ps1 -Env dev -Remove      # unregister the dev task
#
# The task runs as the current user with S4U logon, so it runs whether or not
# you are signed in and needs no stored password. It relies on `git pull` working
# non-interactively - make sure your credentials are cached (HTTPS credential
# manager or a PAT via a git credential helper) so an unattended pull succeeds.
# Each run appends output to logs\update-<env>.log (gitignored).

[CmdletBinding()]
param(
  [Alias('Env')]
  [ValidateSet('prod', 'dev')]
  [string]$Environment = 'prod',
  [int]$IntervalMinutes = 30,
  [switch]$Remove
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$taskName = "BamfBot-Update-$Environment"

function Fail($message) {
  Write-Host "  ERROR: $message" -ForegroundColor Red
  exit 1
}

if ($Remove) {
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed scheduled task '$taskName'." -ForegroundColor Green
  } else {
    Write-Host "No scheduled task named '$taskName' to remove." -ForegroundColor Yellow
  }
  exit 0
}

if ($IntervalMinutes -lt 1) { Fail "IntervalMinutes must be at least 1." }

Write-Host "BamfBot schedule setup [$Environment] - every $IntervalMinutes min" -ForegroundColor Cyan

# Prefer PowerShell 7 (pwsh) if present; fall back to Windows PowerShell.
$shell = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
if (-not $shell) { $shell = (Get-Command powershell -ErrorAction SilentlyContinue).Source }
if (-not $shell) { Fail "No PowerShell executable found on PATH." }

$updateScript = Join-Path $repoRoot "scripts\update.ps1"
if (-not (Test-Path $updateScript)) { Fail "update.ps1 not found next to this script." }

# Keep unattended output for debugging. logs\ is gitignored.
$logDir = Join-Path $repoRoot "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logFile = Join-Path $logDir "update-$Environment.log"

# Run update.ps1 for this env and append all streams to the env's log.
$command = "& '$updateScript' -Env $Environment *>> '$logFile'"
$argument = "-NoProfile -ExecutionPolicy Bypass -Command `"$command`""

$action = New-ScheduledTaskAction -Execute $shell -Argument $argument -WorkingDirectory $repoRoot

# Fire shortly after registration, then repeat forever on the interval. A -Once
# trigger with a repetition interval and no duration repeats indefinitely.
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)

# S4U: run whether or not the user is logged on, without storing a password.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U

# StartWhenAvailable catches up a missed run (e.g. after a reboot); IgnoreNew
# stops a slow run from overlapping the next tick; cap runaway at 20 min.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Force | Out-Null

Write-Host "`nRegistered scheduled task '$taskName'." -ForegroundColor Green
Write-Host "  It runs update.ps1 -Env $Environment every $IntervalMinutes minutes." -ForegroundColor Green
Write-Host "  Log:   $logFile" -ForegroundColor Green
Write-Host "  Check: Get-ScheduledTask -TaskName '$taskName'" -ForegroundColor Green
Write-Host "  Run now: Start-ScheduledTask -TaskName '$taskName'" -ForegroundColor Green
