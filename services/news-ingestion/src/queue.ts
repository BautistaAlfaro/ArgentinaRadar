/**
 * queue — BullMQ producer for the geolocation queue
 *
 * After an article is ingested and AI-enriched it is pushed to the
 * 'geolocation' queue for downstream geo-resolution.
 *
 * Graceful fallback: when Redis is unavailable the producer logs a
 * warning once and silently skips subsequent enqueues — the system
 * continues with its existing polling behaviour.
 */

import { Queue } from 'bullmq';
import { REDIS_HOST, REDIS_PORT } from './config.js';

// ─── State ─────────────────────────────────────────────────────────

let queue: Queue | null = null;
let redisWarned = false;

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Lazily initialise the BullMQ queue. Returns `null` when Redis is
 * unreachable (graceful degradation, warning logged once).
 */
function getOrInitQueue(): Queue | null {
  if (queue) return queue;

  try {
    queue = new Queue('geolocation', {
      connection: {
        host: REDIS_HOST,
        port: REDIS_PORT,
        maxRetriesPerRequest: null,      // BullMQ manages its own retries
        retryStrategy: () => null,        // don't auto-reconnect — fall back fast
      },
    });
    console.log(`[queue] BullMQ producer ready — Redis at ${REDIS_HOST}:${REDIS_PORT}`);
    return queue;
  } catch (err: unknown) {
    if (!redisWarned) {
      redisWarned = true;
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[queue] Redis unavailable — falling back to polling: ${message}`);
    }
    return null;
  }
}

// ─── Public API ────────────────────────────────────────────────────

/**
 * Enqueue an article for geo-resolution.
 *
 * Silently no-ops when Redis is unavailable (graceful degradation).
 *
 * @param articleId — UUID / hash of the article
 * @param title     — article title (used downstream for geo-hints)
 * @param summary   — article summary (used downstream for NER)
 */
export async function pushToGeolocationQueue(
  articleId: string,
  title: string,
  summary: string,
): Promise<void> {
  const q = getOrInitQueue();
  if (!q) return;

  try {
    await q.add(
      'geolocate',
      { articleId, title, summary },
      {
        removeOnComplete: 100,   // keep last 100 completed jobs
        removeOnFail: 50,        // keep last 50 failed jobs
      },
    );
    console.log(`[queue] Pushed article ${articleId} → geolocation queue`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[queue] Failed to enqueue article ${articleId}: ${message}`);
  }
}
