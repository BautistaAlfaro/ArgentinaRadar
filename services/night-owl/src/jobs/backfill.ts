/**
 * Night Owl — Backfill Job (stub)
 *
 * Scheduled: 01:00 ART
 * Re-processes yesterday's articles that may have been missed or
 * arrived after the daily ingestion window closed.
 */

import type { JobFn } from './index.js';

export const runBackfill: JobFn = async (_data) => {
  console.log('[Job:backfill] Starting — no-op stub (PR 2)');
};
