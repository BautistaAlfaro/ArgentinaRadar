/**
 * scripts/pipeline/05-cleanup-published.ts
 *
 * On-demand cleanup script for published pipeline records.
 * Runs the same four delete operations as the night-owl cleanup job
 * but can be invoked directly from the CLI without waiting for the cron.
 *
 * Usage:
 *   npx tsx scripts/pipeline/05-cleanup-published.ts
 *   npx tsx scripts/pipeline/05-cleanup-published.ts --days 3    # override all retention windows
 *
 * Environment overrides (all optional):
 *   PUBLISHED_TWEET_RETENTION_DAYS   default 7
 *   NEWS_ITEM_RETENTION_DAYS         default 30
 *   TWEET_HISTORY_RETENTION_DAYS     default 90
 *   DB_PATH                          default <cwd>/data/argentina-radar.db
 */

import path from 'path';
import Database from 'better-sqlite3';
import fs from 'fs';

// ── Retention windows ──────────────────────────────────────────────────

/** Parse a --days N flag from argv, return undefined if not present. */
function parseDaysFlag(): number | undefined {
  const idx = process.argv.indexOf('--days');
  if (idx === -1) return undefined;
  const raw = process.argv[idx + 1];
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

const flagDays = parseDaysFlag();

const PUBLISHED_TWEET_RETENTION_DAYS =
  flagDays ?? parseInt(process.env.PUBLISHED_TWEET_RETENTION_DAYS ?? '7', 10);
const NEWS_ITEM_RETENTION_DAYS =
  flagDays ?? parseInt(process.env.NEWS_ITEM_RETENTION_DAYS ?? '30', 10);
const TWEET_HISTORY_RETENTION_DAYS =
  flagDays ?? parseInt(process.env.TWEET_HISTORY_RETENTION_DAYS ?? '90', 10);

// ── DB path ────────────────────────────────────────────────────────────

const DB_PATH =
  process.env.DB_PATH ?? path.resolve(process.cwd(), 'data', 'argentina-radar.db');

// ── Helpers ────────────────────────────────────────────────────────────

function getFileSizeMB(filePath: string): number {
  try {
    const stat = fs.statSync(filePath);
    return Math.round((stat.size / (1024 * 1024)) * 100) / 100;
  } catch {
    return 0;
  }
}

// ── Main ───────────────────────────────────────────────────────────────

function main(): void {
  console.log('[05-cleanup-published] Starting on-demand pipeline cleanup');
  console.log(`  DB path:                   ${DB_PATH}`);
  console.log(`  Tweet draft retention:     ${PUBLISHED_TWEET_RETENTION_DAYS} days`);
  console.log(`  News item retention:       ${NEWS_ITEM_RETENTION_DAYS} days`);
  console.log(`  Tweet history retention:   ${TWEET_HISTORY_RETENTION_DAYS} days`);

  if (!fs.existsSync(DB_PATH)) {
    console.error(`[05-cleanup-published] DB not found at ${DB_PATH}`);
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  let deletedTweetDrafts = 0;
  let purgedArticles = 0;
  let deletedTweetHistory = 0;

  try {
    // Step 1: Purge published tweet drafts from approval_queue
    const draftResult = db
      .prepare(
        `DELETE FROM approval_queue
         WHERE status = 'published'
           AND published_at < datetime('now', '-' || ? || ' days')`,
      )
      .run(PUBLISHED_TWEET_RETENTION_DAYS);
    deletedTweetDrafts = draftResult.changes;
    console.log(
      `[05-cleanup-published] Deleted ${deletedTweetDrafts} published tweet drafts older than ${PUBLISHED_TWEET_RETENTION_DAYS} days`,
    );

    // Step 2: Purge published/discarded news_items
    const articleResult = db
      .prepare(
        `DELETE FROM news_items
         WHERE status IN ('published', 'discarded')
           AND ingested_at < datetime('now', '-' || ? || ' days')`,
      )
      .run(NEWS_ITEM_RETENTION_DAYS);
    purgedArticles = articleResult.changes;
    console.log(
      `[05-cleanup-published] Purged ${purgedArticles} old published/discarded articles older than ${NEWS_ITEM_RETENTION_DAYS} days`,
    );

    // Step 3: Purge tweet_history records
    const historyResult = db
      .prepare(
        `DELETE FROM tweet_history
         WHERE posted_at < datetime('now', '-' || ? || ' days')`,
      )
      .run(TWEET_HISTORY_RETENTION_DAYS);
    deletedTweetHistory = historyResult.changes;
    console.log(
      `[05-cleanup-published] Deleted ${deletedTweetHistory} old tweet history records older than ${TWEET_HISTORY_RETENTION_DAYS} days`,
    );

    // Step 4: VACUUM to reclaim freed pages
    console.log('[05-cleanup-published] Running VACUUM...');
    db.exec('VACUUM');
    console.log('[05-cleanup-published] VACUUM complete');
  } finally {
    db.close();
  }

  const dbSizeMB = getFileSizeMB(DB_PATH);
  const total = deletedTweetDrafts + purgedArticles + deletedTweetHistory;

  console.log(
    `\nCleanup complete: ${deletedTweetDrafts} tweet drafts, ${purgedArticles} articles, ` +
    `${deletedTweetHistory} tweet history records deleted. DB size: ${dbSizeMB} MB`,
  );

  if (total === 0) {
    console.log('[05-cleanup-published] Nothing to delete — all records are within retention windows');
  }
}

main();
