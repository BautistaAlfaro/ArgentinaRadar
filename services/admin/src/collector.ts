// ─────────────────────────────────────────────────────────
//  Admin Dashboard — KPI Collector
//
//  Runs periodically (default every hour) and aggregates:
//    • Tweets published today   → DailyStats.tweetsPublished
//    • News ingested/geolocated/filtered → DailyStats.news*
//    • Events detected           → DailyStats.eventsDetected
//    • AI costs                  → DailyStats.aiCost
//    • Active users              → DailyStats.activeUsers
//    • Revenue                   → DailyStats.revenue
// ─────────────────────────────────────────────────────────

import { prisma } from "@argentinaradar/database";
import axios from "axios";
import { config } from "./config.js";

let collectorTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the KPI collector loop.
 * Gathers metrics every `config.collectorIntervalMs` (default: 1 hour).
 */
export function startCollector(): void {
  if (collectorTimer) {
    console.warn("[collector] Already running — skipping duplicate start");
    return;
  }

  // Run immediately on start
  collectDailyStats().catch((err) => {
    console.error("[collector] Initial collection failed:", err);
  });

  collectorTimer = setInterval(() => {
    collectDailyStats().catch((err) => {
      console.error("[collector] Periodic collection failed:", err);
    });
  }, config.collectorIntervalMs);

  console.log(
    `[collector] Started — collecting every ${config.collectorIntervalMs / 1000}s`,
  );
}

/**
 * Stop the collector loop.
 */
export function stopCollector(): void {
  if (collectorTimer) {
    clearInterval(collectorTimer);
    collectorTimer = null;
    console.log("[collector] Stopped");
  }
}

// ─── Core collection logic ───────────────────────────────

export async function collectDailyStats(): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  console.log(`[collector] Collecting daily stats for ${today.toISOString().slice(0, 10)}`);

  try {
    const [
      tweetsPublished,
      newsCounts,
      eventsDetected,
      aiCost,
      activeUsers,
      revenue,
    ] = await Promise.all([
      countTweetsPublished(today, tomorrow),
      countNewsByStatus(),
      countEventsDetected(),
      calculateAiCost(today, tomorrow),
      countActiveUsers(),
      calculateRevenue(today, tomorrow),
    ]);

    // Upsert DailyStats for today
    const stats = await prisma.dailyStats.upsert({
      where: { date: today },
      create: {
        date: today,
        newsIngested: newsCounts.ingested,
        newsGeolocated: newsCounts.geolocated,
        newsFiltered: newsCounts.filtered,
        eventsDetected,
        tweetsPublished,
        aiCost,
        activeUsers,
        revenue,
      },
      update: {
        newsIngested: newsCounts.ingested,
        newsGeolocated: newsCounts.geolocated,
        newsFiltered: newsCounts.filtered,
        eventsDetected,
        tweetsPublished,
        aiCost,
        activeUsers,
        revenue,
      },
    });

    // Also record individual KPIs for time-series tracking
    await recordKPI("tweets_published", tweetsPublished, "count", "engagement");
    await recordKPI("news_processed", newsCounts.ingested, "count", "system");
    await recordKPI("events_detected", eventsDetected, "count", "engagement");
    await recordKPI("ai_cost", aiCost, "USD", "financial");
    await recordKPI("active_users", activeUsers, "count", "engagement");
    await recordKPI("revenue", revenue, "USD", "financial");

    console.log(`[collector] Stats collected:`, {
      tweetsPublished,
      ...newsCounts,
      eventsDetected,
      aiCost,
      activeUsers,
      revenue,
    });
  } catch (err) {
    console.error("[collector] Failed to collect daily stats:", err);
    throw err;
  }
}

// ─── Individual metric fetchers ──────────────────────────

/** Count tweets published within a date range. */
async function countTweetsPublished(from: Date, to: Date): Promise<number> {
  try {
    const count = await prisma.tweet.count({
      where: {
        postedAt: { gte: from, lt: to },
      },
    });
    return count;
  } catch (err) {
    console.warn("[collector] countTweetsPublished failed:", (err as Error).message);
    return 0;
  }
}

/** Count news items grouped by pipeline status. */
async function countNewsByStatus(): Promise<{
  ingested: number;
  geolocated: number;
  filtered: number;
}> {
  try {
    const [ingested, geolocated, filtered] = await Promise.all([
      prisma.news.count({ where: { status: "ingested" } }),
      prisma.news.count({ where: { status: "geolocated" } }),
      prisma.news.count({ where: { status: "filtered" } }),
    ]);
    return { ingested, geolocated, filtered };
  } catch (err) {
    console.warn("[collector] countNewsByStatus failed:", (err as Error).message);
    return { ingested: 0, geolocated: 0, filtered: 0 };
  }
}

/** Query event-detector service for today's event count. */
async function countEventsDetected(): Promise<number> {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const count = await prisma.event.count({
      where: {
        createdAt: { gte: today },
      },
    });
    return count;
  } catch (err) {
    console.warn("[collector] countEventsDetected failed:", (err as Error).message);
    return 0;
  }
}

/** Calculate total AI costs from AiCost records. */
async function calculateAiCost(from: Date, to: Date): Promise<number> {
  try {
    const result = await prisma.aiCost.aggregate({
      where: {
        date: { gte: from, lt: to },
      },
      _sum: { cost: true },
    });
    return result._sum.cost ?? 0;
  } catch (err) {
    console.warn("[collector] calculateAiCost failed:", (err as Error).message);
    return 0;
  }
}

/** Count users with active sessions. */
async function countActiveUsers(): Promise<number> {
  try {
    const now = new Date();
    // Users with active (non-expired) sessions
    const result = await prisma.session.findMany({
      where: { expiresAt: { gte: now } },
      select: { userId: true },
      distinct: ["userId"],
    });
    return result.length;
  } catch (err) {
    console.warn("[collector] countActiveUsers failed:", (err as Error).message);
    return 0;
  }
}

/** Calculate revenue from active subscriptions. */
async function calculateRevenue(from: Date, to: Date): Promise<number> {
  try {
    const subscriptions = await prisma.subscription.findMany({
      where: {
        isActive: true,
        OR: [
          { startDate: { gte: from, lt: to } },
          {
            startDate: { lt: to },
            AND: [
              { endDate: null },
              { startDate: { lte: to } },
            ],
          },
        ],
      },
    });

    // Prorated revenue per day for each active subscription
    let totalRevenue = 0;
    for (const sub of subscriptions) {
      const effectiveEnd = sub.endDate ?? to;
      const daysActive = Math.max(1, Math.ceil(
        (effectiveEnd.getTime() - sub.startDate.getTime()) / (1000 * 60 * 60 * 24),
      ));
      const dailyRate = sub.amount / daysActive;

      // Days in the current period
      const periodStart = sub.startDate > from ? sub.startDate : from;
      const periodEnd = effectiveEnd < to ? effectiveEnd : to;
      const daysInPeriod = Math.max(0, Math.ceil(
        (periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24),
      ));

      totalRevenue += dailyRate * daysInPeriod;
    }

    return Math.round(totalRevenue * 100) / 100;
  } catch (err) {
    console.warn("[collector] calculateRevenue failed:", (err as Error).message);
    return 0;
  }
}

/** Save an individual KPI record. */
async function recordKPI(
  name: string,
  value: number,
  unit: string,
  category: string,
): Promise<void> {
  try {
    await prisma.kPI.create({
      data: { name, value, unit, category },
    });
  } catch (err) {
    console.warn(`[collector] recordKPI(${name}) failed:`, (err as Error).message);
  }
}
