/**
 * Night Owl Service — Express Server
 *
 * Port: 3011 (configurable via PORT env var)
 *
 * Endpoints:
 *   GET  /health                  — Health check
 *   GET  /api/night-owl/status     — Scheduled jobs status
 *   POST /api/night-owl/trigger/:job — Manually trigger a job
 *   GET  /api/night-owl/history    — Execution history
 */

// ── Global error handlers (MUST be first to catch BullMQ startup errors) ─
process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled Rejection:', reason);
});

import express from 'express';
import { config } from './config.js';
import { nightOwlQueue, worker, closeQueue } from './queue.js';
import { startSchedulers, stopSchedulers } from './scheduler.js';
import { addRecord, getHistory } from './history.js';

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
