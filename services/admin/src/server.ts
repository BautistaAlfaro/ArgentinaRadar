/**
 * Admin Dashboard Service — Express Server
 *
 * Provides REST API endpoints for KPIs, metrics, daily stats,
 * revenue tracking, and user management.
 *
 * Port: 3012 (configurable via ADMIN_PORT env var)
 *
 * Endpoints:
 *   GET   /api/admin/kpis?range=7d|30d|90d       — List of KPIs
 *   GET   /api/admin/kpis/summary                  — Current KPI summary
 *   POST  /api/admin/kpis/record                   — Record a new KPI (internal)
 *   GET   /api/admin/system-metrics?service=xxx    — System metrics
 *   GET   /api/admin/daily-stats?range=7d          — Daily aggregated stats
 *   GET   /api/admin/revenue                        — Financial metrics
 *   GET   /api/admin/users                          — Admin user list (ADMIN only)
 *   POST  /api/admin/subscription                   — Register a subscription
 *   GET   /api/admin/subscriptions                  — List subscriptions
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
import { config } from "./config.js";
import { requireAuth, requireAdmin } from "@argentinaradar/auth-middleware";
import { kpiRouter } from "./routes/kpis.js";
import { systemMetricsRouter } from "./routes/system-metrics.js";
import { dailyStatsRouter } from "./routes/daily-stats.js";
import { revenueRouter } from "./routes/revenue.js";
import { usersRouter } from "./routes/users.js";
import { subscriptionRouter } from "./routes/subscription.js";
import { startCollector } from "./collector.js";

const app = express();

// ─── Middleware ──────────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// ─── Global auth middleware (all /api/admin/* routes require auth + ADMIN) ─
const auth = requireAuth(config.jwtSecret);
const admin = requireAdmin();

// Apply auth + admin to all /api/admin routes
app.use("/api/admin", auth, admin);

// ─── Routes ─────────────────────────────────────────────────────────
app.use("/api/admin", kpiRouter);
app.use("/api/admin", systemMetricsRouter);
app.use("/api/admin", dailyStatsRouter);
app.use("/api/admin", revenueRouter);
app.use("/api/admin", usersRouter);
app.use("/api/admin", subscriptionRouter);

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
  console.log(`[admin]   GET  /health`);

  // Start the KPI collector
  startCollector();
});
