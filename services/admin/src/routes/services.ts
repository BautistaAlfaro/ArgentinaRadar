/**
 * Admin Dashboard — Service Control Routes
 *
 * Provides PM2-based service lifecycle management:
 *   GET    /services           — list all services with port status
 *   POST   /services/:name/start — start a service via PM2
 *   POST   /services/:name/stop  — stop a service via PM2
 *   POST   /services/start-all   — start all services
 *   POST   /services/stop-all    — stop all services
 *
 * Port status is checked via TCP socket connection (Node net module).
 * Auth is enforced by parent router (ADMIN role required).
 */

import { Router } from "express";
import { exec } from "child_process";
import net from "net";

// ─── Service Definitions ─────────────────────────────────────────────

export interface ServiceDef {
  name: string;
  pm2Name: string;
  port: number | null;
  icon: string;
  description: string;
  type: "node" | "python" | "web";
}

const SERVICES: ServiceDef[] = [
  { name: "web-app",         pm2Name: "web-app",         port: 5173, icon: "🌐", description: "Vite dev server",                type: "web" },
  { name: "news-ingestion",  pm2Name: "news-ingestion",  port: 3001, icon: "📰", description: "News ingestion pipeline",       type: "node" },
  { name: "geolocation",     pm2Name: "geolocation",     port: 3002, icon: "📍", description: "Geolocation service",           type: "node" },
  { name: "ai-processor",    pm2Name: "ai-processor",    port: 3013, icon: "🧠", description: "AI content processor",          type: "python" },
  { name: "event-detector",  pm2Name: "event-detector",  port: 3008, icon: "⚡", description: "Event detection engine",        type: "node" },
  { name: "trend-analyzer",  pm2Name: "trend-analyzer",  port: 3009, icon: "📈", description: "Trend analysis",                type: "node" },
  { name: "twitter-publisher", pm2Name: "twitter-publisher", port: 3004, icon: "🐦", description: "Twitter/X publisher",      type: "node" },
  { name: "hermes-bridge",   pm2Name: "hermes-bridge",   port: 3005, icon: "🤖", description: "Telegram bot bridge",           type: "python" },
  { name: "economic-data",   pm2Name: "economic-data",   port: 3006, icon: "💰", description: "Economic data fetcher",         type: "node" },
  { name: "alerts",          pm2Name: "alerts",          port: 3007, icon: "🔔", description: "Alert system",                  type: "node" },
  { name: "night-owl",       pm2Name: "night-owl",       port: 3011, icon: "🦉", description: "Nightly batch processor",       type: "node" },
  { name: "auth",            pm2Name: "auth",            port: 3010, icon: "🔐", description: "Authentication service",        type: "node" },
];

/** The admin service itself — excluded from control actions to avoid suicide. */
const ADMIN_SERVICE_NAME = "admin";

const PROJECT_ROOT = process.cwd();
const PM2_CONFIG_PATH = "config/pm2.config.cjs";

// ─── Port Check Helper ───────────────────────────────────────────────

function checkPort(port: number, timeout = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);

    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, "127.0.0.1");
  });
}

async function getServiceStatus(def: ServiceDef): Promise<"running" | "stopped" | "unknown"> {
  if (def.port === null) return "unknown";
  try {
    const isOpen = await checkPort(def.port);
    return isOpen ? "running" : "stopped";
  } catch {
    return "unknown";
  }
}

// ─── Command Execution ───────────────────────────────────────────────

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
          // Try to get useful error info even on non-zero exit
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

// ─── Router ──────────────────────────────────────────────────────────

export const servicesRouter = Router();

// ─── GET /api/admin/services ───────────────────────────────────────

servicesRouter.get("/services", async (_req, res) => {
  try {
    const results = await Promise.all(
      SERVICES.map(async (svc) => ({
        name: svc.name,
        pm2Name: svc.pm2Name,
        port: svc.port,
        icon: svc.icon,
        description: svc.description,
        type: svc.type,
        status: await getServiceStatus(svc),
        lastChecked: new Date().toISOString(),
      })),
    );

    res.json({ services: results });
  } catch (err) {
    console.error("[admin] GET /services error:", err);
    res.status(500).json({ error: "Failed to check service statuses" });
  }
});

// ─── POST /api/admin/services/:name/start ────────────────────────────

servicesRouter.post("/services/:name/start", async (req, res) => {
  const svc = SERVICES.find((s) => s.name === req.params.name);
  if (!svc) {
    res.status(404).json({ error: `Service '${req.params.name}' not found` });
    return;
  }

  try {
    const { stdout, stderr } = await execCmd(
      `pm2 start ${PM2_CONFIG_PATH} --only ${svc.pm2Name}`,
    );

    res.json({
      message: `Start command issued for '${svc.name}'`,
      service: svc.name,
      stdout,
      stderr,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[admin] POST /services/${svc.name}/start error:`, msg);
    res.status(500).json({
      error: `Failed to start '${svc.name}'`,
      details: msg,
    });
  }
});

// ─── POST /api/admin/services/:name/stop ────────────────────────────

servicesRouter.post("/services/:name/stop", async (req, res) => {
  if (req.params.name === ADMIN_SERVICE_NAME) {
    res.status(400).json({ error: "Cannot stop the admin service from itself" });
    return;
  }

  const svc = SERVICES.find((s) => s.name === req.params.name);
  if (!svc) {
    res.status(404).json({ error: `Service '${req.params.name}' not found` });
    return;
  }

  try {
    const { stdout, stderr } = await execCmd(`pm2 stop ${svc.pm2Name}`);

    res.json({
      message: `Stop command issued for '${svc.name}'`,
      service: svc.name,
      stdout,
      stderr,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[admin] POST /services/${svc.name}/stop error:`, msg);
    res.status(500).json({
      error: `Failed to stop '${svc.name}'`,
      details: msg,
    });
  }
});

// ─── POST /api/admin/services/start-all ─────────────────────────────

servicesRouter.post("/services/start-all", async (_req, res) => {
  try {
    const { stdout, stderr } = await execCmd(`pm2 start ${PM2_CONFIG_PATH}`, 60_000);

    res.json({
      message: "Start-all command issued",
      stdout,
      stderr,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[admin] POST /services/start-all error:", msg);
    res.status(500).json({
      error: "Failed to start all services",
      details: msg,
    });
  }
});

// ─── POST /api/admin/services/stop-all ──────────────────────────────

servicesRouter.post("/services/stop-all", async (_req, res) => {
  try {
    // Stop all known services (excluding admin itself)
    const names = SERVICES.map((s) => s.pm2Name).join(" ");
    const { stdout, stderr } = await execCmd(`pm2 stop ${names}`, 60_000);

    res.json({
      message: "Stop-all command issued for all non-admin services",
      stdout,
      stderr,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[admin] POST /services/stop-all error:", msg);
    res.status(500).json({
      error: "Failed to stop all services",
      details: msg,
    });
  }
});
