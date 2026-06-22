# ArgentinaRadar — Deployment Guide

## Overview

ArgentinaRadar is composed of multiple Node.js services, a Python AI processor,
and a Vite frontend, all orchestrated via [PM2](https://pm2.keymetrics.io/).

This document covers the production deployment process: pre-deploy checks,
start order, health verification, and rollback.

---

## Pre-Deploy Checks

Before deploying, run these checks on the target machine:

```bash
# 1. Node.js version
node --version        # must be >= 18 (ideally 22)

# 2. PM2 installed
npx pm2 --version     # should print version; if not, npm install -g pm2

# 3. Python venv for ai-processor
test -f services/ai-processor/.venv/bin/python \
  || echo "Missing venv — create it: cd services/ai-processor && python -m venv .venv"

# 4. Dependencies installed
npm ci                # clean install (respects lockfile)

# 5. Validate environment variables
diff <(grep -v '^#' config/.env.example | grep -v '^$' | cut -d= -f1 | sort) \
     <(grep -v '^#' config/.env | grep -v '^$' | cut -d= -f1 | sort)
# If this shows missing keys, add them to config/.env before proceeding.

# 6. TypeScript compiles
npx tsc --noEmit -p apps/web/tsconfig.json
```

### Environment File

All environment variables live in `config/.env`. A template with every variable
and its default is at `config/.env.example` and `.env.example` at the project
root.

**Required secrets that MUST be set in production:**

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Strong random string for auth tokens |
| `TELEGRAM_BOT_TOKEN` | Telegram bot API token |
| `TELEGRAM_CHAT_ID` | Target chat for notifications |
| `BSKY_APP_PASSWORD` | Bluesky app password |
| `OPENROUTER_API_KEY` | AI inference API key (if using OpenRouter) |

---

## Start Order

Services have inter-dependencies. Follow this order for a clean start:

```
  1. ai-processor (3013)   ← depends on: Ollama (11434)
  2. news-ingestion (3001)  ← depends on: ai-processor
  3. geolocation (3002)     ← depends on: news-ingestion
  4. event-detector (3008)  ← depends on: ai-processor
  5. twitter-publisher (3004) ← depends on: ai-processor, event-detector
  6. notifier (no HTTP)     ← depends on: Telegram API
  7. admin (3012)           ← depends on: event-detector, auth
  8. web (5173)             ← frontend (no downstream deps)
```

### Using PM2 (recommended)

```bash
# Start everything at once (PM2 respects the ecosystem config order)
.\scripts\pm2-start.ps1          # Windows
npx pm2 start ecosystem.config.cjs  # Any OS via npx

# Verify
npx pm2 status
```

### Manual start per service

```bash
# Python AI processor
cd services/ai-processor
.venv/bin/python -m uvicorn src.server:app --host 0.0.0.0 --port 3013

# Node.js services (each in its own terminal)
npx tsx --env-file=config/.env services/news-ingestion/src/index.ts
npx tsx --env-file=config/.env services/geolocation/src/server.ts
# ... etc
```

---

## Health Verification

After starting all services, confirm they are healthy:

```powershell
# Full health check (all services + Ollama)
.\scripts\health-check.ps1

# Individual checks
curl http://localhost:3001/health    # news-ingestion
curl http://localhost:3004/health    # publisher
curl http://localhost:3013/health    # ai-processor
curl http://localhost:3012/health    # admin
curl http://localhost:5173           # web (frontend)
```

Expected output for a healthy service:

```json
{ "status": "ok" }
```

### PM2 monitoring

```bash
npx pm2 status                    # process list
npx pm2 logs                      # live logs (all services)
npx pm2 logs news-ingestion       # single service logs
npx pm2 monit                     # resource monitor (CPU / memory)
```

---

## Rollback Plan

### Scenario A: New deployment is broken

```bash
# 1. Stop the current (broken) processes
.\scripts\pm2-stop.ps1

# 2. Revert code
git checkout <previous-stable-tag>

# 3. Restore node_modules to match reverted lockfile
npm ci

# 4. Restore environment (DO NOT roll back secrets — just check vars match)
# git checkout <previous-stable-tag> -- config/.env   # ONLY if .env is in git

# 5. Restart
.\scripts\pm2-start.ps1
.\scripts\health-check.ps1
```

### Scenario B: Single service is failing

```bash
# 1. Stop only the failing service
npx pm2 stop <service-name>

# 2. Check logs for root cause
npx pm2 logs <service-name> --lines 100

# 3. Fix the issue (config, env var, etc.) without redeploying

# 4. Restart the service
npx pm2 start <service-name>

# 5. Verify its health endpoint
```

### Scenario C: Database migration needs rollback

ArgentinaRadar uses SQLite (via Better-SQLite3). Before any migration:

```bash
# Back up the database
cp data/argentina-radar.db data/argentina-radar.db.$(date +%Y%m%d_%H%M%S).bak
```

To roll back:

```bash
# 1. Stop all services
.\scripts\pm2-stop.ps1

# 2. Restore database from backup
cp data/argentina-radar.db.<timestamp>.bak data/argentina-radar.db

# 3. Revert code to before migration
git checkout <commit-before-migration>

# 4. Restart
.\scripts\pm2-start.ps1
```

### Quick rollback reference

| Scenario | Stop | Revert | Restore deps | Restart |
|---|---|---|---|---|
| Code broken | All | `git checkout <tag>` | `npm ci` | `pm2-start` |
| Config wrong | Single | Edit config/.env | — | `pm2 restart <name>` |
| DB corrupted | All | Restore `.bak` | — | `pm2-start` |
| Dependency issue | All | `git checkout <tag>` | `npm ci` | `pm2-start` |

---

## Logs

All service logs are written to `logs/` in the project root:

```
logs/
├── news-ingestion-out.log
├── news-ingestion-err.log
├── publisher-out.log
├── publisher-err.log
├── notifier-out.log
├── notifier-err.log
├── ai-processor-out.log
├── ai-processor-err.log
├── admin-out.log
├── admin-err.log
└── web-out.log
└── web-err.log
```

Logs are rotated by PM2 (default: no rotation — configure [pm2-logrotate](https://github.com/keymetrics/pm2-logrotate) for production).

---

## Appendix: Service Port Map

| Service | Port | Type |
|---|---|---|
| news-ingestion | 3001 | HTTP |
| geolocation | 3002 | HTTP |
| twitter-publisher | 3004 | HTTP |
| hermes-bridge | 3005 | HTTP |
| economic-data | 3006 | HTTP |
| alerts | 3007 | HTTP |
| event-detector | 3008 | HTTP |
| trend-analyzer | 3009 | HTTP |
| auth | 3010 | HTTP |
| night-owl | 3011 | HTTP |
| admin | 3012 | HTTP |
| ai-processor | 3013 | HTTP |
| web (Vite) | 5173 | HTTP |
| notifier | — | Process only |
| Ollama | 11434 | HTTP (external) |
