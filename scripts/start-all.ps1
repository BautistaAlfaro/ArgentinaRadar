<#
.SYNOPSIS
    ArgentinaRadar — Start all pipeline services
.DESCRIPTION
    Starts every service in the ArgentinaRadar pipeline in the correct
    dependency order. Each service is launched in its own PowerShell
    window so logs remain visible and independent.

    Order:
      1. news-ingestion  (3001) — RSS/ scraping
      2. geolocation     (3002) — location extraction
      3. ai-processor    (3013) — NER + embeddings
      4. event-detector  (3008) — event clustering
      5. twitter-publisher (3004) — Bluesky + Twitter
      6. hermes-bridge   (3005) — Telegram bot
      7. alerts          (3007) — weather, earthquakes
      8. economic-data   (3006) — dólar, MERVAL

    Use Ctrl+C in the orchestrator to stop all, or close each window.
.PARAMETER NoOrchestrator
    Skip the TypeScript orchestrator and launch raw service processes instead.
.PARAMETER OrchestratorOnly
    Only launch the orchestrator (no raw processes).
.EXAMPLE
    .\scripts\start-all.ps1
.EXAMPLE
    .\scripts\start-all.ps1 -NoOrchestrator
#>

param(
    [switch]$NoOrchestrator,
    [switch]$OrchestratorOnly
)

# ─── Helper function ──────────────────────────────────────────────────
function Start-ServiceWindow {
    param(
        [string]$Title,
        [string]$Command,
        [string]$WorkingDir,
        [int]$Port
    )
    $logPrefix = "[$Title]"

    Write-Host "  🚀 Starting $Title on port $Port..."

    # Start in a new PowerShell window
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "powershell.exe"
    $psi.Arguments = "-NoExit -Command `"cd '$WorkingDir'; $Command`""
    $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Normal
    $psi.UseShellExecute = $true

    try {
        $proc = [System.Diagnostics.Process]::Start($psi)
        Write-Host "  ✓ $Title started (PID: $($proc.Id))"
        return $proc
    } catch {
        Write-Host "  ✗ Failed to start $Title : $_" -ForegroundColor Red
        return $null
    }
}

# ─── Header ────────────────────────────────────────────────────────────
Clear-Host
Write-Host @"

████████████████████████████████████████████████████████████████████████████
  ArgentinaRadar — Pipeline Launcher
████████████████████████████████████████████████████████████████████████████

"@ -ForegroundColor Cyan

$rootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Write-Host "  Project root: $rootDir"
Write-Host "  Mode:         $(if ($OrchestratorOnly) { 'Orchestrator only' } elseif ($NoOrchestrator) { 'Raw processes' } else { 'Full pipeline' })"
Write-Host ""

# ─── 1. Orchestrator (TypeScript) — handles all services ──────────────
if (-not $NoOrchestrator) {
    Write-Host ""
    Write-Host "  ─────────────────────────────────────────────────────" -ForegroundColor Yellow
    Write-Host "  Starting TypeScript Orchestrator..."                   -ForegroundColor Yellow
    Write-Host "  ─────────────────────────────────────────────────────" -ForegroundColor Yellow

    $orchestratorDir = Join-Path $rootDir "apps/automation"
    Start-Process powershell -WindowStyle Normal -ArgumentList @"
-NoExit -Command "cd '$orchestratorDir'; Write-Host '[orchestrator] Pipeline Orchestrator' -ForegroundColor Cyan; npx tsx src/orchestrator.ts"
"@

    Write-Host "  ✓ Orchestrator launched in a new window" -ForegroundColor Green
    Write-Host "  ⏳ Wait for health checks to complete..." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
}

# ─── 2. Raw processes (if OrchestratorOnly is not set) ────────────────
if (-not $OrchestratorOnly) {
    Write-Host ""
    Write-Host "  ─────────────────────────────────────────────────────" -ForegroundColor Yellow
    Write-Host "  Launching individual services..."                      -ForegroundColor Yellow
    Write-Host "  ─────────────────────────────────────────────────────" -ForegroundColor Yellow
    Write-Host ""

    $jobs = @()

    # ── news-ingestion (3001) ──────────────────────────────────────────
    $jobs += Start-ServiceWindow `
        -Title "news-ingestion" `
        -Port 3001 `
        -WorkingDir "$rootDir/services/news-ingestion" `
        -Command "npx tsx src/index.ts"

    Start-Sleep -Seconds 3

    # ── geolocation (3002) ─────────────────────────────────────────────
    $jobs += Start-ServiceWindow `
        -Title "geolocation" `
        -Port 3002 `
        -WorkingDir "$rootDir/services/geolocation" `
        -Command "npx tsx src/server.ts"

    Start-Sleep -Seconds 3

    # ── ai-processor (3013) ────────────────────────────────────────────
    $jobs += Start-ServiceWindow `
        -Title "ai-processor" `
        -Port 3013 `
        -WorkingDir "$rootDir/services/ai-processor" `
        -Command "python -m uvicorn src.server:app --host 0.0.0.0 --port 3013"

    Start-Sleep -Seconds 3

    # ── event-detector (3008) ──────────────────────────────────────────
    $jobs += Start-ServiceWindow `
        -Title "event-detector" `
        -Port 3008 `
        -WorkingDir "$rootDir/services/event-detector" `
        -Command "npx tsx src/server.ts"

    Start-Sleep -Seconds 3

    # ── twitter-publisher (3004) ──────────────────────────────────────
    $jobs += Start-ServiceWindow `
        -Title "twitter-publisher" `
        -Port 3004 `
        -WorkingDir "$rootDir/services/twitter-publisher" `
        -Command "npx tsx src/index.ts"

    Start-Sleep -Seconds 2

    # ── hermes-bridge (3005) ──────────────────────────────────────────
    $jobs += Start-ServiceWindow `
        -Title "hermes-bridge" `
        -Port 3005 `
        -WorkingDir "$rootDir/services/hermes-bridge" `
        -Command "python -m uvicorn src.server:app --host 0.0.0.0 --port 3005"

    Start-Sleep -Seconds 2

    # ── alerts (3007) ──────────────────────────────────────────────────
    $jobs += Start-ServiceWindow `
        -Title "alerts" `
        -Port 3007 `
        -WorkingDir "$rootDir/services/alerts" `
        -Command "npx tsx src/server.ts"

    Start-Sleep -Seconds 2

    # ── economic-data (3006) ───────────────────────────────────────────
    $jobs += Start-ServiceWindow `
        -Title "economic-data" `
        -Port 3006 `
        -WorkingDir "$rootDir/services/economic-data" `
        -Command "npx tsx src/server.ts"
}

# ─── Summary ───────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ═══════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  ✓ All services started!"                                    -ForegroundColor Green
Write-Host "  ═══════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "  📊 Pipeline status:  http://localhost:3012/api/pipeline/status"
Write-Host "  🏥 Admin health:     http://localhost:3012/api/admin/health"
Write-Host "  🌐 Frontend:         http://localhost:5173"
Write-Host "  🔧 Admin dashboard:  http://localhost:5173/admin"
Write-Host "  📰 News service:     http://localhost:3001"
Write-Host "  📍 Geolocation:      http://localhost:3002"
Write-Host "  🧠 AI Processor:     http://localhost:3013"
Write-Host "  ⚡ Event Detector:   http://localhost:3008"
Write-Host "  🐦 Publisher:        http://localhost:3004"
Write-Host "  🤖 Hermes Bridge:    http://localhost:3005"
Write-Host "  🔔 Alerts:           http://localhost:3007"
Write-Host "  💰 Economic Data:    http://localhost:3006"
Write-Host ""
Write-Host "  ℹ️  Close each PowerShell window to stop a service."
Write-Host "  ℹ️  Or use the orchestrator window and press Ctrl+C."
Write-Host ""

# Keep this window open so the user can see the output
if ($host.Name -eq "ConsoleHost") {
    Write-Host "  Press any key to close this window..." -ForegroundColor Gray
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}
