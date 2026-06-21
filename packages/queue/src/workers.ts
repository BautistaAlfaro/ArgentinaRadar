import { Worker, type RedisOptions, type Job } from 'bullmq';
import { QUEUE_CONFIGS } from './queues.js';
import { QueueName } from './types.js';
import type { QueueJobMap } from './types.js';

// ─── Logger helpers ────────────────────────────────────────────────────────
function log(level: 'info' | 'warn' | 'error', queue: string, msg: string, meta?: unknown): void {
  const ts = new Date().toISOString();
  const prefix = `[queue:${queue}]`;
  const line = meta ? `${prefix} ${msg} ${JSON.stringify(meta)}` : `${prefix} ${msg}`;

  switch (level) {
    case 'info':  console.log(`[${ts}] ${line}`); break;
    case 'warn':  console.warn(`[${ts}] ${line}`); break;
    case 'error': console.error(`[${ts}] ${line}`); break;
  }
}

// ─── Dead-letter handler ───────────────────────────────────────────────────
/**
 * Invoked when a job has exhausted all its retry attempts.
 * By default logs the failure; override to push to an external DLQ / monitoring.
 */
export type DeadLetterHandler = (
  queue: QueueName,
  job: Job,
  error: Error,
) => void | Promise<void>;

const defaultDeadLetterHandler: DeadLetterHandler = async (queue, job, error) => {
  log('error', queue,
    `[DLQ] Job ${job.id} (${job.name}) exhausted ${job.attemptsMade} attempts`,
    { data: job.data, error: error.message },
  );
};

// ─── Worker factory ────────────────────────────────────────────────────────
export interface WorkerOptions {
  connection: RedisOptions;
  concurrency?: number;
  deadLetterHandler?: DeadLetterHandler;
  autorun?: boolean;
}

/**
 * Processor function type – implement per-queue business logic.
 */
export type JobProcessor<N extends QueueName> = (
  job: Job,
) => Promise<void>;

/**
 * Create a single typed worker for the given queue.
 *
 * Handles:
 *  - lifecycle logging (start / complete / fail)
 *  - exponential back-off retries (configured per queue)
 *  - dead-letter notification when max attempts exhausted
 */
export function createWorker<N extends QueueName>(
  queue: N,
  processor: JobProcessor<N>,
  options: WorkerOptions,
): Worker {
  const cfg = QUEUE_CONFIGS[queue];
  const concurrency = options.concurrency ?? cfg.concurrency;

  const worker = new Worker(
    queue,
    async (job: Job) => {
      log('info', queue, `Processing job ${job.id}`, { name: job.name, data: job.data });
      await processor(job);
    },
    {
      connection: options.connection,
      concurrency,
      autorun: options.autorun ?? true,
    },
  );

  // ── Lifecycle events ──────────────────────────────────────────────────
  worker.on('active', (job: Job) => {
    log('info', queue, `Job ${job.id} started`, { name: job.name });
  });

  worker.on('completed', (job: Job) => {
    log('info', queue, `Job ${job.id} completed`, { name: job.name, duration: job.finishedOn! - job.processedOn! });
  });

  worker.on('failed', (job: Job | undefined, error: Error) => {
    if (!job) {
      log('error', queue, 'Job failed (no job reference)', { error: error.message });
      return;
    }

    const attempts = job.attemptsMade;
    const maxAttempts = job.opts.attempts ?? cfg.attempts;
    log('warn', queue, `Job ${job.id} failed (${attempts}/${maxAttempts})`,
      { name: job.name, error: error.message },
    );

    if (attempts >= maxAttempts) {
      const handler = options.deadLetterHandler ?? defaultDeadLetterHandler;
      const result = handler(queue, job, error);
      if (result instanceof Promise) {
        result.catch((dlqErr: Error) =>
          log('error', queue, 'Dead-letter handler threw', { error: dlqErr.message }),
        );
      }
    }
  });

  worker.on('error', (error: Error) => {
    log('error', queue, 'Worker error', { error: error.message });
  });

  return worker;
}

/**
 * Create all workers at once, one per queue.
 */
export function createWorkers(
  processors: { [N in QueueName]?: JobProcessor<N> },
  options: WorkerOptions,
): Worker[] {
  return (Object.values(QueueName) as QueueName[])
    .filter(name => processors[name])
    .map(name => createWorker(name, processors[name]!, options));
}

/**
 * Gracefully close all workers — waits for active jobs to finish.
 */
export async function closeWorkers(workers: Worker[]): Promise<void> {
  await Promise.all(workers.map(w => w.close()));
}
