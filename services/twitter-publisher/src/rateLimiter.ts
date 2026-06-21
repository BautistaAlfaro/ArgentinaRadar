/**
 * Tweet rate limiter with monthly, daily, and cooldown enforcement.
 *
 * Monthly limit:  1 400 tweets (Free tier = 1 500, safety buffer = 100)
 * Daily limit:      50 tweets
 * Cooldown:          5 minutes between tweets
 *
 * All tracking uses the shared SQLite tweet_history table.
 */

import Database from 'better-sqlite3';
import { config } from './config.js';

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
// Monthly
// ---------------------------------------------------------------------------

/**
 * Return the number of successfully posted tweets in the current calendar month.
 */
export function getMonthlyTweetCount(): number {
  const d = getDb();
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const row = d
    .prepare(
      `SELECT COUNT(*) as count FROM tweet_history
       WHERE strftime('%Y-%m', posted_at) = ? AND status = 'success'`
    )
    .get(month) as { count: number } | undefined;

  return row?.count ?? 0;
}

/**
 * Return how many tweets can still be posted this month before hitting the safety limit.
 */
export function getRemainingQuota(): number {
  return Math.max(0, config.publishing.monthlyLimit - getMonthlyTweetCount());
}

/**
 * Check whether we are allowed to publish another tweet this month.
 */
export function canPublishMonthly(): boolean {
  return getRemainingQuota() > 0;
}

// ---------------------------------------------------------------------------
// Daily
// ---------------------------------------------------------------------------

/**
 * Return the number of successfully posted tweets today.
 */
export function getDailyTweetCount(): number {
  const d = getDb();
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const row = d
    .prepare(
      `SELECT COUNT(*) as count FROM tweet_history
       WHERE date(posted_at) = ? AND status = 'success'`
    )
    .get(dateStr) as { count: number } | undefined;

  return row?.count ?? 0;
}

/**
 * Check whether we have remaining daily quota.
 */
export function canPublishDaily(): boolean {
  return getDailyTweetCount() < config.publishing.dailyLimit;
}

// ---------------------------------------------------------------------------
// Cooldown
// ---------------------------------------------------------------------------

/**
 * Milliseconds since the last successful tweet, or `null` if no tweets exist.
 */
export function getMsSinceLastTweet(): number | null {
  const d = getDb();
  const row = d
    .prepare(
      `SELECT posted_at FROM tweet_history
       WHERE status = 'success' AND posted_at IS NOT NULL
       ORDER BY posted_at DESC LIMIT 1`
    )
    .get() as { posted_at: string } | undefined;

  if (!row) return null;

  const lastTime = new Date(row.posted_at + 'Z').getTime();
  return Date.now() - lastTime;
}

/**
 * Check whether the cooldown period has elapsed since the last tweet.
 */
export function isCooldownElapsed(): boolean {
  const msSince = getMsSinceLastTweet();
  if (msSince === null) return true; // never tweeted before
  return msSince >= config.publishing.cooldownMs;
}

// ---------------------------------------------------------------------------
// Combined checks
// ---------------------------------------------------------------------------

/**
 * Check ALL rate limits before publishing a new tweet.
 */
export function canPublish(): boolean {
  return canPublishMonthly() && canPublishDaily() && isCooldownElapsed();
}

/**
 * Return a human-friendly quota snapshot including daily info.
 */
export function getQuotaInfo(): {
  used: number;
  remaining: number;
  limit: number;
  month: string;
  dailyUsed: number;
  dailyRemaining: number;
  dailyLimit: number;
} {
  const used = getMonthlyTweetCount();
  const dailyUsed = getDailyTweetCount();
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  return {
    used,
    remaining: config.publishing.monthlyLimit - used,
    limit: config.publishing.monthlyLimit,
    month,
    dailyUsed,
    dailyRemaining: config.publishing.dailyLimit - dailyUsed,
    dailyLimit: config.publishing.dailyLimit,
  };
}
