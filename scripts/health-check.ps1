<#
.SYNOPSIS
    ArgentinaRadar — Check health of all services
.DESCRIPTION
    Checks each service defined in the PM2 ecosystem plus Ollama.
    Reports status with color-coded output and returns exit code:
      0 — all healthy
      1 — one or more services down

    Services checked:
      news-ingestion (3001) — HTTP /health endpoint
      publisher      (3004) — HTTP /health endpoint
      notifier       (PM2)  — process status check (no HTTP)
      ai-processor   (3013) — HTTP /health endpoint
      admin          (3012) — HTTP /health endpoint
      web            (5173) — port open check
      Ollama         (11434) — HTTP API check

.EXAMPLE
    .\scripts\health-check.ps1
    .\scripts\health-check.ps1; if ($LASTEXITCODE -eq 0) { "All good" }
#>

param()

$ErrorActionPreference = "Stop"

# ─── Helpers ────────────────────────────────────────────────────────────

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
        $wait = $async.AsyncWaitHandle.WaitOne(2000)
        if ($wait) { $client.EndConnect($async); $client.Close(); return $true }
        $client.Close()
        return $false
    } catch {
        return $false
    }
}

function Test-HttpHealth($port, $path) {
    if (-not (Test-PortOpen $port)) {
        return $false
    }
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$port$path" -Method GET -TimeoutSec 3 -ErrorAction SilentlyContinue
        if ($resp.StatusCode -ne 200) { return $false }
        # Try to parse JSON and check status field
        try {
            $body = $resp.Content | ConvertFrom-Json
            return ($body.status -eq "ok" -or $null -eq $body.status)
        } catch {
            return $true  # No JSON body but 200 = healthy enough
        }
    } catch {
        return $false
    }
}

# ─── Main ───────────────────────────────────────────────────────────────
$allHealthy = $true

Write-Host @"

╔══════════════════════════════════════════════════════════════════════════╗
║    ArgentinaRadar — Health Check                                       ║
╚══════════════════════════════════════════════════════════════════════════╝
"@ -ForegroundColor Cyan
Write-Host ""

Write-Host "  ── PM2 Process Status ────────────────────────────────────" -ForegroundColor Cyan
try {
    $pm2jlist = pm2 jlist 2>$null
    if ($pm2jlist) {
        $apps = $pm2jlist | ConvertFrom-Json
        $ecosystemApps = @("news-ingestion", "publisher", "notifier", "ai-processor", "admin", "web")

        foreach ($appName in $ecosystemApps) {
            $app = $apps | Where-Object { $_.name -eq $appName }
            if ($app) {
                $status = $app.pm2_env.status
                $uptime = $app.pm2_env.uptime
                $mem = [math]::Round($app.monit.memory / 1MB, 1)
                $cpu = $app.monit.cpu

                if ($uptime) {
                    $uptimeSeconds = [math]::Floor((Get-Date).Subtract((Get-Date "1970-01-01Z").AddMilliseconds($uptime)).TotalSeconds)
                    $uptimeStr = if ($uptimeSeconds -gt 3600) {
                        "$([math]::Floor($uptimeSeconds/3600))h $([math]::Floor(($uptimeSeconds%3600)/60))m"
                    } elseif ($uptimeSeconds -gt 60) {
                        "$([math]::Floor($uptimeSeconds/60))m $($uptimeSeconds%60)s"
                    } else {
                        "${uptimeSeconds}s"
                    }
                } else {
                    $uptimeStr = "N/A"
                }

                if ($status -eq "online") {
                    Write-OK "$appName — online | uptime: $uptimeStr | mem: ${mem}MB | cpu: ${cpu}%"
                } else {
                    Write-Fail "$appName — $status | uptime: $uptimeStr | mem: ${mem}MB | cpu: ${cpu}%"
                    $allHealthy = $false
                }
            } else {
                Write-Fail "$appName — not found in PM2"
                $allHealthy = $false
            }
        }
    } else {
        Write-Fail "PM2 is not running — no processes to check"
        $allHealthy = $false
    }
} catch {
    Write-Fail "Could not read PM2 process list: $_"
    Write-Info "Make sure PM2 is installed: npm install -g pm2"
    $allHealthy = $false
}

Write-Host ""
Write-Host "  ── HTTP Endpoint Health ───────────────────────────────────" -ForegroundColor Cyan

# ─── news-ingestion (3001) ──────────────────────────────────────────────
$ni = Test-HttpHealth 3001 "/health"
if ($ni) { Write-OK "news-ingestion at http://127.0.0.1:3001/health" }
else { Write-Fail "news-ingestion at http://127.0.0.1:3001/health"; $allHealthy = $false }

# ─── publisher (3004) ──────────────────────────────────────────────────
$pub = Test-HttpHealth 3004 "/health"
if ($pub) { Write-OK "publisher at http://127.0.0.1:3004/health" }
else { Write-Fail "publisher at http://127.0.0.1:3004/health"; $allHealthy = $false }

# ─── ai-processor (3013) ────────────────────────────────────────────────
$ai = Test-HttpHealth 3013 "/health"
if ($ai) { Write-OK "ai-processor at http://127.0.0.1:3013/health" }
else { Write-Fail "ai-processor at http://127.0.0.1:3013/health"; $allHealthy = $false }

# ─── admin (3012) ───────────────────────────────────────────────────────
$adm = Test-HttpHealth 3012 "/health"
if ($adm) { Write-OK "admin at http://127.0.0.1:3012/health" }
else { Write-Fail "admin at http://127.0.0.1:3012/health"; $allHealthy = $false }

# ─── web (5173) — no /health endpoint, check port + any 200 response ──
$webPortOpen = Test-PortOpen 5173
if ($webPortOpen) {
    try {
        $webResp = Invoke-WebRequest -Uri "http://127.0.0.1:5173" -Method GET -TimeoutSec 3 -ErrorAction SilentlyContinue
        if ($webResp.StatusCode -eq 200) { Write-OK "web at http://127.0.0.1:5173" }
        else { Write-Fail "web at http://127.0.0.1:5173 (status $($webResp.StatusCode))"; $allHealthy = $false }
    } catch {
        Write-OK "web — port 5173 open (Vite server running)"
    }
} else {
    Write-Fail "web — port 5173 not open"
    $allHealthy = $false
}

# ─── notifier — no HTTP port, checked via PM2 above ─────────────────────
Write-Host ""
Write-Info "notifier — health determined by PM2 status above (no HTTP endpoint)"

Write-Host ""
Write-Host "  ── Dependencies ──────────────────────────────────────────" -ForegroundColor Cyan

# ─── Ollama (11434) ─────────────────────────────────────────────────────
try {
    $ollamaResp = Invoke-WebRequest -Uri "http://localhost:11434" -Method GET -TimeoutSec 3 -ErrorAction SilentlyContinue
    if ($ollamaResp) { Write-OK "Ollama at http://localhost:11434" }
    else { Write-Fail "Ollama at http://localhost:11434"; $allHealthy = $false }
} catch {
    Write-Fail "Ollama at http://localhost:11434"
    $allHealthy = $false
}

# ─── Summary ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ═══════════════════════════════════════════════════════════" -ForegroundColor $(if ($allHealthy) { "Green" } else { "Red" })
if ($allHealthy) {
    Write-Host "  ✅ All services healthy" -ForegroundColor Green
} else {
    Write-Host "  ❌ One or more services are down" -ForegroundColor Red
}
Write-Host "  ═══════════════════════════════════════════════════════════" -ForegroundColor $(if ($allHealthy) { "Green" } else { "Red" })
Write-Host ""

# Exit code
if (-not $allHealthy) { exit 1 }
exit 0
