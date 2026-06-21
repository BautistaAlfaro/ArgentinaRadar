/**
 * Night Owl — Cron Scheduler
 *
 * Uses node-cron to schedule the 7 nightly jobs.
 * Each job simply adds a job to the BullMQ queue.
 * The worker (in queue.ts) handles actual execution.
 *
 * Timezone: America/Argentina/Buenos_Aires
 */

import cron from 'node-cron';
import { config } from './config.js';
import { nightOwlQueue } from './queue.js';

// ── Schedule definitions ─────────────────────────────────────────

interface ScheduleEntry {
  name: string;
  cron: string;      // minute hour * * *
  description: string;
}

/**
 * All jobs run overnight to avoid competing with the real-time pipeline.
 * Times are in Argentina time (UTC-3).
 */
const SCHEDULE: ScheduleEntry[] = [
  { name: 'backfill',   cron: '0 1 * * *',   description: '01:00 — Re-process missed articles' },
  { name: 'digest',     cron: '0 2 * * *',   description: '02:00 — Generate daily summary digest' },
  { name: 'pattern',    cron: '0 3 * * *',   description: '03:00 — Heavy pattern detection' },
  { name: 'optimizer',  cron: '30 3 * * *',  description: '03:30 — Re-train / tune ML models' },
  { name: 'predictive', cron: '0 4 * * *',   description: '04:00 — Forward-looking predictions' },
  { name: 'cleanup',    cron: '0 5 * * *',   description: '05:00 — Purge stale data' },
  { name: 'health',     cron: '30 5 * * *',  description: '05:30 — End-of-cycle health check' },
];

// ── Enqueue helper ───────────────────────────────────────────────

async function enqueueJob(jobName: string): Promise<void> {
  console.log(`[Scheduler] Enqueuing "${jobName}"`);
  await nightOwlQueue.add(jobName, { scheduledAt: new Date().toISOString() });
}

// ── Start schedulers ─────────────────────────────────────────────

const tasks: cron.ScheduledTask[] = [];

export function startSchedulers(): void {
  if (!config.enabled) {
    console.log('[Scheduler] DISABLED (NIGHT_OWL_ENABLED=false)');
    return;
  }

  console.log(`[Scheduler] Timezone: ${config.timezone}`);
  console.log(`[Scheduler] Budget per night: $${config.budgetPerNight.toFixed(2)}`);

  for (const entry of SCHEDULE) {
    const valid = cron.validate(entry.cron);
    if (!valid) {
      console.error(`[Scheduler] Invalid cron expression for "${entry.name}": ${entry.cron}`);
      continue;
    }

    const task = cron.schedule(
      entry.cron,
      () => {
        enqueueJob(entry.name).catch((err) =>
          console.error(`[Scheduler] Failed to enqueue "${entry.name}":`, err),
        );
      },
      {
        scheduled: true,
        timezone: config.timezone,
      },
    );

    tasks.push(task);
    console.log(`[Scheduler] Scheduled "${entry.name}" — ${entry.description}`);
  }

  console.log(`[Scheduler] ${tasks.length}/${SCHEDULE.length} jobs scheduled`);
}

export function stopSchedulers(): void {
  for (const task of tasks) {
    task.stop();
  }
  tasks.length = 0;
  console.log('[Scheduler] All cron tasks stopped');
}
