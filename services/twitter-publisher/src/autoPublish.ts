/**
 * Auto-publish background loop.
 *
 * Polls the event-detector service for trending events with impact >= 70
 * (high-impact), formats each as a tweet, posts it via the Twitter API,
 * and records the result in tweet_history.
 *
 * Events with impact 50–69 are NOT handled here — they go through the
 * Telegram approval workflow in hermes-bridge instead.
 *
 * Safeguards:
 *  - Monthly rate limit  (1 400 / 1 500 — from rateLimiter.ts)
 *  - Daily rate limit    (50 tweets max — from rateLimiter.ts)
 *  - Cooldown            (5 minutes between tweets — from rateLimiter.ts)
 *  - Runs every 5 minutes by default.
 *  - If event-detector is unreachable, logs the error and retries next cycle.
 */

import Database from 'better-sqlite3';
import { config } from './config.js';
import { fetchTrendingEvents } from './eventClient.js';
import type { TrendingEvent } from './eventClient.js';
import { formatEventTweet } from './formatter.js';
import { postTweet, TwitterApiError } from './twitterClient.js';
import { postToBluesky } from './blueskyClient.js';
import {
  canPublishMonthly,
  canPublishDaily,
  isCooldownElapsed,
  getQuotaInfo,
} from './rateLimiter.js';
import { moveToDeadLetter } from './deadLetter.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLL_INTERVAL = config.publishing.pollIntervalMs;

/** Backoff delays in ms: 60 s, 300 s (5 min). */
const RETRY_DELAYS = [60_000, 300_000] as const;

// ---------------------------------------------------------------------------
// DB singleton
// ---------------------------------------------------------------------------

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;
  db = new Database(config.db.path);
  db.pragma('journal_mode = WAL');
  return db;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the auto-publish background loop.
 *
 * Runs an immediate check on start, then repeats every `POLL_INTERVAL`.
 */
export function startAutoPublish(): void {
  console.log(
    '[autoPublish] Starting event-based auto-publish loop ' +
      `(every ${Math.round(POLL_INTERVAL / 1000)}s, impact >= 70)`
  );

  // First run immediately, then on interval
  runAutoPublish();
  setInterval(runAutoPublish, POLL_INTERVAL);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function runAutoPublish(): Promise<void> {
  try {
    // ── Pre-flight: rate limits ────────────────────────────────
    if (!canPublishMonthly()) {
      const quota = getQuotaInfo();
      console.log(
        '[autoPublish] Skipping - monthly rate limit reached ' +
          `(${quota.used}/${quota.limit})`
      );
      return;
    }

    if (!canPublishDaily()) {
      const quota = getQuotaInfo();
      console.log(
        '[autoPublish] Skipping - daily limit reached ' +
          `(${quota.dailyUsed}/${quota.dailyLimit})`
      );
      return;
    }

    if (!isCooldownElapsed()) {
      console.log('[autoPublish] Skipping - cooldown active');
      return;
    }

    // ── Fetch trending events ──────────────────────────────────
    let events: TrendingEvent[];
    try {
      events = await fetchTrendingEvents();
    } catch (err) {
      console.error(
        '[autoPublish] Event-detector unreachable - will retry next cycle: ' +
          String(err)
      );
      return;
    }

    // Filter out already-tweeted events
    const d = getDb();
    const alreadyTweeted = new Set(
      (
        d
          .prepare(
            `SELECT DISTINCT article_id FROM tweet_history
             WHERE article_id IS NOT NULL AND status = 'success'`
          )
          .all() as Array<{ article_id: string }>
      ).map((r) => r.article_id)
    );

    const pending = events.filter((e) => !alreadyTweeted.has(e.id));

    if (pending.length === 0) {
      console.log('[autoPublish] No new high-impact events to publish');
      return;
    }

    console.log(`[autoPublish] Publishing ${pending.length} event(s)...`);

    // ── Publish each pending event ──────────────────────────────
    for (const event of pending) {
      // Re-check limits between publishes
      if (!canPublishMonthly()) break;
      if (!canPublishDaily()) break;

      const tweetText = formatEventTweet({
        title: event.title,
        sourceCount: event.sources.length,
        impact: event.impact,
        consensus: event.consensus,
      });

      // Record attempt in tweet_history
      const { lastInsertRowid: historyId } = d
        .prepare(
          "INSERT INTO tweet_history (article_id, status) VALUES (?, 'pending')"
        )
        .run(event.id);

      // Attempt posting with retries
      let lastError: string | null = null;

      for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
        try {
          const result = await postTweet(tweetText);

          // Success - update tweet_history
          d.prepare(
            `UPDATE tweet_history
             SET tweet_id = ?, status = 'success', posted_at = datetime('now')
             WHERE id = ?`
          ).run(result.tweetId, historyId);

          console.log(
            `[autoPublish] Published event "${event.title.slice(0, 60)}..." ` +
              `-> tweet ${result.tweetId}`
          );

          // Also post to Bluesky (non-critical — never fail the pipeline)
          if (config.bluesky.enabled && config.bluesky.password) {
            try {
              const bsky = await postToBluesky(tweetText, config);
              console.log(`[autoPublish] ✅ Bluesky: ${bsky.uri}`);
              await sleep(1000); // rate limit courtesy delay
            } catch (err) {
              console.warn(`[autoPublish] ⚠️ Bluesky failed:`, (err as Error).message);
            }
          }

          break; // exit retry loop
        } catch (err) {
          lastError = String(err);

          if (
            err instanceof TwitterApiError &&
            err.isRetryable &&
            attempt < RETRY_DELAYS.length
          ) {
            const delay = RETRY_DELAYS[attempt];
            console.warn(
              `[autoPublish] Retry ${attempt + 1}/${RETRY_DELAYS.length} ` +
                `for event ${event.id.slice(0, 8)}... ` +
                `in ${Math.round(delay / 1000)}s: ${lastError}`
            );
            d.prepare(
              "UPDATE tweet_history SET status = 'retrying', error = ? WHERE id = ?"
            ).run(lastError, historyId);
            await sleep(delay);
            continue;
          }

          if (attempt < RETRY_DELAYS.length) {
            // Non-Twitter error (network, etc.) - still retry
            const delay = RETRY_DELAYS[attempt];
            console.warn(
              `[autoPublish] Network retry ${attempt + 1}/${RETRY_DELAYS.length} ` +
                `in ${Math.round(delay / 1000)}s: ${lastError}`
            );
            d.prepare(
              "UPDATE tweet_history SET status = 'retrying', error = ? WHERE id = ?"
            ).run(lastError, historyId);
            await sleep(delay);
            continue;
          }

          // Non-retryable error - break
          break;
        }
      }

      // All retries exhausted - dead-letter
      if (lastError) {
        const finalError = lastError;
        d.prepare(
          "UPDATE tweet_history SET status = 'failed', error = ? WHERE id = ?"
        ).run(finalError, historyId);

        moveToDeadLetter(
          event.id,
          event.title,
          finalError,
          RETRY_DELAYS.length
        );
      }
    }
  } catch (err) {
    console.error('[autoPublish] Error:', err);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
