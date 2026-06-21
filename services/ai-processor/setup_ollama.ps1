<#
.SYNOPSIS
    Install Ollama and pull models optimized for ArgentinaRadar's ai-processor.
.DESCRIPTION
    This script downloads and installs Ollama, then pulls the required models
    for local LLM inference on the ai-processor. Models are selected for
    RX 6700 XT 12GB VRAM + 32GB RAM + Ryzen 7.
.NOTES
    Run this script as Administrator. Restart your terminal after installation.
    The Ollama service must be running before starting ai-processor in local mode.
#>

$ErrorActionPreference = "Stop"

Write-Host "╔══════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   ArgentinaRadar — Ollama Setup              ║" -ForegroundColor Cyan
Write-Host "║   GPU: RX 6700 XT 12GB | RAM: 32GB | R7     ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Install Ollama ────────────────────────────────────────────────

$ollamaExe = Get-Command "ollama.exe" -ErrorAction SilentlyContinue

if (-not $ollamaExe) {
    Write-Host "→ Installing Ollama via winget..." -ForegroundColor Yellow
    try {
        winget install --id Ollama.Ollama --accept-source-agreements --accept-package-agreements
        if ($LASTEXITCODE -ne 0) {
            throw "winget install failed (exit code: $LASTEXITCODE)"
        }
        Write-Host "  ✓ Ollama installed." -ForegroundColor Green
    } catch {
        Write-Host "  ✗ winget install failed: $_" -ForegroundColor Red
        Write-Host "  → Download manually from https://ollama.com/download/windows" -ForegroundColor Yellow
        Write-Host "    then re-run this script." -ForegroundColor Yellow
        exit 1
    }
} else {
    Write-Host "→ Ollama already installed at: $($ollamaExe.Source)" -ForegroundColor Green
}

# Ensure ollama is in PATH for the rest of the script
$env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")

# ── Step 2: Start Ollama service ──────────────────────────────────────────

Write-Host ""
Write-Host "→ Ensuring Ollama service is running..." -ForegroundColor Yellow

# Check if ollama serve is already running (port 11434)
$ollamaRunning = $null
try {
    $ollamaRunning = Invoke-WebRequest -Uri "http://localhost:11434" -Method GET -TimeoutSec 3 -ErrorAction SilentlyContinue
} catch {}

if (-not $ollamaRunning) {
    Write-Host "  Starting Ollama in background..." -ForegroundColor Yellow

    # Start Ollama as a background process
    $ollamaProcess = Start-Process -FilePath "ollama.exe" -ArgumentList "serve" -NoNewWindow -PassThru -WindowStyle Hidden

    # Wait for the API to become available
    $maxWait = 15
    $waiting = 0
    $ready = $false
    while ($waiting -lt $maxWait) {
        Start-Sleep -Seconds 1
        $waiting++
        try {
            $check = Invoke-WebRequest -Uri "http://localhost:11434" -Method GET -TimeoutSec 2 -ErrorAction SilentlyContinue
            if ($check) {
                $ready = $true
                break
            }
        } catch {}
    }

    if ($ready) {
        Write-Host "  ✓ Ollama API ready at http://localhost:11434" -ForegroundColor Green
    } else {
        Write-Host "  ⚠  Ollama may not be ready yet. Continuing anyway..." -ForegroundColor Yellow
    }
} else {
    Write-Host "  ✓ Ollama already running at http://localhost:11434" -ForegroundColor Green
}

# ── Step 3: Pull models ───────────────────────────────────────────────────

$models = @(
    @{ Name = "gemma3:4b";       Purpose = "Fast classification, protest, security" },
    @{ Name = "qwen2.5:7b";      Purpose = "NER, sentiment, summaries, Spanish" },
    @{ Name = "nomic-embed-text"; Purpose = "Local embeddings (768d)" }
)

Write-Host ""
Write-Host "→ Pulling models (this will take a while depending on your internet)..." -ForegroundColor Yellow
Write-Host "  GPU: RX 6700 XT 12GB — all models fit comfortably in VRAM" -ForegroundColor DarkGray

foreach ($m in $models) {
    $name = $m.Name
    $purpose = $m.Purpose

    Write-Host ""
    Write-Host "  ── $name ($purpose) ──" -ForegroundColor Cyan

    # Check if model already exists
    $modelList = & ollama list 2>$null
    $alreadyPulled = $modelList -match [regex]::Escape($name)

    if ($alreadyPulled) {
        Write-Host "  ✓ Already pulled. Skipping." -ForegroundColor Green
    } else {
        Write-Host "  Pulling $name..." -ForegroundColor Yellow
        & ollama pull $name
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  ✓ $name pulled successfully." -ForegroundColor Green
        } else {
            Write-Host "  ✗ Failed to pull $name (exit code: $LASTEXITCODE)" -ForegroundColor Red
        }
    }
}

# ── Summary ───────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "╔══════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   Setup Complete                              ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Ollama models ready for ai-processor:" -ForegroundColor White

# Model sizes and VRAM estimates
Write-Host "    gemma3:4b        ~2.6GB  → Classification, filtering, routing" -ForegroundColor Gray
Write-Host "    qwen2.5:7b       ~4.5GB  → NER, sentiment, summaries, Spanish" -ForegroundColor Gray
Write-Host "    nomic-embed-text  ~0.3GB → Embeddings (768d)" -ForegroundColor Gray
Write-Host ""
Write-Host "  Total VRAM: ~7.4GB / 12GB — plenty of headroom" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  To start ai-processor in local mode:" -ForegroundColor Yellow
Write-Host "    1. Ensure ollama serve is running" -ForegroundColor White
Write-Host "    2. Set AI_MODE=local in your .env or PM2 config" -ForegroundColor White
Write-Host "    3. Start the service: npm start (or PM2)" -ForegroundColor White
Write-Host ""
Write-Host "  To verify Ollama is working:" -ForegroundColor Yellow
Write-Host "    curl http://localhost:11434/api/tags" -ForegroundColor White
