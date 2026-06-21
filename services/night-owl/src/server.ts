/**
 * Night Owl Service — Express Server
 *
 * Port: 3011 (configurable via PORT env var)
 *
 * Endpoints:
 *   GET  /health                      — Health check
 *   GET  /api/night-owl/status        — Scheduled jobs status
 *   POST /api/night-owl/trigger/:job  — Manually trigger a job
 *   GET  /api/night-owl/history       — Execution history
 *   GET  /api/night-owl/briefing      — Morning Briefing data
 *   GET  /api/night-owl/daily-stats   — Today's quick stats
 */

// ── Global error handlers (MUST be first to catch BullMQ startup errors) ─
process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled Rejection:', reason);
});

import express from 'express';
import pg from 'pg';
import { prisma } from '@argentinaradar/database';
import { config } from './config.js';
import { nightOwlQueue, worker, closeQueue } from './queue.js';
import { startSchedulers, stopSchedulers } from './scheduler.js';
import { addRecord, getHistory } from './history.js';

const { Pool } = pg;

// ── Helpers ───────────────────────────────────────────────────────

/** Safely parse JSON, returning `null` on failure. */
function safeJson<T>(raw: string | null | undefined, fallback: T | null = null): T | null {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; }
  catch { return fallback; }
}

// Known job names for endpoint validation
const JOB_NAMES = ['backfill', 'digest', 'pattern', 'optimizer', 'predictive', 'cleanup', 'health'] as const;

const PORT = config.port;
const app = express();
app.use(express.json());

// ── CORS ─────────────────────────────────────────────────────────

app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  next();
});

// ── Start time ───────────────────────────────────────────────────

const startTime = Date.now();

// ── Routes ───────────────────────────────────────────────────────

/** GET /health — Service health check */
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'night-owl',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    port: PORT,
    enabled: config.enabled,
    budgetPerNight: config.budgetPerNight,
    timezone: config.timezone,
  });
});

/** GET /api/night-owl/status — View scheduled jobs & queue state */
app.get('/api/night-owl/status', async (_req, res) => {
  let counts: Record<string, number | string | boolean> = { available: false };

  try {
    const [waiting, active, completed, failed] = await Promise.all([
      nightOwlQueue.getWaitingCount(),
      nightOwlQueue.getActiveCount(),
      nightOwlQueue.getCompletedCount(),
      nightOwlQueue.getFailedCount(),
    ]);
    counts = { waiting, active, completed, failed, available: true };
  } catch (err) {
    counts = {
      available: false,
      error: (err as Error).message,
      hint: 'Is Redis running?',
    };
  }

  res.json({
    enabled: config.enabled,
    queue: 'night-owl',
    concurrency: 1,
    redisConnected: counts.available,
    counts,
    schedule: [
      { job: 'backfill',   cron: '0 1 * * *',   time: '01:00 ART', description: 'Re-process missed articles' },
      { job: 'digest',     cron: '0 2 * * *',   time: '02:00 ART', description: 'Generate daily summary digest' },
      { job: 'pattern',    cron: '0 3 * * *',   time: '03:00 ART', description: 'Heavy pattern detection' },
      { job: 'optimizer',  cron: '30 3 * * *',  time: '03:30 ART', description: 'Re-train / tune ML models' },
      { job: 'predictive', cron: '0 4 * * *',   time: '04:00 ART', description: 'Forward-looking predictions' },
      { job: 'cleanup',    cron: '0 5 * * *',   time: '05:00 ART', description: 'Purge stale data' },
      { job: 'health',     cron: '30 5 * * *',  time: '05:30 ART', description: 'End-of-cycle health check' },
    ],
  });
});

/** POST /api/night-owl/trigger/:job — Manually enqueue a job */
app.post('/api/night-owl/trigger/:job', async (req, res) => {
  const jobName = req.params.job;

  if (!(JOB_NAMES as readonly string[]).includes(jobName)) {
    res.status(404).json({
      error: `Unknown job "${jobName}". Valid jobs: ${JOB_NAMES.join(', ')}`,
    });
    return;
  }

  try {
    const job = await nightOwlQueue.add(jobName, {
      scheduledAt: new Date().toISOString(),
      triggeredBy: 'manual',
    });
    console.log(`[API] Manually triggered "${jobName}" (id=${job.id})`);
    res.json({ ok: true, job: jobName, jobId: job.id });
  } catch (err) {
    res.status(500).json({ error: `Failed to trigger "${jobName}"`, details: (err as Error).message });
  }
});

/** GET /api/night-owl/history — Recent execution history */
app.get('/api/night-owl/history', (_req, res) => {
  const limit = Math.min(100, parseInt(_req.query.limit as string, 10) || 50);
  const history = getHistory(limit);
  res.json({ history, count: history.length });
});

/**
 * GET /api/night-owl/briefing — Morning Briefing data
 *
 * Combines today's digest, predictions, patterns, and health report
 * into a single response for the Morning Briefing frontend panel.
 * Returns null fields when a component is not yet available (jobs
 * may not have run yet).
 */
app.get('/api/night-owl/briefing', async (_req, res) => {
  const todayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  try {
    // 1 — Fetch today's digest from raw daily_digests table
    let digest: Record<string, unknown> | null = null;
    const DATABASE_URL = process.env.DATABASE_URL ?? '';
    if (DATABASE_URL) {
      const pool = new Pool({ connectionString: DATABASE_URL });
      try {
        const result = await pool.query(
          `SELECT id, date, summary, top_events, top_trends, economic_data, stats,
                  html_content, markdown_content, created_at
           FROM daily_digests
           WHERE date = $1
           ORDER BY created_at DESC
           LIMIT 1`,
          [todayKey],
        );
        if (result.rows.length > 0) {
          digest = {
            id: result.rows[0].id,
            date: result.rows[0].date,
            summary: result.rows[0].summary,
            topEvents: safeJson(result.rows[0].top_events) ?? [],
            topTrends: safeJson(result.rows[0].top_trends) ?? [],
            economicData: safeJson(result.rows[0].economic_data) ?? [],
            stats: safeJson(result.rows[0].stats) ?? {},
            htmlContent: result.rows[0].html_content,
            markdownContent: result.rows[0].markdown_content,
            createdAt: result.rows[0].created_at,
          };
        }
      } finally {
        await pool.end();
      }
    }

    // 2 — Fetch today's predictions from Prisma
    let predictions: Array<Record<string, unknown>> | null = null;
    try {
      const predRows = await prisma.prediction.findMany({
        orderBy: { predictedAt: 'desc' },
        take: 10,
      });
      predictions = predRows.map((p) => ({
        id: p.id,
        entityName: p.entityName,
        confidence: p.confidence,
        reason: p.reason,
        predictedAt: p.predictedAt,
      }));
    } catch {
      predictions = null;
    }

    // 3 — Fetch latest patterns from Prisma
    let patterns: Array<Record<string, unknown>> | null = null;
    try {
      const patternRows = await prisma.pattern.findMany({
        orderBy: { detectedAt: 'desc' },
        take: 10,
      });
      patterns = patternRows.map((p) => ({
        id: p.id,
        type: p.type,
        entityName: p.entityName,
        description: p.description,
        confidence: p.confidence,
        detectedAt: p.detectedAt,
      }));
    } catch {
      patterns = null;
    }

    // 4 — Fetch latest health report from Prisma
    let healthReport: Record<string, unknown> | null = null;
    try {
      const healthRow = await prisma.healthReport.findFirst({
        orderBy: { createdAt: 'desc' },
      });
      if (healthRow) {
        healthReport = {
          id: healthRow.id,
          score: healthRow.score,
          services: healthRow.services as Array<Record<string, unknown>>,
          queues: healthRow.queues as Record<string, unknown>,
          budget: healthRow.budget as Record<string, unknown>,
          createdAt: healthRow.createdAt,
        };
      }
    } catch {
      healthReport = null;
    }

    // 5 — Determine health semaphore
    let healthSemaphore: 'green' | 'yellow' | 'red' = 'green';
    if (healthReport) {
      const score = healthReport.score as number;
      if (score < 60) healthSemaphore = 'red';
      else if (score < 80) healthSemaphore = 'yellow';
    }

    res.json({
      date: todayKey,
      generatedAt: digest?.createdAt ?? null,
      digest,
      predictions,
      patterns,
      healthReport,
      healthSemaphore,
      available: !!(digest || predictions || patterns || healthReport),
    });
  } catch (err) {
    console.error('[Briefing] Failed to assemble briefing:', (err as Error).message);
    res.status(500).json({
      error: 'Failed to generate briefing',
      available: false,
    });
  }
});

/** GET /api/night-owl/daily-stats — Today's quick stats for the frontend */
app.get('/api/night-owl/daily-stats', async (_req, res) => {
  const todayKey = new Date().toISOString().slice(0, 10);
  const DATABASE_URL = process.env.DATABASE_URL ?? '';

  if (!DATABASE_URL) {
    res.json({ available: false, hint: 'DATABASE_URL not set' });
    return;
  }

  try {
    const pool = new Pool({ connectionString: DATABASE_URL });

    // Get today's digest stats
    const digestResult = await pool.query(
      `SELECT stats FROM daily_digests WHERE date = $1 ORDER BY created_at DESC LIMIT 1`,
      [todayKey],
    );

    // Get today's article counts from SQLite
    let articleCounts = { articlesIngested: 0, eventsDetected: 0, tweetsPublished: 0 };
    try {
      const path = await import('path');
      const { fileURLToPath } = await import('url');
      const Database = (await import('better-sqlite3')).default;
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const DB_PATH = process.env.DB_PATH ??
        path.resolve(__dirname, '..', '..', '..', '..', 'data', 'argentina-radar.db');
      const db = new Database(DB_PATH);
      db.pragma('journal_mode = WAL');

      const ingested = db.prepare(
        "SELECT COUNT(*) AS count FROM news_items WHERE ingested_at >= ?",
      ).get(todayKey) as { count: number } | undefined;
      const tweets = db.prepare(
        "SELECT COUNT(*) AS count FROM tweet_history WHERE posted_at >= ? AND status = 'posted'",
      ).get(todayKey) as { count: number } | undefined;

      articleCounts = {
        articlesIngested: ingested?.count ?? 0,
        eventsDetected: 0,
        tweetsPublished: tweets?.count ?? 0,
      };
      db.close();
    } catch {
      // SQLite stats are non-critical
    }

    const stats = digestResult.rows[0]?.stats
      ? safeJson<Record<string, unknown>>(digestResult.rows[0].stats)
      : articleCounts;

    await pool.end();

    res.json({
      date: todayKey,
      stats,
      available: true,
    });
  } catch (err) {
    console.error('[DailyStats] Failed:', (err as Error).message);
    res.json({ available: false, error: (err as Error).message });
  }
});

// ── Wire worker events → history ─────────────────────────────────

worker.on('completed', (job) => {
  const finishedAt = new Date().toISOString();
  addRecord({
    job: job.name,
    status: 'completed',
    startedAt: new Date(job.timestamp).toISOString(),
    finishedAt,
    elapsed: Date.now() - job.timestamp,
  });
});

worker.on('failed', (job, err) => {
  if (!job) return;
  const finishedAt = new Date().toISOString();
  addRecord({
    job: job.name,
    status: 'failed',
    startedAt: new Date(job.timestamp).toISOString(),
    finishedAt,
    elapsed: Date.now() - job.timestamp,
    error: err.message,
  });
});

// ── Start ────────────────────────────────────────────────────────

startSchedulers();

app.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`  Night Owl Service`);
  console.log(`  Port:     ${PORT}`);
  console.log(`  Enabled:  ${config.enabled}`);
  console.log(`  Budget:   $${config.budgetPerNight.toFixed(2)}/night`);
  console.log(`  Timezone: ${config.timezone}`);
  console.log(`  Queue:    ${config.queueName} (concurrency: 1)`);
  console.log(`========================================`);
  console.log(`  Endpoints:`);
  console.log(`  GET  /health`);
  console.log(`  GET  /api/night-owl/status`);
  console.log(`  POST /api/night-owl/trigger/:job`);
  console.log(`  GET  /api/night-owl/history`);
  console.log(`  GET  /api/night-owl/briefing`);
  console.log(`  GET  /api/night-owl/daily-stats`);
  console.log(`========================================`);
});

// ── Graceful shutdown ────────────────────────────────────────────

async function shutdown(): Promise<void> {
  console.log('\n[Server] Shutting down gracefully...');
  stopSchedulers();
  await closeQueue();
  console.log('[Server] Goodbye');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
