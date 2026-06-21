/**
 * Auto-publish background loop.
 *
 * Polls the event-detector service for trending events with impact >= 50,
 * formats each for publishing, posts via Bluesky and/or Twitter,
 * and records the result in tweet_history.
 *
 * Publishing rules:
 *  - Auto-publish events with impact >= 50 (no Telegram approval needed)
 *  - Skip events with impact < 30 (too low to be worth publishing)
 *  - Events with impact 30–49 go through Telegram approval (hermes-bridge)
 *  - Cooldown: minimum 5 minutes between posts
 *  - Daily limit: 20 posts max
 *  - Monthly rate limit (1400 / 1500 — from rateLimiter.ts)
 *  - Runs every 5 minutes by default.
 *  - If event-detector is unreachable, logs the error and retries next cycle.
 */

import Database from 'better-sqlite3';
import { config } from './config.js';
import { fetchTrendingEvents } from './eventClient.js';
import type { TrendingEvent } from './eventClient.js';
import { formatEventTweet } from './formatter.js';
import { postTweet } from './twitterClient.js';
import { postToBluesky, type BlueskyPostResult } from './blueskyClient.js';
import {
  canPublishMonthly,
  canPublishDaily,
  isCooldownElapsed,
  getQuotaInfo,
} from './rateLimiter.js';
import { moveToDeadLetter } from './deadLetter.js';
import { createLoop } from '@shared/utils/shutdown';

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
let _autoPublishLoop: ReturnType<typeof createLoop> | null = null;

export function startAutoPublish(): void {
  if (_autoPublishLoop) return;
  console.log(
    '[autoPublish] Starting event-based auto-publish loop ' +
      `(every ${Math.round(POLL_INTERVAL / 1000)}s, impact >= 50, ` +
      `daily limit ${config.publishing.dailyLimit}, cooldown ${Math.round(config.publishing.cooldownMs / 1000)}s)`
  );
  _autoPublishLoop = createLoop('autoPublish', runAutoPublish, POLL_INTERVAL);
  _autoPublishLoop.start();
}

export function stopAutoPublish(): void {
  _autoPublishLoop?.stop();
  _autoPublishLoop = null;
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

      const postText = formatEventTweet({
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

      // ── Attempt post with retries ─────────────────────────────
      // Primary: Bluesky. Secondary: Twitter (if configured).
      let lastError: string | null = null;
      let published = false;

      for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
        try {
          // ── Publish to Bluesky (primary channel) ──────────────
          if (config.bluesky.enabled && config.bluesky.password) {
            const bsky: BlueskyPostResult = await postToBluesky(postText, config);
            console.log(`[autoPublish] ✅ Bluesky: ${bsky.uri}`);

            // Update tweet_history with Bluesky URI
            d.prepare(
              `UPDATE tweet_history
               SET tweet_id = ?, status = 'success', posted_at = datetime('now')
               WHERE id = ?`
            ).run(bsky.uri, historyId);

            published = true;
          }

          // ── Also post to Twitter (if credentials configured) ──
          const twitterConfigured = !!(config.twitter.apiKey && config.twitter.accessToken);
          if (twitterConfigured) {
            try {
              const result = await postTweet(postText);
              console.log(
                `[autoPublish] ✅ Twitter: ${result.tweetId} for "${event.title.slice(0, 60)}..."`
              );

              // Update tweet_history with Twitter tweet ID
              d.prepare(
                `UPDATE tweet_history
                 SET tweet_id = ?, status = 'success', posted_at = datetime('now')
                 WHERE id = ?`
              ).run(result.tweetId, historyId);

              published = true;
            } catch (twErr) {
              console.warn(`[autoPublish] ⚠️ Twitter failed:`, (twErr as Error).message);
              // Don't fail the pipeline — Bluesky is the primary channel
            }
          }

          if (published) {
            // If neither Bluesky nor Twitter published, we'll hit the retry logic
            break;
          }

          // Neither channel published — mark as failure
          lastError = 'No publishing channel available (check credentials)';
          break;
        } catch (err) {
          lastError = String(err);

          if (attempt < RETRY_DELAYS.length) {
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

          // Non-retryable error — break
          break;
        }
      }

      // All retries exhausted — dead-letter
      if (!published && lastError) {
        d.prepare(
          "UPDATE tweet_history SET status = 'failed', error = ? WHERE id = ?"
        ).run(lastError, historyId);

        moveToDeadLetter(
          event.id,
          event.title,
          lastError,
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
