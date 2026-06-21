<#
.SYNOPSIS
    ArgentinaRadar — Start all services via PM2 ecosystem
.DESCRIPTION
    Orchestrates the full service stack:
      1. Verifies/Starts Ollama (prerequisite for ai-processor)
      2. Checks Python venv for ai-processor
      3. Launches all 6 services via PM2 ecosystem.config.cjs
      4. Displays PM2 status table
      5. Runs health checks with timeout

    Services started (in ecosystem order):
      news-ingestion (3001) — RSS/scraping ingestion pipeline
      publisher      (3004) — Twitter/X publisher
      notifier       (N/A)  — Telegram bot (polling, no HTTP)
      ai-processor   (3013) — NER + embeddings via FastAPI
      admin          (3012) — Admin dashboard API
      web            (5173) — Vite frontend

.EXAMPLE
    .\scripts\start-all.ps1
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

function Test-OllamaRunning {
    try {
        $null = Invoke-WebRequest -Uri "http://localhost:11434" -Method GET -TimeoutSec 3 -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

function Test-PortOpen($port) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $async = $client.BeginConnect("127.0.0.1", $port, $null, $null)
        $wait = $async.AsyncWaitHandle.WaitOne(2000)
        if ($wait) { $client.EndConnect($async); $client.Close(); return $true }
        $client.Close()
        return $false
    } catch {
        return $false
    }
}

# ─── Header ─────────────────────────────────────────────────────────────
Clear-Host
Write-Host @"

╔══════════════════════════════════════════════════════════════════════════╗
║    ArgentinaRadar — PM2 Service Orchestrator                           ║
╚══════════════════════════════════════════════════════════════════════════╝
"@ -ForegroundColor Cyan

Write-Host "  Root: $rootDir"
Write-Host ""

# ─── Step 1: Check Ollama ───────────────────────────────────────────────
Write-Host "  ── Prerequisites ──────────────────────────────────────────" -ForegroundColor Cyan
Write-Step "Checking Ollama service..."

if (Test-OllamaRunning) {
    Write-OK "Ollama is running on http://localhost:11434"
} else {
    Write-Step "Ollama not running. Starting Ollama serve..."
    try {
        $ollamaProcess = Start-Process -FilePath "ollama.exe" -ArgumentList "serve" -NoNewWindow -PassThru -WindowStyle Hidden
        Write-OK "Ollama serve launched (PID: $($ollamaProcess.Id))"

        # Wait for the API to become available
        $maxWait = 15
        $ready = $false
        for ($i = 1; $i -le $maxWait; $i++) {
            Start-Sleep -Seconds 1
            if (Test-OllamaRunning) { $ready = $true; break }
        }

        if ($ready) {
            Write-OK "Ollama API ready at http://localhost:11434"
        } else {
            Write-Fail "Ollama did not respond within ${maxWait}s — check manually"
            Write-Info "You can still start services, but ai-processor may fail if it needs Ollama."
        }
    } catch {
        Write-Fail "Failed to start Ollama: $_"
        Write-Info "Proceeding anyway — ai-processor may fail if it depends on Ollama."
    }
}

# ─── Step 2: Check Python venv for ai-processor ─────────────────────────
Write-Step "Checking Python venv for ai-processor..."

$aiProcessorDir = Join-Path $rootDir "services/ai-processor"
$venvPaths = @(
    (Join-Path $aiProcessorDir ".venv/Scripts/python.exe"),
    (Join-Path $aiProcessorDir "venv/Scripts/python.exe")
)

$venvFound = $false
$pythonPath = $null
foreach ($vp in $venvPaths) {
    if (Test-Path $vp) {
        $venvFound = $true
        $pythonPath = $vp
        break
    }
}

if ($venvFound) {
    Write-OK "Python venv found at $pythonPath"
    Write-Info "ai-processor will use venv Python"
} else {
    Write-Fail "No Python venv found at services/ai-processor/.venv or ./venv"
    Write-Info "Create one: cd services/ai-processor; python -m venv .venv"
    Write-Info "Then: .venv/Scripts/pip install -r requirements.txt"
    Write-Info "Proceeding with system Python — may use wrong dependencies."
}

# Check if uvicorn is available
try {
    $uvicornCheck = & python -c "import uvicorn; print('ok')" 2>&1
    if ($uvicornCheck -eq "ok") {
        Write-OK "uvicorn is available in Python environment"
    } else {
        Write-Fail "uvicorn not found — run: pip install -r services/ai-processor/requirements.txt"
    }
} catch {
    Write-Fail "Python not found in PATH — ai-processor will fail to start"
}

Write-Host ""

# ─── Step 3: Start All PM2 Services ─────────────────────────────────────
Write-Host "  ── Starting Services ──────────────────────────────────────" -ForegroundColor Cyan
Write-Step "Launching all services via PM2 ecosystem..."

$ecosystemPath = Join-Path $rootDir "ecosystem.config.cjs"
if (-not (Test-Path $ecosystemPath)) {
    Write-Fail "Ecosystem file not found at $ecosystemPath"
    exit 1
}

try {
    $pm2Output = pm2 start $ecosystemPath 2>&1
    Write-OK "PM2 ecosystem started"
    if ($pm2Output) {
        Write-Info ($pm2Output -join "`n")
    }
} catch {
    Write-Fail "Failed to start PM2 ecosystem: $_"
    Write-Info "Make sure PM2 is installed: npm install -g pm2"
    exit 1
}

# Give services a moment to initialize
Start-Sleep -Seconds 3

# ─── Step 4: Show PM2 Status ────────────────────────────────────────────
Write-Host ""
Write-Host "  ── Service Status ─────────────────────────────────────────" -ForegroundColor Cyan
try {
    pm2 status
} catch {
    Write-Fail "Could not retrieve PM2 status"
}

Write-Host ""

# ─── Step 5: Health Checks ─────────────────────────────────────────────
Write-Host "  ── Health Checks ──────────────────────────────────────────" -ForegroundColor Cyan
Write-Step "Waiting for services to pass health checks..."

# Retry loop — up to 30s total
$healthChecks = @(
    @{ Name = "news-ingestion"; Port = 3001; HasHttp = $true }
    @{ Name = "publisher";      Port = 3004; HasHttp = $true }
    @{ Name = "notifier";       Port = $null; HasHttp = $false }
    @{ Name = "ai-processor";   Port = 3013; HasHttp = $true }
    @{ Name = "admin";          Port = 3012; HasHttp = $true }
    @{ Name = "web";            Port = 5173; HasHttp = $true }
)

$maxRetries = 15  # 15 * 2s = 30s total
$allHealthy = $false

for ($retry = 1; $retry -le $maxRetries; $retry++) {
    $healthyCount = 0
    $totalHttp = 0

    foreach ($svc in $healthChecks) {
        if (-not $svc.HasHttp) {
            $healthyCount++
            continue  # Skip notifier — no HTTP endpoint, just assume PM2 handles it
        }
        $totalHttp++
        if (Test-PortOpen $svc.Port) {
            try {
                $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$($svc.Port)/health" -Method GET -TimeoutSec 2 -ErrorAction SilentlyContinue
                if ($resp.StatusCode -eq 200) { $healthyCount++ }
            } catch {
                # Port open but /health not responding yet
            }
        }
    }

    if ($healthyCount -eq $totalHttp) {
        $allHealthy = $true
        break
    }

    if ($retry -eq $maxRetries) {
        Write-Fail "Some services did not become healthy within $($maxRetries * 2)s"
    } else {
        Start-Sleep -Seconds 2
    }
}

# ─── Summary ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ═══════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  Services launched!" -ForegroundColor Green
Write-Host "  ═══════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""

if ($allHealthy) {
    Write-OK "All HTTP services passed health checks"
} else {
    Write-Fail "Some services did not respond to health checks — run .\scripts\health-check.ps1 to diagnose"
}

Write-Host ""
Write-Host "  📊 Admin health:     http://localhost:3012/api/admin/health"
Write-Host "  📊 Health all:       http://localhost:3012/api/admin/health/all"
Write-Host "  🧠 AI Processor:     http://localhost:3013"
Write-Host "  🌐 Frontend:         http://localhost:5173"
Write-Host "  📰 News service:     http://localhost:3001"
Write-Host "  🐦 Publisher:        http://localhost:3004"
Write-Host "  🤖 Notifier:         PM2 process (no HTTP)"
Write-Host ""
Write-Host "  Commands:" -ForegroundColor Gray
Write-Host "    pm2 status                     — view all processes" -ForegroundColor Gray
Write-Host "    pm2 logs <name>                — tail logs for a service" -ForegroundColor Gray
Write-Host "    pm2 stop ecosystem.config.cjs  — stop all services" -ForegroundColor Gray
Write-Host "    .\scripts\stop-all.ps1          — graceful stop" -ForegroundColor Gray
Write-Host "    .\scripts\health-check.ps1       — check all services" -ForegroundColor Gray
Write-Host ""
