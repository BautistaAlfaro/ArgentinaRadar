// ─────────────────────────────────────────────────────────
//  Admin Dashboard — Daily Stats Routes
// ─────────────────────────────────────────────────────────

import { Router } from "express";
import { prisma } from "@argentinaradar/database";

export const dailyStatsRouter = Router();

// ─── GET /api/admin/daily-stats?range=7d ────────────────

dailyStatsRouter.get("/daily-stats", dailyStatsHandler);

// Alias for frontend compatibility
dailyStatsRouter.get("/stats", dailyStatsHandler);

async function dailyStatsHandler(req: any, res: any) {
  try {
    const range = (req.query.range as string) ?? "7d";
    const since = computeSince(range);

    const stats = await prisma.dailyStats.findMany({
      where: { date: { gte: since } },
      orderBy: { date: "asc" },
    });

    // Calculate totals across all days
    const totals = stats.reduce(
      (acc, s) => ({
        newsIngested: acc.newsIngested + s.newsIngested,
        newsGeolocated: acc.newsGeolocated + s.newsGeolocated,
        newsFiltered: acc.newsFiltered + s.newsFiltered,
        eventsDetected: acc.eventsDetected + s.eventsDetected,
        tweetsPublished: acc.tweetsPublished + s.tweetsPublished,
        aiCost: acc.aiCost + s.aiCost,
        activeUsers: Math.max(acc.activeUsers, s.activeUsers),
        revenue: acc.revenue + s.revenue,
      }),
      {
        newsIngested: 0,
        newsGeolocated: 0,
        newsFiltered: 0,
        eventsDetected: 0,
        tweetsPublished: 0,
        aiCost: 0,
        activeUsers: 0,
        revenue: 0,
      },
    );

    res.json({ stats, totals, count: stats.length, range });
  } catch (err) {
    console.error("[admin] GET /daily-stats error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

/** Parse range string into Date threshold (supports days only). */
function computeSince(range: string): Date {
  const now = new Date();
  const match = range.match(/^(\d+)d$/);
  if (!match) {
    now.setDate(now.getDate() - 7);
    return now;
  }
  now.setDate(now.getDate() - parseInt(match[1], 10));
  return now;
}
