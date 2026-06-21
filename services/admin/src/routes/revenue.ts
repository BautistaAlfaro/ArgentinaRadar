// ─────────────────────────────────────────────────────────
//  Admin Dashboard — Revenue Routes
// ─────────────────────────────────────────────────────────

import { Router } from "express";
import { prisma } from "@argentinaradar/database";

export const revenueRouter = Router();

// ─── GET /api/admin/revenue ──────────────────────────────

revenueRouter.get("/revenue", async (_req, res) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // All active subscriptions
    const activeSubscriptions = await prisma.subscription.findMany({
      where: { isActive: true },
      include: { user: { select: { email: true, role: true } } },
    });

    // Total MRR (Monthly Recurring Revenue)
    const mrr = activeSubscriptions.reduce((sum, sub) => sum + sub.amount, 0);

    // Revenue this month
    const thisMonthRevenue = await prisma.subscription.aggregate({
      where: {
        isActive: true,
        startDate: { lte: monthEnd },
        OR: [
          { endDate: null },
          { endDate: { gte: monthStart } },
        ],
      },
      _sum: { amount: true },
    });

    // Revenue from DailyStats
    const dailyStatsRevenue = await prisma.dailyStats.aggregate({
      where: {
        date: { gte: monthStart, lte: monthEnd },
      },
      _sum: { revenue: true },
    });

    // Revenue by plan
    const byPlan = activeSubscriptions.reduce(
      (acc, sub) => {
        const plan = sub.plan;
        if (!acc[plan]) acc[plan] = { count: 0, total: 0 };
        acc[plan].count++;
        acc[plan].total += sub.amount;
        return acc;
      },
      {} as Record<string, { count: number; total: number }>,
    );

    // Revenue trend (last 6 months by month)
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const monthlyStats = await prisma.dailyStats.findMany({
      where: { date: { gte: sixMonthsAgo } },
      orderBy: { date: "asc" },
      select: { date: true, revenue: true },
    });

    // Group revenue by month
    const monthlyRevenue: Record<string, number> = {};
    for (const s of monthlyStats) {
      const key = `${s.date.getFullYear()}-${String(s.date.getMonth() + 1).padStart(2, "0")}`;
      monthlyRevenue[key] = (monthlyRevenue[key] ?? 0) + s.revenue;
    }

    res.json({
      mrr,
      activeSubscriptionsCount: activeSubscriptions.length,
      thisMonthSubscriptions: thisMonthRevenue._sum.amount ?? 0,
      thisMonthTotal: (thisMonthRevenue._sum.amount ?? 0) + (dailyStatsRevenue._sum.revenue ?? 0),
      byPlan,
      monthlyRevenue,
      subscriptions: activeSubscriptions.map((s) => ({
        id: s.id,
        userId: s.userId,
        email: s.user.email,
        plan: s.plan,
        amount: s.amount,
        startDate: s.startDate,
        endDate: s.endDate,
      })),
    });
  } catch (err) {
    console.error("[admin] GET /revenue error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
