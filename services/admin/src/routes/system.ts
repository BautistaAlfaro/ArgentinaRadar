/**
 * Admin Dashboard — System Info Route
 *
 * Provides system-level metrics (CPU, RAM, uptime) from the host OS.
 *   GET /system-info — CPU load, RAM used/total, process uptime
 *
 * Auth is enforced by the parent router (ADMIN role required).
 */

import { Router } from "express";
import os from "os";

export const systemRouter = Router();

interface SystemInfoResponse {
  cpu: {
    load: number[];
    cores: number;
    model: string;
  };
  memory: {
    total: number;  // GB
    free: number;   // GB
    used: number;   // GB
    usagePercent: number;
  };
  uptime: {
    system: number;   // seconds
    process: number;  // seconds
  };
  hostname: string;
  platform: string;
  timestamp: string;
}

// ─── GET /api/admin/system-info ──────────────────────────────────────

systemRouter.get("/system-info", (_req, res) => {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  // CPU load averages (1, 5, 15 minutes) — Windows doesn't have loadavg,
  // so we compute from current CPU usage
  const cpuUsage = cpus.map((cpu) => {
    const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
    const idle = cpu.times.idle;
    return Number(((1 - idle / total) * 100).toFixed(1));
  });
  const avgLoad = cpuUsage.reduce((a, b) => a + b, 0) / cpuUsage.length;

  const response: SystemInfoResponse = {
    cpu: {
      load: [Number(avgLoad.toFixed(1))],
      cores: cpus.length,
      model: cpus[0]?.model ?? "Unknown",
    },
    memory: {
      total: Number((totalMem / 1024 ** 3).toFixed(2)),
      free: Number((freeMem / 1024 ** 3).toFixed(2)),
      used: Number((usedMem / 1024 ** 3).toFixed(2)),
      usagePercent: Number(((usedMem / totalMem) * 100).toFixed(1)),
    },
    uptime: {
      system: os.uptime(),
      process: process.uptime(),
    },
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    timestamp: new Date().toISOString(),
  };

  res.json(response);
});
