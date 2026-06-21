/**
 * Admin Dashboard — Action Routes
 *
 * Provides endpoints for administrative pipeline actions:
 *   POST /actions/refresh-rss     — Trigger RSS refresh
 *   POST /actions/auto-approve    — Approve all pending articles
 *   POST /actions/reprocess       — Reprocess a batch
 *   POST /actions/backup          — Trigger DB backup
 *   POST /actions/cleanup         — Trigger cleanup
 *   POST /actions/restart/:service — Restart a service via PM2
 *
 * All endpoints return { success: boolean, message: string }.
 * Auth is enforced by the parent router (ADMIN role required).
 */

import { Router } from "express";
import { exec } from "child_process";
import { config } from "../config.js";

export const actionsRouter = Router();

const PROJECT_ROOT = process.cwd();
const PM2_CONFIG_PATH = "config/pm2.config.cjs";

// ─── Helper: execute shell command ────────────────────────────────────

function execCmd(
  command: string,
  timeout = 30_000,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = exec(
      command,
      { cwd: PROJECT_ROOT, shell: "cmd.exe", timeout },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr.slice(0, 1000) || stdout.slice(0, 1000) || err.message));
        } else {
          resolve({ stdout: stdout.slice(0, 1000), stderr: stderr.slice(0, 500) });
        }
      },
    );

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn command: ${err.message}`));
    });
  });
}

// ─── Helper: fetch a pipeline service endpoint ────────────────────────

async function triggerServiceAction(
  url: string,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; message: string }> {
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });

    if (resp.ok) {
      const data = await resp.json().catch(() => ({}));
      return { ok: true, message: data.message ?? data.status ?? "Action completed" };
    }

    const text = await resp.text().catch(() => "Unknown error");
    return { ok: false, message: `HTTP ${resp.status}: ${text.slice(0, 200)}` };
  } catch (err) {
    return { ok: false, message: `Service unreachable: ${(err as Error).message}` };
  }
}

// ─── POST /api/admin/actions/refresh-rss ─────────────────────────────

actionsRouter.post("/actions/refresh-rss", async (_req, res) => {
  // Hit the news-ingestion service to trigger an RSS refresh
  const result = await triggerServiceAction(
    `${config.newsServiceUrl}/api/admin/actions/refresh`,
  );

  res.json({
    success: result.ok,
    message: result.ok
      ? "🔄 RSS refresh triggered successfully. Articles are being ingested."
      : `RSS refresh failed: ${result.message}`,
  });
});

// ─── POST /api/admin/actions/auto-approve ────────────────────────────

actionsRouter.post("/actions/auto-approve", async (_req, res) => {
  const result = await triggerServiceAction(
    `${config.newsServiceUrl}/api/admin/actions/auto-approve`,
  );

  res.json({
    success: result.ok,
    message: result.ok
      ? "⚡ All pending articles have been auto-approved and queued for publication."
      : `Auto-approve failed: ${result.message}`,
  });
});

// ─── POST /api/admin/actions/reprocess ───────────────────────────────

actionsRouter.post("/actions/reprocess", async (_req, res) => {
  const result = await triggerServiceAction(
    `${config.newsServiceUrl}/api/admin/actions/reprocess`,
  );

  res.json({
    success: result.ok,
    message: result.ok
      ? "🔄 Reprocess batch started. Articles are being re-evaluated."
      : `Reprocess failed: ${result.message}`,
  });
});

// ─── POST /api/admin/actions/backup ───────────────────────────────────

actionsRouter.post("/actions/backup", async (_req, res) => {
  try {
    // Run a pg_dump backup to the data directory
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFile = `data/backups/argentinaradar_${timestamp}.sql`;

    await execCmd(
      `pg_dump -h 127.0.0.1 -U postgres -d argentinaradar -f "${backupFile}"`,
      60_000,
    );

    res.json({
      success: true,
      message: `💾 Database backup completed successfully: ${backupFile}`,
    });
  } catch (err) {
    res.json({
      success: false,
      message: `Backup failed: ${(err as Error).message}`,
    });
  }
});

// ─── POST /api/admin/actions/cleanup ─────────────────────────────────

actionsRouter.post("/actions/cleanup", async (_req, res) => {
  const result = await triggerServiceAction(
    `${config.newsServiceUrl}/api/admin/actions/cleanup`,
  );

  res.json({
    success: result.ok,
    message: result.ok
      ? "🧹 Cleanup completed. Old/discarded articles removed."
      : `Cleanup failed: ${result.message}`,
  });
});

// ─── POST /api/admin/actions/restart/:service ────────────────────────

const RESTARTABLE_SERVICES = [
  "news-ingestion",
  "geolocation",
  "ai-processor",
  "event-detector",
  "trend-analyzer",
  "twitter-publisher",
  "hermes-bridge",
  "economic-data",
  "alerts",
  "night-owl",
  "auth",
  "web-app",
];

actionsRouter.post("/actions/restart/:service", async (req, res) => {
  const serviceName = req.params.service;

  if (!RESTARTABLE_SERVICES.includes(serviceName)) {
    res.status(400).json({
      success: false,
      message: `Unknown service '${serviceName}'. Available: ${RESTARTABLE_SERVICES.join(", ")}`,
    });
    return;
  }

  try {
    await execCmd(`pm2 restart ${serviceName}`, 30_000);

    res.json({
      success: true,
      message: `🔄 Service '${serviceName}' has been restarted.`,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: `Failed to restart '${serviceName}': ${(err as Error).message}`,
    });
  }
});
