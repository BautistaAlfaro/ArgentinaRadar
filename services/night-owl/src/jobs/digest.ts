/**
 * Night Owl — Digest Job (stub)
 *
 * Scheduled: 02:00 ART
 * Generates the daily summary digest (key events, trends, stats).
 */

import type { JobFn } from './index.js';

export const runDigest: JobFn = async (_data) => {
  console.log('[Job:digest] Starting — no-op stub (PR 3)');
};
