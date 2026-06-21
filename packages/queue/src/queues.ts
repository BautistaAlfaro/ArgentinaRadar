import { Queue, type RedisOptions } from 'bullmq';
import { QueueName, JOB_REMOVE_POLICY, type QueueConfigMap } from './types.js';

// ─── Per-queue concurrency and retry defaults ──────────────────────────────
export const QUEUE_CONFIGS: QueueConfigMap = {
  [QueueName.Ingestion]: {
    concurrency: 3,
    attempts: 5,
    backoffDelay: 2_000,
    backoffType: 'exponential',
  },
  [QueueName.Geolocation]: {
    concurrency: 5,
    attempts: 3,
    backoffDelay: 1_000,
    backoffType: 'exponential',
  },
  [QueueName.AiProcessing]: {
    concurrency: 2,
    attempts: 3,
    backoffDelay: 5_000,
    backoffType: 'exponential',
  },
  [QueueName.EventDetection]: {
    concurrency: 2,
    attempts: 3,
    backoffDelay: 2_000,
    backoffType: 'exponential',
  },
  [QueueName.TwitterPublish]: {
    concurrency: 1,
    attempts: 5,
    backoffDelay: 30_000,
    backoffType: 'exponential',
  },
  [QueueName.TrendAnalysis]: {
    concurrency: 1,
    attempts: 2,
    backoffDelay: 60_000,
    backoffType: 'exponential',
  },
};

// ─── Queue factory ─────────────────────────────────────────────────────────
export interface QueuesMap {
  [QueueName.Ingestion]:      Queue;
  [QueueName.Geolocation]:    Queue;
  [QueueName.AiProcessing]:   Queue;
  [QueueName.EventDetection]: Queue;
  [QueueName.TwitterPublish]: Queue;
  [QueueName.TrendAnalysis]:  Queue;
}

/**
 * Create all production queues with their default job options.
 */
export function createQueues(connection: RedisOptions): QueuesMap {
  const queues: Record<string, Queue> = {};

  for (const [name, cfg] of Object.entries(QUEUE_CONFIGS)) {
    const queue = new Queue(name, {
      connection,
      defaultJobOptions: {
        attempts: cfg.attempts,
        backoff: { type: cfg.backoffType ?? 'exponential', delay: cfg.backoffDelay },
        ...JOB_REMOVE_POLICY,
      },
    });
    queues[name] = queue;
  }

  return queues as unknown as QueuesMap;
}

/**
 * Close all queues gracefully (waits for pending operations, then disconnects).
 */
export async function closeQueues(queues: QueuesMap): Promise<void> {
  await Promise.all(
    Object.values(queues).map(q => q.close()),
  );
}
