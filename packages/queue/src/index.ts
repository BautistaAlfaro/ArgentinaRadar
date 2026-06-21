// ─── Queue package — @argentinaradar/queue ────────────────────────────────
//
// Redis-backed job queue infrastructure powered by BullMQ.
//
// Usage:
//   import { createRedisConnection, createQueues, createWorker } from '@argentinaradar/queue';
//
//   const conn = createRedisConnection();
//   const queues = createQueues(conn);
//   const worker = createWorker('ingestion', async (job) => { … }, { connection: conn });
//
//   // Graceful shutdown
//   import { closeWorker, closeQueues, closeRedisConnection } from '@argentinaradar/queue';
//   await closeWorker(worker);
//   await closeQueues(queues);
//   await closeRedisConnection(conn);
// ────────────────────────────────────────────────────────────────────────────

export * from './types.js';
export * from './redis.js';
export * from './queues.js';
export * from './workers.js';
