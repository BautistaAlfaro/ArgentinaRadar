<#
.SYNOPSIS
  ArgentinaRadar — Morning Briefing Scheduler
.DESCRIPTION
  Runs the morning-briefing.js script. Intended to be called by
  Windows Task Scheduler daily at 8:00 AM.

  Usage from Task Scheduler:
    Program: powershell.exe
    Arguments: -NoProfile -ExecutionPolicy Bypass -File "C:\path\to\schedule-briefing.ps1"

  Or from command line:
    .\scripts\schedule-briefing.ps1
#>

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$briefingScript = Join-Path $projectRoot "services\hermes-bridge\morning-briefing.js"

Write-Host "[schedule-briefing] Running morning briefing..." -ForegroundColor Cyan

try {
    $output = node $briefingScript 2>&1
    $exitCode = $LASTEXITCODE

    Write-Host $output

    if ($exitCode -eq 0) {
        Write-Host "[schedule-briefing] ✓ Briefing completed successfully" -ForegroundColor Green
    } else {
        Write-Host "[schedule-briefing] ✗ Briefing failed with exit code $exitCode" -ForegroundColor Red
    }
} catch {
    Write-Host "[schedule-briefing] ✗ Error: $_" -ForegroundColor Red
    exit 1
}

exit $exitCode
