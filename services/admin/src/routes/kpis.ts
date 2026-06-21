// ─────────────────────────────────────────────────────────
//  Admin Dashboard — KPI Routes
// ─────────────────────────────────────────────────────────

import { Router } from "express";
import { prisma } from "@argentinaradar/database";

export const kpiRouter = Router();

// ─── GET /api/admin/kpis?range=7d|30d|90d ──────────────

kpiRouter.get("/kpis", async (req, res) => {
  try {
    const range = (req.query.range as string) ?? "7d";
    const since = computeSince(range);

    const kpis = await prisma.kPI.findMany({
      where: { date: { gte: since } },
      orderBy: { date: "desc" },
    });

    res.json({ kpis, count: kpis.length, range });
  } catch (err) {
    console.error("[admin] GET /kpis error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/admin/kpis/summary ────────────────────────

kpiRouter.get("/kpis/summary", async (_req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    // Latest KPI values by name
    const latestKpis = await prisma.kPI.groupBy({
      by: ["name"],
      _max: { date: true },
    });

    // Fetch full records for latest KPIs
    const summary: Record<string, { value: number; unit: string; category: string; date: Date }> = {};
    for (const group of latestKpis) {
      if (!group._max.date) continue;
      const kpi = await prisma.kPI.findFirst({
        where: { name: group.name, date: group._max.date },
        orderBy: { date: "desc" },
      });
      if (kpi) {
        summary[kpi.name] = {
          value: kpi.value,
          unit: kpi.unit,
          category: kpi.category,
          date: kpi.date,
        };
      }
    }

    // Today's totals
    const todayKpis = await prisma.kPI.findMany({
      where: { date: { gte: today } },
    });

    const todayTotals: Record<string, number> = {};
    for (const kpi of todayKpis) {
      todayTotals[kpi.name] = (todayTotals[kpi.name] ?? 0) + kpi.value;
    }

    // Monthly totals
    const monthKpis = await prisma.kPI.findMany({
      where: { date: { gte: monthStart } },
    });

    const monthTotals: Record<string, number> = {};
    for (const kpi of monthKpis) {
      monthTotals[kpi.name] = (monthTotals[kpi.name] ?? 0) + kpi.value;
    }

    res.json({
      summary,
      today: todayTotals,
      month: monthTotals,
    });
  } catch (err) {
    console.error("[admin] GET /kpis/summary error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/admin/kpis/record ────────────────────────

kpiRouter.post("/kpis/record", async (req, res) => {
  try {
    const { name, value, unit, category, metadata } = req.body;

    if (!name || value === undefined || !unit || !category) {
      res.status(400).json({
        error: "Missing required fields: name, value, unit, category",
      });
      return;
    }

    const kpi = await prisma.kPI.create({
      data: {
        name,
        value: parseFloat(value),
        unit,
        category,
        metadata: metadata ?? undefined,
      },
    });

    res.status(201).json({ kpi });
  } catch (err) {
    console.error("[admin] POST /kpis/record error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Helpers ─────────────────────────────────────────────

/** Parse range string (7d, 30d, 90d) into a Date threshold. */
function computeSince(range: string): Date {
  const now = new Date();
  const match = range.match(/^(\d+)([dh])$/);
  if (!match) {
    now.setDate(now.getDate() - 7);
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
