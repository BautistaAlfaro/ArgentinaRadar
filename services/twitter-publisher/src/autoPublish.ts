/**
 * Auto-publish background loop.
 *
 * Polls the shared SQLite database for articles with status 'filtered'
 * (i.e. AI approved for publishing), formats each as a tweet, posts it
 * via the Twitter API, and records the result.
 *
 * Safeguards:
 *  - Max 10 tweets per hour (spam prevention).
 *  - Respects the monthly rate limit (1 400 / 1 500).
 *  - Runs every 5 minutes by default.
 */

import Database from 'better-sqlite3';
import { config } from './config.js';
import { publishArticle } from './publisher.js';
import { canPublish, getQuotaInfo } from './rateLimiter.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLL_INTERVAL = config.publishing.pollIntervalMs;
const MAX_PER_HOUR = config.publishing.maxTweetsPerHour;
const INTER_PUBLISH_DELAY = config.publishing.interPublishDelayMs;

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
// Hourly rate tracking
// ---------------------------------------------------------------------------

let publishedThisHour = 0;
const HOUR_MS = 60 * 60 * 1000;

function resetHourlyCounter(): void {
  publishedThisHour = 0;
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
    `[autoPublish] 🔄 Starting auto-publish loop ` +
      `(every ${Math.round(POLL_INTERVAL / 1000)}s, max ${MAX_PER_HOUR}/hour)`
  );

  // Reset hourly counter every hour
  setInterval(resetHourlyCounter, HOUR_MS);

  // First run immediately, then on interval
  runAutoPublish();
  setInterval(runAutoPublish, POLL_INTERVAL);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function runAutoPublish(): Promise<void> {
  try {
    // ── Pre-flight checks ─────────────────────────────────────
    if (!canPublish()) {
      const quota = getQuotaInfo();
      console.log(
        `[autoPublish] ⏸️  Skipping — monthly rate limit reached (${quota.used}/${quota.limit})`
      );
      return;
    }

    if (publishedThisHour >= MAX_PER_HOUR) {
      console.log(
        `[autoPublish] ⏸️  Skipping — hourly limit reached (${publishedThisHour}/${MAX_PER_HOUR})`
      );
      return;
    }

    // ── Fetch approved but un-published articles ──────────────
    const d = getDb();
    const articles = d
      .prepare(
        `SELECT id, title, source, url, location
         FROM news_items
         WHERE status = 'filtered'
           AND tweet_id IS NULL
         ORDER BY published_at ASC
         LIMIT ?`
      )
      .all(MAX_PER_HOUR - publishedThisHour) as Array<Record<string, unknown>>;

    if (articles.length === 0) {
      console.log('[autoPublish] ℹ️  No new articles to publish');
      return;
    }

    console.log(`[autoPublish] 📰 Publishing ${articles.length} article(s)...`);

    // ── Publish each —─────────────────────────────────────────
    for (const article of articles) {
      // Re-check limits between publishes
      if (!canPublish()) break;
      if (publishedThisHour >= MAX_PER_HOUR) break;

      // Parse location
      let locationStr: string | null = null;
      if (article.location) {
        const loc =
          typeof article.location === 'string'
            ? JSON.parse(article.location)
            : article.location;
        locationStr =
          (loc as { city?: string }).city ??
          (loc as { province?: string }).province ??
          null;
      }

      const result = await publishArticle(
        String(article.id),
        String(article.title ?? ''),
        String(article.source ?? ''),
        locationStr,
        String(article.url ?? ''),
      );

      if (result.success) {
        publishedThisHour++;
        console.log(`[autoPublish] ✅ Published: ${String(article.title).slice(0, 60)}…`);
      } else {
        console.error(
          `[autoPublish] ❌ Failed: ${String(article.title).slice(0, 60)}… — ${result.error}`
        );
      }

      // Small delay between publishes
      await sleep(INTER_PUBLISH_DELAY);
    }
  } catch (err) {
    console.error('[autoPublish] 💥 Error:', err);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
