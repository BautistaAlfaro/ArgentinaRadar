/**
 * Night Owl — In-Memory Queue (Redis/BullMQ free)
 *
 * Provides a drop-in replacement for BullMQ's Queue + Worker that
 * executes jobs in-process.  No Redis required.
 *
 * The real BullMQ import in health.ts is safely wrapped behind a
 * try-catch so it never crashes the server when Redis is down.
 */

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

// ── Job handler registry ─────────────────────────────────────────

const handlers: Record<string, JobFn> = {
  backfill: runBackfill,
  digest: runDigest,
  pattern: runPattern,
  optimizer: runOptimizer,
  predictive: runPredictive,
  cleanup: runCleanup,
  health: runHealth,
};

// ── In-memory queue state ────────────────────────────────────────

let jobCounter = 0;
type JobStatus = 'waiting' | 'active' | 'completed' | 'failed';

interface MockJob {
  id: string;
  name: string;
  data: unknown;
  timestamp: number;
  status: JobStatus;
  returnvalue?: unknown;
  failedReason?: string;
}

const jobs: MockJob[] = [];
const completedListeners: Array<(job: MockJob) => void> = [];
const failedListeners: Array<(job: MockJob, err: Error) => void> = [];

// ── Mock queue (matches BullMQ Queue interface used by server.ts) ─

const mockQueue = {
  async add(name: string, data: unknown) {
    const id = `mock-${++jobCounter}`;
    const job: MockJob = { id, name, data, timestamp: Date.now(), status: 'waiting' };
    jobs.push(job);
    console.log(`[MockQueue] Added "${name}" (id=${id})`);
    setImmediate(() => executeJob(job));
    return { id, name, data };
  },

  async getWaitingCount()  { return jobs.filter((j) => j.status === 'waiting').length; },
  async getActiveCount()   { return jobs.filter((j) => j.status === 'active').length; },
  async getCompletedCount(){ return jobs.filter((j) => j.status === 'completed').length; },
  async getFailedCount()   { return jobs.filter((j) => j.status === 'failed').length; },

  on(_event: string, _handler: (...args: unknown[]) => void) { return this; },

  async close() { console.log('[MockQueue] Closed'); },
};

// ── Mock worker ──────────────────────────────────────────────────

async function executeJob(job: MockJob): Promise<void> {
  const handler = handlers[job.name];
  if (!handler) {
    job.status = 'failed';
    job.failedReason = `Unknown job: "${job.name}"`;
    console.error(`[MockWorker] ❌ "${job.name}": ${job.failedReason}`);
    for (const fn of failedListeners) fn(job, new Error(job.failedReason));
    return;
  }

  job.status = 'active';
  console.log(`[MockWorker] Starting "${job.name}" (id=${job.id})`);
  const start = Date.now();

  try {
    await handler(job.data);
    job.status = 'completed';
    job.returnvalue = { ok: true, jobName: job.name, elapsed: Date.now() - start };
    console.log(`[MockWorker] ✅ "${job.name}" done in ${Date.now() - start}ms`);
    for (const fn of completedListeners) fn(job);
  } catch (err) {
    job.status = 'failed';
    job.failedReason = (err as Error).message;
    console.error(`[MockWorker] ❌ "${job.name}" failed:`, (err as Error).message);
    for (const fn of failedListeners) fn(job, err as Error);
  }
}

const mockWorker = {
  on(event: string, handler: (...args: unknown[]) => void) {
    if (event === 'completed') completedListeners.push(handler as (job: MockJob) => void);
    if (event === 'failed') failedListeners.push(handler as (job: MockJob, err: Error) => void);
    return this;
  },
  async close() { console.log('[MockWorker] Closed'); },
};

// ── Public exports (same interface as original BullMQ version) ──

export const nightOwlQueue = mockQueue;
export const worker = mockWorker;

// ── Graceful shutdown ────────────────────────────────────────────

export async function closeQueue(): Promise<void> {
  await mockWorker.close();
  await mockQueue.close();
  console.log('[Queue] All queue resources closed');
}
