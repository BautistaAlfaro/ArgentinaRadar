<#
.SYNOPSIS
    ArgentinaRadar — Start all PM2 services from ecosystem.config.cjs
.DESCRIPTION
    Starts every service defined in the production PM2 ecosystem file.
    Checks prerequisites (PM2 availability) before launching.

    NOTE: This script is a focused PM2 launcher. For the full orchestrated
    startup (with Ollama checks, Python venv verification, and health polling),
    use start-all.ps1 instead.

.EXAMPLE
    .\scripts\pm2-start.ps1
#>

param()

$ErrorActionPreference = "Stop"
$rootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

# ─── Helpers ─────────────────────────────────────────────────────────────

function Write-Step($msg) {
    Write-Host "  → $msg" -ForegroundColor Yellow
}

function Write-OK($msg) {
    Write-Host "  ✓ $msg" -ForegroundColor Green
}

function Write-Fail($msg) {
    Write-Host "  ✗ $msg" -ForegroundColor Red
}

function Write-Info($msg) {
    Write-Host "    $msg" -ForegroundColor Gray
}

# ─── Confirm PM2 is available ────────────────────────────────────────────
Write-Host @"

╔══════════════════════════════════════════════════════════════════════════╗
║    ArgentinaRadar — PM2 Launcher                                       ║
╚══════════════════════════════════════════════════════════════════════════╝
"@ -ForegroundColor Cyan
Write-Host ""

Write-Step "Checking PM2 availability..."
try {
    $pm2Version = npx pm2 --version 2>$null
    if ($LASTEXITCODE -eq 0 -and $pm2Version) {
        Write-OK "PM2 version $($pm2Version.Trim())"
    } else {
        throw "PM2 not found"
    }
} catch {
    Write-Fail "PM2 is not installed or not available."
    Write-Info "Install it globally: npm install -g pm2"
    Write-Info "Or run via npx: npx pm2 start ecosystem.config.cjs"
    exit 1
}

# ─── Locate ecosystem file ──────────────────────────────────────────────
$ecosystemPath = Join-Path $rootDir "ecosystem.config.cjs"
if (-not (Test-Path $ecosystemPath)) {
    Write-Fail "Ecosystem file not found at $ecosystemPath"
    exit 1
}

# ─── Start all services ─────────────────────────────────────────────────
Write-Step "Starting all services via ecosystem..."
Write-Info "Config: $ecosystemPath"

try {
    $output = npx pm2 start $ecosystemPath 2>&1
    Write-OK "PM2 ecosystem started"
    if ($output) {
        Write-Info ($output -join "`n")
    }
} catch {
    Write-Fail "Failed to start PM2 ecosystem: $_"
    exit 1
}

# ─── Show status ─────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ── Status ─────────────────────────────────────────────────" -ForegroundColor Cyan
try {
    npx pm2 status
} catch {
    Write-Info "Could not retrieve PM2 status"
}

# ─── Summary ─────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ═══════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  Services launched!" -ForegroundColor Green
Write-Host "  ═══════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "  Quick commands:" -ForegroundColor Gray
Write-Host "    npx pm2 status                     — view processes" -ForegroundColor Gray
Write-Host "    npx pm2 logs                       — view all logs" -ForegroundColor Gray
Write-Host "    .\scripts\pm2-stop.ps1             — stop all services" -ForegroundColor Gray
Write-Host "    .\scripts\health-check.ps1         — health check" -ForegroundColor Gray
Write-Host ""
