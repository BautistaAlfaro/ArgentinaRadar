<#
.SYNOPSIS
    ArgentinaRadar — Gracefully stop all PM2 services
.DESCRIPTION
    Stops every service defined in the PM2 ecosystem, then waits for all
    ports to be released before exiting.

.EXAMPLE
    .\scripts\stop-all.ps1
#>

param()

$ErrorActionPreference = "Stop"
$rootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

# ─── Helpers ────────────────────────────────────────────────────────────

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

function Test-PortOpen($port) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $async = $client.BeginConnect("127.0.0.1", $port, $null, $null)
        $wait = $async.AsyncWaitHandle.WaitOne(1000)
        if ($wait) { $client.EndConnect($async); $client.Close(); return $true }
        $client.Close()
        return $false
    } catch {
        return $false
    }
}

# ─── Services with HTTP ports (we wait for these to close) ──────────────
$PORTS = @(3001, 3004, 3013, 3012, 5173)

# ─── Header ─────────────────────────────────────────────────────────────
Clear-Host
Write-Host @"

╔══════════════════════════════════════════════════════════════════════════╗
║    ArgentinaRadar — PM2 Service Stopper                                ║
╚══════════════════════════════════════════════════════════════════════════╝
"@ -ForegroundColor Cyan
Write-Host ""

# ─── Step 1: Stop PM2 processes ─────────────────────────────────────────
Write-Host "  ── Stopping Services ──────────────────────────────────────" -ForegroundColor Cyan

$ecosystemPath = Join-Path $rootDir "ecosystem.config.cjs"
if (-not (Test-Path $ecosystemPath)) {
    Write-Fail "Ecosystem file not found at $ecosystemPath"
    Write-Info "Falling back to stopping all PM2 processes by name..."

    $appNames = @("news-ingestion", "publisher", "notifier", "ai-processor", "admin", "web")
    foreach ($name in $appNames) {
        try {
            pm2 stop $name 2>&1 | Out-Null
            Write-OK "Stopped $name"
        } catch {
            Write-Info "$name not running"
        }
    }
} else {
    Write-Step "Stopping all services via ecosystem..."
    try {
        $output = pm2 stop $ecosystemPath 2>&1
        Write-OK "Stop command issued for ecosystem"
        Write-Info ($output -join "`n")
    } catch {
        Write-Fail "pm2 stop failed: $_"
    }
}

# ─── Step 2: Verify PM2 status ──────────────────────────────────────────
Write-Host ""
Write-Step "Verifying PM2 process status..."
try {
    pm2 status
} catch {
    Write-Info "PM2 may not be running"
}

# ─── Step 3: Wait for ports to be released ──────────────────────────────
Write-Host ""
Write-Host "  ── Waiting for Ports ──────────────────────────────────────" -ForegroundColor Cyan
Write-Step "Waiting for ports to be released (up to 15s)..."

$allReleased = $false
for ($i = 1; $i -le 15; $i++) {
    $openPorts = @()
    foreach ($port in $PORTS) {
        if (Test-PortOpen $port) {
            $openPorts += $port
        }
    }

    if ($openPorts.Count -eq 0) {
        $allReleased = $true
        break
    }

    if ($i % 5 -eq 0 -or $i -eq 1) {
        Write-Info "Still waiting for ports: $($openPorts -join ', ')"
    }
    Start-Sleep -Seconds 1
}

# ─── Summary ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ═══════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  Shutdown complete!" -ForegroundColor Green
Write-Host "  ═══════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""

if ($allReleased) {
    Write-OK "All ports released"
} else {
    $stuckPorts = @($PORTS | Where-Object { Test-PortOpen $_ })
    Write-Fail "Ports still in use: $($stuckPorts -join ', ')"
    Write-Info "You may need to kill the processes manually:"
    foreach ($port in $stuckPorts) {
        Write-Info "  netstat -ano | findstr :$port"
    }
}

# ─── Step 4: Delete PM2 daemon (cleanup) ────────────────────────────────
try {
    $runningApps = pm2 jlist 2>$null | ConvertFrom-Json
    if ($null -eq $runningApps -or $runningApps.Count -eq 0) {
        pm2 kill 2>&1 | Out-Null
        Write-OK "PM2 daemon stopped (no running apps left)"
    }
} catch {
    # PM2 daemon might not be running — that's fine
}

Write-Host ""
