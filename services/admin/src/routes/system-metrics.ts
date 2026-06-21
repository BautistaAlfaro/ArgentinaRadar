// ─────────────────────────────────────────────────────────
//  Admin Dashboard — System Metrics Routes
// ─────────────────────────────────────────────────────────

import { Router } from "express";
import { prisma } from "@argentinaradar/database";

export const systemMetricsRouter = Router();

// ─── GET /api/admin/system-metrics?service=xxx&range=24h ─

systemMetricsRouter.get("/system-metrics", async (req, res) => {
  try {
    const service = req.query.service as string | undefined;
    const range = (req.query.range as string) ?? "24h";
    const since = computeSince(range);

    const where: Record<string, unknown> = {
      timestamp: { gte: since },
    };
    if (service) {
      where.service = service;
    }

    const metrics = await prisma.systemMetric.findMany({
      where,
      orderBy: { timestamp: "desc" },
      take: 1000,
    });

    // Group by service + metric for easier consumption
    const grouped: Record<string, Record<string, { values: { value: number; timestamp: Date }[] }>> = {};
    for (const m of metrics) {
      if (!grouped[m.service]) grouped[m.service] = {};
      if (!grouped[m.service][m.metric]) {
        grouped[m.service][m.metric] = { values: [] };
      }
      grouped[m.service][m.metric].values.push({
        value: m.value,
        timestamp: m.timestamp,
      });
    }

    res.json({ metrics, grouped, count: metrics.length });
  } catch (err) {
    console.error("[admin] GET /system-metrics error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/** Parse range string into Date threshold (supports hours and days). */
function computeSince(range: string): Date {
  const now = new Date();
  const match = range.match(/^(\d+)([dh])$/);
  if (!match) {
    now.setHours(now.getHours() - 24);
    return now;
  }

  const val = parseInt(match[1], 10);
  const unit = match[2];

  if (unit === "h") {
    now.setHours(now.getHours() - val);
  } else {
    now.setDate(now.getDate() - val);
  }

  return now;
}
