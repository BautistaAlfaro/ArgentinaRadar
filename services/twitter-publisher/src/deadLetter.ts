/**
 * Dead-letter queue for permanently failed tweet attempts.
 *
 * When a tweet has exhausted all retry attempts (3 tries with exponential
 * backoff: 60 s / 300 s / 900 s), the article is moved to the dead-letter
 * table with the last error details for manual inspection.
 */

import Database from 'better-sqlite3';
import { config } from './config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeadLetterEntry {
  id: number;
  article_id: string;
  headline: string | null;
  error: string | null;
  retry_count: number;
  last_attempt_at: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Singleton DB connection
// ---------------------------------------------------------------------------

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;
  db = new Database(config.db.path);
  db.pragma('journal_mode = WAL');

  // Ensure the dead-letter table exists (shared with other services)
  db.exec(`
    CREATE TABLE IF NOT EXISTS dead_letter_queue (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id       TEXT    NOT NULL,
      headline         TEXT,
      error            TEXT,
      retry_count      INTEGER DEFAULT 0,
      last_attempt_at  TEXT,
      created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (article_id) REFERENCES news_items(id)
    )
  `);

  return db;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Move a permanently-failed tweet to the dead-letter queue.
 *
 * Also updates the corresponding `tweet_history` row to status `dead_letter`.
 *
 * @param articleId  UUID of the news article.
 * @param headline   Article headline (for human reference in the queue).
 * @param error      Last error message from the failed attempt.
 * @param retryCount How many retries were attempted before giving up.
 */
export function moveToDeadLetter(
  articleId: string,
  headline: string | null,
  error: string,
  retryCount: number,
): void {
  const d = getDb();

  // Insert into dead-letter queue
  d.prepare(
    `INSERT INTO dead_letter_queue (article_id, headline, error, retry_count, last_attempt_at)
     VALUES (?, ?, ?, ?, datetime('now'))`
  ).run(articleId, headline, error, retryCount);

  // Update the matching tweet_history rows
  d.prepare(
    `UPDATE tweet_history
     SET status = 'dead_letter', error = ?
     WHERE article_id = ? AND status IN ('failed', 'retrying')`
  ).run(error, articleId);

  console.log(
    `[deadLetter] 🗂️  Article ${articleId.slice(0, 8)}… moved to dead-letter queue (retries: ${retryCount})`
  );
}

/**
 * Return all entries currently in the dead-letter queue, newest first.
 */
export function getDeadLetterQueue(): DeadLetterEntry[] {
  const d = getDb();
  return d.prepare(
    'SELECT * FROM dead_letter_queue ORDER BY created_at DESC'
  ).all() as DeadLetterEntry[];
}

/**
 * Return the count of entries in the dead-letter queue.
 */
export function getDeadLetterCount(): number {
  const d = getDb();
  const row = d.prepare('SELECT COUNT(*) as count FROM dead_letter_queue').get() as {
    count: number;
  };
  return row.count;
}
