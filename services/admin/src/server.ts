/**
 * Admin Dashboard Service — Express Server
 *
 * Provides REST API endpoints for KPIs, metrics, daily stats,
 * revenue tracking, user management, and pipeline monitoring.
 *
 * Port: 3012 (configurable via ADMIN_PORT env var)
 *
 * Pipeline Monitoring (public, no auth):
 *   GET   /api/pipeline/status                      — Rich pipeline monitoring with per-service stats
 *   GET   /api/admin/health                         — Comprehensive health dashboard
 *   GET   /api/admin/pipeline-status                 — Legacy pipeline status check
 *
 * Internal Endpoints (require auth + ADMIN):
 *   GET   /api/admin/kpis?range=7d|30d|90d          — List of KPIs
 *   GET   /api/admin/kpis/summary                   — Current KPI summary
 *   POST  /api/admin/kpis/record                    — Record a new KPI (internal)
 *   GET   /api/admin/system-metrics?service=xxx     — System metrics
 *   GET   /api/admin/daily-stats?range=7d           — Daily aggregated stats
 *   GET   /api/admin/revenue                        — Financial metrics
 *   GET   /api/admin/users                          — Admin user list (ADMIN only)
 *   POST  /api/admin/subscription                   — Register a subscription
 *   GET   /api/admin/subscriptions                  — List subscriptions
 *   GET   /api/admin/services                       — List service statuses (ADMIN)
 *   POST  /api/admin/services/:name/start           — Start a service via PM2 (ADMIN)
 *   POST  /api/admin/services/:name/stop            — Stop a service via PM2 (ADMIN)
 *   POST  /api/admin/services/start-all             — Start all services (ADMIN)
 *   POST  /api/admin/services/stop-all              — Stop all services (ADMIN)
 *
 *
 * Ecosystem Health (public, no auth):
 *   GET   /api/admin/health/all                     — Check all ecosystem services + Ollama
 *
 * Service Health:
 *   GET   /health                                   — Service health
 */

// ── Global error handlers (MUST be first) ───────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught Exception:', err?.message ?? String(err));
  console.error(err?.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled Rejection:', reason);
});

import express from "express";
import cors from "cors";
import net from "net";
import { exec } from "child_process";
import { config } from "./config.js";
import { requireAuth, requireAdmin } from "@argentinaradar/auth-middleware";
import { kpiRouter } from "./routes/kpis.js";
import { systemMetricsRouter } from "./routes/system-metrics.js";
import { dailyStatsRouter } from "./routes/daily-stats.js";
import { revenueRouter } from "./routes/revenue.js";
import { usersRouter } from "./routes/users.js";
import { subscriptionRouter } from "./routes/subscription.js";
import { servicesRouter } from "./routes/services.js";
import { sourcesRouter } from "./routes/sources.js";
import { actionsRouter } from "./routes/actions.js";
import { systemRouter } from "./routes/system.js";
import { pipelineRouter } from "./routes/pipeline.js";
import { startCollector } from "./collector.js";

const app = express();

// ─── Middleware ──────────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// ─── Public pipeline-status endpoints (no auth) ────────────────────
// Placed before auth middleware so they're available without credentials.

/** Service health-check definitions for pipeline monitoring. */
interface PipelineServiceDef {
  name: string;
  displayName: string;
  url: string;
  /** Path to extract from /health response for daily stats. */
  statsPath: string[];
}

const PIPELINE_SERVICES: PipelineServiceDef[] = [
  { name: 'rss',            displayName: 'News Ingestion',  url: config.newsServiceUrl,         statsPath: ['articles', 'total'] },
  { name: 'geolocation',    displayName: 'Geolocation',     url: config.geolocationUrl,         statsPath: [] },
  { name: 'ai',             displayName: 'AI Processor',    url: config.aiProcessorUrl,          statsPath: [] },
  { name: 'events',         displayName: 'Event Detector',  url: config.eventDetectorUrl,        statsPath: ['eventCount'] },
  { name: 'bluesky',        displayName: 'Twitter Publisher', url: config.twitterPublisherUrl,    statsPath: ['quota', 'dailyUsed'] },
];

// ─── GET /api/admin/pipeline-status (legacy, simple) ──────────────

app.get('/api/admin/pipeline-status', async (_req, res) => {
  const statuses: Record<string, string> = {};

  for (const svc of PIPELINE_SERVICES) {
    try {
      const resp = await fetch(`${svc.url}/health`, { 
        signal: AbortSignal.timeout(10_000),
      });
      const text = await resp.text();
      let ok = resp.ok;
      if (ok && text) {
        try { ok = JSON.parse(text)?.status === 'ok'; } catch { /* keep resp.ok */ }
      }
      statuses[svc.name] = ok ? 'ok' : `degraded (${resp.status})`;
    } catch (err) {
      statuses[svc.name] = 'down';
      console.warn(`[pipeline-status] ${svc.name}: ${(err as Error).message}`);
    }
  }

  res.json(statuses);
});

// ─── GET /api/pipeline/status (rich pipeline monitoring) ──────────

interface PipelineServiceHealth {
  status: string;
  uptime?: number;
  [key: string]: unknown;
}

app.get('/api/pipeline/status', async (_req, res) => {
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  type PipelineStatus = Record<string, {
    status: string;
    articles_today?: number;
    last_fetch?: string;
    processed?: number;
    cost_today?: number;
    events_created?: number;
    posts_today?: number;
    uptime?: number;
    error?: string;
  }>;

  const result: PipelineStatus = {};

  for (const svc of PIPELINE_SERVICES) {
    const entry: PipelineStatus[string] = { status: 'unknown' };

    try {
      const resp = await fetch(`${svc.url}/health`, {
        signal: AbortSignal.timeout(8_000),
      });

      if (!resp.ok) {
        entry.status = `degraded (${resp.status})`;
        result[svc.name] = entry;
        continue;
      }

      const body = await resp.json() as PipelineServiceHealth;
      entry.status = body.status === 'ok' ? 'ok' : body.status ?? 'ok';
      if (body.uptime != null) entry.uptime = body.uptime;

      // Extract per-service rich stats from the health response
      switch (svc.name) {
        case 'rss': {
          const typed = body as PipelineServiceHealth & { lastRun?: string; ingestionCount?: number; articles?: { total?: number } };
          entry.articles_today = typed.articles?.total ?? 0;
          entry.last_fetch = typed.lastRun
            ? formatTimeAgo(typed.lastRun)
            : 'never';
          break;
        }

        case 'ai': {
          const typed = body as PipelineServiceHealth & { budget_cap_exceeded?: boolean };
          // Try to get cost from /api/costs endpoint
          try {
            const costsResp = await fetch(`${config.aiProcessorUrl}/api/costs`, {
              signal: AbortSignal.timeout(5_000),
            });
            if (costsResp.ok) {
              const costsData = await costsResp.json() as { total_cost?: number; daily_cost?: number };
              entry.cost_today = costsData.daily_cost ?? costsData.total_cost ?? 0;
            }
          } catch {
            entry.cost_today = 0;
          }
          break;
        }

        case 'events': {
          const typed = body as PipelineServiceHealth & { eventCount?: number };
          entry.events_created = typed.eventCount ?? 0;
          break;
        }

        case 'bluesky': {
          const typed = body as PipelineServiceHealth & { quota?: { dailyUsed?: number } };
          entry.posts_today = typed.quota?.dailyUsed ?? 0;
          break;
        }
      }
    } catch (err) {
      entry.status = 'down';
      entry.error = (err as Error).message;
    }

    result[svc.name] = entry;
  }

  res.json({
    pipeline: result,
    timestamp: now.toISOString(),
    today,
  });
});

// ─── GET /api/admin/health (comprehensive health dashboard) ───────

app.get('/api/admin/health', async (_req, res) => {
  const results: Record<string, unknown> = {};
  let allOk = true;

  for (const svc of PIPELINE_SERVICES) {
    try {
      const resp = await fetch(`${svc.url}/health`, {
        signal: AbortSignal.timeout(8_000),
      });
      const body = resp.ok ? await resp.json() as PipelineServiceHealth : null;
      const serviceOk = resp.ok && body?.status === 'ok';
      if (!serviceOk) allOk = false;

      results[svc.name] = {
        status: serviceOk ? 'running' : 'degraded',
        httpStatus: resp.status,
        uptime: body?.uptime ?? null,
        healthy: serviceOk,
      };
    } catch (err) {
      allOk = false;
      results[svc.name] = {
        status: 'down',
        healthy: false,
        error: (err as Error).message,
      };
    }
  }

  // Build today's rollup stats by querying individual service endpoints
  let articlesToday = 0;
  let postsToday = 0;
  let eventsCreated = 0;

  try {
    const rssHealth = await fetch(`${config.newsServiceUrl}/api/news?limit=1`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (rssHealth.ok) {
      const rssData = await rssHealth.json() as { total?: number };
      articlesToday = rssData.total ?? 0;
    }
  } catch { /* ignore */ }

  try {
    const eventResp = await fetch(`${config.eventDetectorUrl}/api/events?limit=1`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (eventResp.ok) {
      const eventData = await eventResp.json() as { pagination?: { total?: number } };
      eventsCreated = eventData.pagination?.total ?? 0;
    }
  } catch { /* ignore */ }

  try {
    const bskyResp = await fetch(`${config.twitterPublisherUrl}/api/stats/daily`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (bskyResp.ok) {
      const bskyData = await bskyResp.json() as { postedToday?: number };
      postsToday = bskyData.postedToday ?? 0;
    }
  } catch { /* ignore */ }

  res.json({
    status: allOk ? 'ok' : 'degraded',
    service: 'admin-dashboard',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    services: results,
    today: {
      articlesIngested: articlesToday,
      eventsCreated,
      postsPublished: postsToday,
    },
    healthyCount: Object.values(results).filter((r: unknown) => (r as { healthy?: boolean }).healthy).length,
    totalCount: PIPELINE_SERVICES.length,
  });
});

// ─── GET /api/admin/health/all ──────────────────────────────────────
// Checks ALL ecosystem services (the 6 defined in ecosystem.config.cjs)
// plus Ollama, using HTTP health endpoints where available and PM2 status
// for non-HTTP services (e.g., notifier).

interface EcosystemServiceHealth {
  name: string;
  status: 'running' | 'stopped' | 'down' | 'degraded';
  port?: number | null;
  uptime?: number | null;
  error?: string;
}

const ECOSYSTEM_SERVICE_PORTS: Record<string, number | null> = {
  'news-ingestion': 3001,
  'publisher': 3004,
  'notifier': null, // no HTTP endpoint — checked via PM2
  'ai-processor': 3013,
  'admin': 3012,
  'web': 5173,
};

app.get('/api/admin/health/all', async (_req, res) => {
  const services: EcosystemServiceHealth[] = [];
  const errors: string[] = [];

  // 1. Check HTTP services via /health endpoint
  const httpServices = Object.entries(ECOSYSTEM_SERVICE_PORTS)
    .filter(([, port]) => port !== null) as [string, number][];

  const httpResults = await Promise.allSettled(
    httpServices.map(async ([name, port]) => {
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(5_000),
        });

        if (resp.ok) {
          const body = await resp.json() as { status?: string; uptime?: number };
          services.push({
            name,
            status: body.status === 'ok' ? 'running' : 'degraded',
            port,
            uptime: body.uptime ?? null,
          });
        } else {
          services.push({ name, status: 'degraded', port, error: `HTTP ${resp.status}` });
        }
      } catch (err) {
        // Fallback: port might be open even without a /health endpoint (e.g., web/Vite)
        try {
          const socketCheck = await new Promise<boolean>((resolve) => {
            const socket = new net.Socket();
            socket.setTimeout(2_000);
            socket.on('connect', () => { socket.destroy(); resolve(true); });
            socket.on('error', () => { socket.destroy(); resolve(false); });
            socket.on('timeout', () => { socket.destroy(); resolve(false); });
            socket.connect(port, '127.0.0.1');
          });

          if (socketCheck) {
            services.push({
              name,
              status: 'running',
              port,
              uptime: null,
            });
          } else {
            services.push({
              name,
              status: 'down',
              port,
              error: (err as Error).message,
            });
          }
        } catch {
          services.push({
            name,
            status: 'down',
            port,
            error: (err as Error).message,
          });
        }
      }
    }),
  );

  for (const result of httpResults) {
    if (result.status === 'rejected') {
      errors.push(result.reason?.message ?? 'Unknown error');
    }
  }

  // 2. Check notifier via PM2 jlist (no HTTP endpoint)
  try {
    const pm2Status = await new Promise<string>((resolve, reject) => {
      exec('pm2 jlist', { cwd: process.cwd(), shell: 'cmd.exe', timeout: 5_000 }, (err, stdout) => {
        if (err) { reject(err); return; }
        resolve(stdout);
      });
    });

    const pm2Apps = JSON.parse(pm2Status) as Array<{ name: string; pm2_env?: { status?: string; uptime?: number }; monit?: { memory?: number; cpu?: number } }>;
    const notifierApp = pm2Apps.find((a) => a.name === 'notifier');

    if (notifierApp) {
      services.push({
        name: 'notifier',
        status: notifierApp.pm2_env?.status === 'online' ? 'running' : 'stopped',
        port: null,
        uptime: notifierApp.pm2_env?.uptime ?? null,
      });
    } else {
      services.push({
        name: 'notifier',
        status: 'down',
        port: null,
        error: 'Not found in PM2 process list',
      });
    }
  } catch (err) {
    services.push({
      name: 'notifier',
      status: 'down',
      port: null,
      error: (err as Error).message,
    });
    errors.push(`PM2 jlist failed: ${(err as Error).message}`);
  }

  // 3. Check Ollama
  try {
    const ollamaResp = await fetch('http://127.0.0.1:11434', {
      signal: AbortSignal.timeout(3_000),
    });
    services.push({
      name: 'ollama',
      status: ollamaResp.ok ? 'running' : 'degraded',
      port: 11434,
    });
  } catch (err) {
    services.push({
      name: 'ollama',
      status: 'down',
      port: 11434,
      error: (err as Error).message,
    });
  }

  // 4. Build response
  const healthyCount = services.filter((s) => s.status === 'running').length;
  const totalCount = services.length;

  res.json({
    status: healthyCount === totalCount ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    healthyCount,
    totalCount,
    services,
    errors: errors.length > 0 ? errors : undefined,
  });
});

// ─── Helper: format a timestamp as a human-friendly relative string ─

function formatTimeAgo(isoString: string): string {
  const ms = Date.now() - new Date(isoString).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── Global auth middleware (all /api/admin/* routes require auth + ADMIN) ─
// In development mode, skip auth so the dashboard works without token
if (process.env.NODE_ENV !== 'development') {
  const auth = requireAuth(config.jwtSecret);
  const admin = requireAdmin();
  app.use("/api/admin", auth, admin);
  console.log('[admin] Auth middleware enabled');
} else {
  console.log('[admin] ⚠️  DEV MODE — auth middleware disabled');
}

// ─── Routes ─────────────────────────────────────────────────────────
app.use("/api/admin", kpiRouter);
app.use("/api/admin", systemMetricsRouter);
app.use("/api/admin", dailyStatsRouter);
app.use("/api/admin", revenueRouter);
app.use("/api/admin", usersRouter);
app.use("/api/admin", subscriptionRouter);
app.use("/api/admin", servicesRouter);
app.use("/api/admin", sourcesRouter);
app.use("/api/admin", actionsRouter);
app.use("/api/admin", systemRouter);
app.use("/api/pipeline", pipelineRouter);

// ─── Health ─────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "admin-dashboard",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ─── Start ──────────────────────────────────────────────────────────
app.listen(config.port, () => {
  console.log(`[admin] Dashboard Service listening on http://localhost:${config.port}`);
  console.log(`[admin]   GET  /api/admin/kpis?range=7d|30d|90d`);
  console.log(`[admin]   GET  /api/admin/kpis/summary`);
  console.log(`[admin]   POST /api/admin/kpis/record`);
  console.log(`[admin]   GET  /api/admin/system-metrics?service=xxx&range=24h`);
  console.log(`[admin]   GET  /api/admin/daily-stats?range=7d`);
  console.log(`[admin]   GET  /api/admin/revenue`);
  console.log(`[admin]   GET  /api/admin/users`);
  console.log(`[admin]   POST /api/admin/subscription`);
  console.log(`[admin]   GET  /api/admin/subscriptions`);
  console.log(`[admin]   GET  /api/admin/services`);
  console.log(`[admin]   POST /api/admin/services/:name/start`);
  console.log(`[admin]   POST /api/admin/services/:name/stop`);
  console.log(`[admin]   POST /api/admin/services/start-all`);
  console.log(`[admin]   POST /api/admin/services/stop-all`);
  console.log(`[admin]   GET  /api/admin/pipeline-status`);
  console.log(`[admin]   GET  /api/pipeline/status              — Rich pipeline monitoring`);
  console.log(`[admin]   GET  /api/pipeline/approval-queue      — List queue items`);
  console.log(`[admin]   POST /api/pipeline/approve-batch       — Approve or reject items`);
  console.log(`[admin]   POST /api/pipeline/publish-batch       — Mark approved items published`);
  console.log(`[admin]   GET  /api/pipeline/batches             — Batch summary list`);
  console.log(`[admin]   GET  /api/admin/health        — Comprehensive health dashboard`);
  console.log(`[admin]   GET  /api/admin/health/all    — Ecosystem health (all services + Ollama)`);
  console.log(`[admin]   ├── Control Center Actions (ADMIN):`);
  console.log(`[admin]   POST /api/admin/actions/refresh-rss    — Trigger RSS refresh`);
  console.log(`[admin]   POST /api/admin/actions/auto-approve   — Auto-approve all pending`);
  console.log(`[admin]   POST /api/admin/actions/reprocess      — Reprocess batch`);
  console.log(`[admin]   POST /api/admin/actions/backup         — Trigger DB backup`);
  console.log(`[admin]   POST /api/admin/actions/cleanup        — Trigger cleanup`);
  console.log(`[admin]   POST /api/admin/actions/restart/:svc   — Restart a service via PM2`);
  console.log(`[admin]   GET  /api/admin/system-info            — System CPU/RAM/uptime`);
  console.log(`[admin]   GET  /health                  — Service health`);
  console.log(`[admin]   ├── Source Management (ADMIN):`);
  console.log(`[admin]   GET    /api/admin/sources     — List sources with stats`);
  console.log(`[admin]   POST   /api/admin/sources     — Add a new source`);
  console.log(`[admin]   DELETE /api/admin/sources/:name  — Remove a source`);
  console.log(`[admin]   PATCH  /api/admin/sources/:name  — Toggle source enable/disable`);

  // Start the KPI collector
  startCollector();
});
