/**
 * Night Owl — BullMQ Queue & Worker
 *
 * Creates the `night-owl` queue and a worker that processes jobs
 * sequentially (concurrency: 1).  Each job is dispatched to the
 * corresponding handler in `./jobs/`.
 *
 * NOTE: We pass Redis connection *options* (host/port) directly to
 * BullMQ instead of a pre-created IORedis client. This avoids the
 * well-known type mismatch when the top-level ioredis version
 * differs from the one bundled inside bullmq.
 */

import { Queue, Worker } from 'bullmq';
import { config } from './config.js';
import {
  runBackfill,
  runDigest,
  runPattern,
  runOptimizer,
  runPredictive,
  runCleanup,
  runHealth,
  type JobFn,
} from './jobs/index.js';

// ── shared connection config ─────────────────────────────────────

const connection = {
  host: config.redis.host,
  port: config.redis.port,
  connectTimeout: 3000,       // fail fast if Redis is down
  maxRetriesPerRequest: null, // BullMQ handles retries
  retryStrategy: (times: number) => {
    if (times > 3) return null; // stop retrying after 3 attempts
    return Math.min(times * 200, 1000);
  },
};

// ── Queue ─────────────────────────────────────────────────────────

export const nightOwlQueue = new Queue(config.queueName, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 60 * 60 * 24 * 7 }, // keep 7 days
    removeOnFail: { age: 60 * 60 * 24 * 7 },
  },
});

// suppress unhandled rejections from the queue when Redis is down
nightOwlQueue.on('error', (err: Error) => {
  console.error('[Queue] BullMQ error (Redis may be unavailable):', err.message);
});

// ── Job name → handler map ───────────────────────────────────────

const handlers: Record<string, JobFn> = {
  backfill: runBackfill,
  digest: runDigest,
  pattern: runPattern,
  optimizer: runOptimizer,
  predictive: runPredictive,
  cleanup: runCleanup,
  health: runHealth,
};

// ── Worker (concurrency: 1 → sequential execution) ───────────────

export const worker = new Worker(
  config.queueName,
  async (job) => {
    const handler = handlers[job.name];
    if (!handler) {
      throw new Error(`Unknown job: "${job.name}"`);
    }
    console.log(`[Worker] Starting job "${job.name}" (id=${job.id})`);
    const start = Date.now();
    try {
      await handler(job.data);
      const elapsed = Date.now() - start;
      console.log(`[Worker] Completed job "${job.name}" in ${elapsed}ms`);
      return { ok: true, jobName: job.name, elapsed };
    } catch (err) {
      const elapsed = Date.now() - start;
      console.error(`[Worker] Job "${job.name}" failed after ${elapsed}ms:`, err);
      throw err; // bullmq will retry based on job options
    }
  },
  {
    connection,
    concurrency: 1,
  },
);

worker.on('completed', (job) => {
  console.log(`[Worker] ✅ "${job.name}" (id=${job.id}) completed`);
});

worker.on('failed', (job, err) => {
  if (job) {
    console.error(`[Worker] ❌ "${job.name}" (id=${job.id}) failed:`, err.message);
  }
});

// suppress unhandled rejections from the worker when Redis is down
worker.on('error', (err: Error) => {
  console.error('[Worker] BullMQ error (Redis may be unavailable):', err.message);
});

// ── Graceful shutdown helper ─────────────────────────────────────

export async function closeQueue(): Promise<void> {
  try {
    await worker.close();
  } catch (err) {
    console.error('[Queue] Error closing worker:', (err as Error).message);
  }
  try {
    await nightOwlQueue.close();
  } catch (err) {
    console.error('[Queue] Error closing queue:', (err as Error).message);
  }
}
