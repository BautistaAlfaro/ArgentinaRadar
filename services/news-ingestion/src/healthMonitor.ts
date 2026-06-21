/**
 * Source Health Monitor
 *
 * Tracks per-source success/failure counts in the DB.
 * After 3 consecutive failures → mark as 'degraded'
 * After 10 consecutive failures → mark as 'disabled'
 * Auto-recovery: disabled sources are retried once per hour
 */

import { getDb } from './db.js';
import type { Source, SourceStatus } from './config.js';

const DEGRADED_THRESHOLD = 3;
const DISABLED_THRESHOLD = 10;
const AUTO_RECOVERY_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/** Record a successful fetch for a source. Resets consecutive failures. */
export function recordSuccess(sourceName: string): void {
  try {
    const db = getDb();
    db.prepare(
      'UPDATE sources SET consecutive_failures = 0, last_error = NULL, status = ? WHERE name = ?',
    ).run('healthy', sourceName);
  } catch (err) {
    console.error(`[healthMonitor] Failed to record success for "${sourceName}":`, err);
  }
}

/** Record a failed fetch. Increments consecutive_failures and degrades/disabled if threshold reached. */
export function recordFailure(sourceName: string, errorMsg: string): void {
  try {
    const db = getDb();
    const row = db.prepare(
      'SELECT consecutive_failures, status FROM sources WHERE name = ?',
    ).get(sourceName) as { consecutive_failures: number; status: string } | undefined;

    if (!row) {
      console.warn(`[healthMonitor] Source "${sourceName}" not found in DB`);
      return;
    }

    const failures = (row.consecutive_failures ?? 0) + 1;

    // Determine new status based on failure count
    let newStatus: SourceStatus = 'healthy';
    if (failures >= DISABLED_THRESHOLD) {
      newStatus = 'disabled';
    } else if (failures >= DEGRADED_THRESHOLD) {
      newStatus = 'degraded';
    }

    db.prepare(
      'UPDATE sources SET consecutive_failures = ?, last_error = ?, status = ?, last_fetched_at = datetime(?) WHERE name = ?',
    ).run(failures, errorMsg.slice(0, 500), new Date().toISOString(), sourceName);

    if (newStatus === 'disabled') {
      console.error(`[healthMonitor] ❌ Source "${sourceName}" DISABLED after ${failures} consecutive failures: ${errorMsg}`);
    } else if (newStatus === 'degraded') {
      console.warn(`[healthMonitor] ⚠️ Source "${sourceName}" degraded (${failures} failures): ${errorMsg}`);
    }
  } catch (err) {
    console.error(`[healthMonitor] Failed to record failure for "${sourceName}":`, err);
  }
}

/**
 * Attempt to recover disabled sources by trying them.
 * Called periodically (every hour) from the main loop.
 * Returns a list of source names that were recovered to 'healthy'.
 */
export function tryRecoverDisabledSources(allSources: Source[]): string[] {
  const db = getDb();
  const disabled = db.prepare(
    "SELECT name FROM sources WHERE status = 'disabled'",
  ).all() as Array<{ name: string }>;

  if (disabled.length === 0) return [];

  const disabledNames = new Set(disabled.map((r) => r.name));
  const toRetry = allSources.filter((s) => disabledNames.has(s.name));

  console.log(`[healthMonitor] 🔄 Attempting recovery of ${toRetry.length} disabled source(s): ${toRetry.map(s => s.name).join(', ')}`);

  // Reset to degraded so the next fetch cycle will try them
  for (const s of toRetry) {
    db.prepare(
      "UPDATE sources SET status = 'degraded', consecutive_failures = ? WHERE name = ?",
    ).run(DEGRADED_THRESHOLD, s.name);
  }

  return toRetry.map((s) => s.name);
}

/**
 * Get the current health status of all sources.
 */
export function getSourceHealth(): Array<{
  name: string;
  status: string;
  consecutive_failures: number;
  last_error: string | null;
  last_fetched_at: string | null;
}> {
  const db = getDb();
  return db.prepare(
    'SELECT name, status, consecutive_failures, last_error, last_fetched_at FROM sources ORDER BY name',
  ).all() as Array<{
    name: string;
    status: string;
    consecutive_failures: number;
    last_error: string | null;
    last_fetched_at: string | null;
  }>;
}

export { DEGRADED_THRESHOLD, DISABLED_THRESHOLD, AUTO_RECOVERY_INTERVAL_MS };
