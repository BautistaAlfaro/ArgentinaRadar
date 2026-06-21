/**
 * Monthly tweet rate limiter.
 *
 * Tracks tweets posted this month via SQLite's tweet_history table.
 * The Free Twitter API tier allows 1 500 tweets/month. We halt at 1 400
 * to leave a safety buffer for manual tweets.
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
// Public API
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
export function canPublish(): boolean {
  return getRemainingQuota() > 0;
}

/**
 * Return a human-friendly quota snapshot.
 */
export function getQuotaInfo(): {
  used: number;
  remaining: number;
  limit: number;
  month: string;
} {
  const used = getMonthlyTweetCount();
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  return {
    used,
    remaining: config.publishing.monthlyLimit - used,
    limit: config.publishing.monthlyLimit,
    month,
  };
}
