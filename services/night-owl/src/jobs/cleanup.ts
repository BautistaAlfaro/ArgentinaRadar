/**
 * Night Owl — Cleanup Job (stub)
 *
 * Scheduled: 05:00 ART
 * Purges stale data, archives old events, rotates logs.
 */

import type { JobFn } from './index.js';

export const runCleanup: JobFn = async (_data) => {
  console.log('[Job:cleanup] Starting — no-op stub (PR 2)');
};
