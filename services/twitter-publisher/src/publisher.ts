/**
 * Tweet publisher with retry logic and dead-letter fallback.
 *
 * Orchestrates the full publish pipeline:
 *   1. Check rate limit (monthly quota)
 *   2. Format tweet
 *   3. Post to Twitter (with exponential backoff on failure)
 *   4. Store result in tweet_history + update news_items
 *   5. On permanent failure → move to dead-letter queue
 */

import Database from 'better-sqlite3';
import { config } from './config.js';
import { TwitterApiError, postTweet, uploadMedia } from './twitterClient.js';
import { postToBluesky } from './blueskyClient.js';
import { formatTweet } from './formatter.js';
import { canPublish, getQuotaInfo } from './rateLimiter.js';
import { moveToDeadLetter } from './deadLetter.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Backoff delays in milliseconds: 60 s, 300 s (5 min), 900 s (15 min). */
const RETRY_DELAYS = [60_000, 300_000, 900_000] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PublishResult {
  success: boolean;
  tweetId?: string;
  error?: string;
  retries?: number;
}

// ---------------------------------------------------------------------------
// Singleton DB connection
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
 * Publish an article as a tweet with full retry and dead-letter handling.
 *
 * @param articleId UUID of the article in `news_items`.
 * @param headline  Article headline/text.
 * @param source    Source name.
 * @param location  Location string (may be null).
 * @param url       Article URL.
 * @returns `PublishResult` indicating success or failure details.
 */
export async function publishArticle(
  articleId: string,
  headline: string,
  source: string,
  location: string | null,
  url: string,
): Promise<PublishResult> {
  // ── 1. Check monthly rate limit ─────────────────────────────────
  if (!canPublish()) {
    const quota = getQuotaInfo();
    const msg = `Monthly rate limit reached (${quota.used}/${quota.limit})`;
    console.warn(`[publisher] ⛔ ${msg}`);
    return { success: false, error: msg };
  }

  // ── 2. Format tweet ─────────────────────────────────────────────
  let tweetText: string;
  try {
    tweetText = formatTweet({ headline, source, location, url });
  } catch (err) {
    return { success: false, error: `Format error: ${String(err)}` };
  }

  // ── 3. Record attempt in tweet_history ─────────────────────────
  const d = getDb();
  const { lastInsertRowid: historyId } = d
    .prepare("INSERT INTO tweet_history (article_id, status) VALUES (?, 'pending')")
    .run(articleId);

  // ── 4. Attempt posting with retries ────────────────────────────
  let lastError: string | null = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const result = await postTweet(tweetText);

      // ✅ Success
      d.prepare(
        `UPDATE tweet_history
         SET tweet_id = ?, status = 'success', posted_at = datetime('now')
         WHERE id = ?`
      ).run(result.tweetId, historyId);

      d.prepare(
        'UPDATE news_items SET tweet_id = ?, status = ? WHERE id = ?'
      ).run(result.tweetId, 'published', articleId);

      console.log(
        `[publisher] ✅ Article ${articleId.slice(0, 8)}… published → tweet ${result.tweetId}`
      );

      // Also post to Bluesky (non-critical — never fail the pipeline)
      if (config.bluesky.enabled && config.bluesky.password) {
        try {
          const bsky = await postToBluesky(tweetText, config);
          console.log(`[publisher] ✅ Bluesky: ${bsky.uri}`);
          await sleep(1000); // rate limit courtesy delay
        } catch (err) {
          console.warn(`[publisher] ⚠️ Bluesky failed:`, (err as Error).message);
        }
      }

      return { success: true, tweetId: result.tweetId };
    } catch (err) {
      lastError = String(err);

      if (err instanceof TwitterApiError && err.isRetryable && attempt < RETRY_DELAYS.length) {
        // Retryable error → wait and retry
        const delay = RETRY_DELAYS[attempt];
        console.warn(
          `[publisher] 🔄 Retry ${attempt + 1}/${RETRY_DELAYS.length} ` +
            `for ${articleId.slice(0, 8)}… in ${Math.round(delay / 1000)}s: ${lastError}`
        );
        d.prepare(
          "UPDATE tweet_history SET status = 'retrying', error = ? WHERE id = ?"
        ).run(lastError, historyId);
        await sleep(delay);
        continue;
      }

      if (attempt < RETRY_DELAYS.length) {
        // Non-Twitter error (network, etc.) — still retry
        const delay = RETRY_DELAYS[attempt];
        console.warn(
          `[publisher] 🔄 Network retry ${attempt + 1}/${RETRY_DELAYS.length} ` +
            `in ${Math.round(delay / 1000)}s: ${lastError}`
        );
        d.prepare(
          "UPDATE tweet_history SET status = 'retrying', error = ? WHERE id = ?"
        ).run(lastError, historyId);
        await sleep(delay);
        continue;
      }

      // Non-retryable error (auth, invalid tweet, etc.) — break immediately
      break;
    }
  }

  // ── 5. All retries exhausted → dead-letter ─────────────────────
  const finalError = lastError ?? 'Unknown error';
  d.prepare(
    "UPDATE tweet_history SET status = 'failed', error = ? WHERE id = ?"
  ).run(finalError, historyId);

  moveToDeadLetter(articleId, headline, finalError, RETRY_DELAYS.length);

  return { success: false, error: finalError, retries: RETRY_DELAYS.length };
}

// ---------------------------------------------------------------------------
// Publish arbitrary text (from approval workflow)
// ---------------------------------------------------------------------------

/**
 * Publish a tweet with explicitly provided text (bypasses formatting).
 *
 * Used by the approval workflow when a human-approved (or edited) draft
 * comes in from hermes-bridge via POST /api/publish-text.
 *
 * @param articleId UUID of the article in `news_items`.
 * @param text      The exact tweet text to post (must be ≤ 280 chars).
 * @returns `PublishResult` indicating success or failure details.
 */
export async function publishText(
  articleId: string,
  text: string,
  imageUrl?: string,
): Promise<PublishResult> {
  // ── 1. Check monthly rate limit ─────────────────────────────────
  if (!canPublish()) {
    const quota = getQuotaInfo();
    const msg = `Monthly rate limit reached (${quota.used}/${quota.limit})`;
    console.warn(`[publisher] ⛔ ${msg}`);
    return { success: false, error: msg };
  }

  // ── 2. Validate tweet length ────────────────────────────────────
  if (text.length > 280) {
    return { success: false, error: `Tweet too long (${text.length}/280 chars)` };
  }

  if (text.length === 0) {
    return { success: false, error: 'Tweet text is empty' };
  }

  const headline = text.slice(0, 60); // For logging only

  // ── 3. Upload image (if provided) ──────────────────────────────
  let mediaIds: string[] | undefined;
  if (imageUrl) {
    console.log(`[publisher] 🖼️  Uploading image for ${articleId.slice(0, 8)}…: ${imageUrl.slice(0, 80)}…`);
    try {
      const mediaId = await uploadMedia(imageUrl);
      mediaIds = [mediaId];
      console.log(`[publisher] ✅ Image uploaded: media_id=${mediaId}`);
    } catch (err) {
      // Image upload failed — log warning and proceed with text-only
      console.warn(`[publisher] ⚠️  Image upload failed, publishing text-only: ${String(err)}`);
    }
  }

  // ── 4. Record attempt in tweet_history ─────────────────────────
  const d = getDb();
  const { lastInsertRowid: historyId } = d
    .prepare("INSERT INTO tweet_history (article_id, status) VALUES (?, 'pending')")
    .run(articleId);

  // ── 5. Attempt posting with retries ────────────────────────────
  let lastError: string | null = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const result = await postTweet(text, mediaIds);

      // ✅ Success
      d.prepare(
        `UPDATE tweet_history
         SET tweet_id = ?, status = 'success', posted_at = datetime('now')
         WHERE id = ?`
      ).run(result.tweetId, historyId);

      d.prepare(
        'UPDATE news_items SET tweet_id = ?, status = ? WHERE id = ?'
      ).run(result.tweetId, 'published', articleId);

      console.log(
        `[publisher] ✅ Draft ${articleId.slice(0, 8)}… published → tweet ${result.tweetId}: "${headline}…"`
      );

      // Also post to Bluesky (non-critical — never fail the pipeline)
      if (config.bluesky.enabled && config.bluesky.password) {
        try {
          const bsky = await postToBluesky(text, config);
          console.log(`[publisher] ✅ Bluesky: ${bsky.uri}`);
          await sleep(1000); // rate limit courtesy delay
        } catch (err) {
          console.warn(`[publisher] ⚠️ Bluesky failed:`, (err as Error).message);
        }
      }

      return { success: true, tweetId: result.tweetId };
    } catch (err) {
      lastError = String(err);

      if (err instanceof TwitterApiError && err.isRetryable && attempt < RETRY_DELAYS.length) {
        const delay = RETRY_DELAYS[attempt];
        console.warn(
          `[publisher] 🔄 Retry ${attempt + 1}/${RETRY_DELAYS.length} ` +
            `for draft ${articleId.slice(0, 8)}… in ${Math.round(delay / 1000)}s: ${lastError}`
        );
        d.prepare(
          "UPDATE tweet_history SET status = 'retrying', error = ? WHERE id = ?"
        ).run(lastError, historyId);
        await sleep(delay);
        continue;
      }

      if (attempt < RETRY_DELAYS.length) {
        const delay = RETRY_DELAYS[attempt];
        console.warn(
          `[publisher] 🔄 Network retry ${attempt + 1}/${RETRY_DELAYS.length} ` +
            `in ${Math.round(delay / 1000)}s: ${lastError}`
        );
        d.prepare(
          "UPDATE tweet_history SET status = 'retrying', error = ? WHERE id = ?"
        ).run(lastError, historyId);
        await sleep(delay);
        continue;
      }

      break;
    }
  }

  // ── 5. All retries exhausted → dead-letter ─────────────────────
  const finalError = lastError ?? 'Unknown error';
  d.prepare(
    "UPDATE tweet_history SET status = 'failed', error = ? WHERE id = ?"
  ).run(finalError, historyId);

  moveToDeadLetter(articleId, headline, finalError, RETRY_DELAYS.length);

  return { success: false, error: finalError, retries: RETRY_DELAYS.length };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
