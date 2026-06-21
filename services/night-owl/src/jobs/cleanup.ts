/**
 * Night Owl — Data Cleanup & Archival Job
 *
 * Scheduled: 05:00 ART
 *
 * Maintains database health:
 *   1. Archive events older than 30 days to archive_events table
 *   2. VACUUM SQLite database
 *   3. Run PostgreSQL WAL checkpoint
 *   4. Clean stale sessions (>7 days)
 *   5. Delete old trends (>14 days)
 *   6. Report: "Archived X events, cleaned Y records, DB size: Z MB"
 */

import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import pg from 'pg';
import fs from 'fs';
import type { JobFn } from './index.js';
import { prisma } from '@argentinaradar/database';
import { BudgetTracker } from './budget.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Configuration ──────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const DB_PATH =
  process.env.DB_PATH ??
  path.resolve(__dirname, '..', '..', '..', '..', 'data', 'argentina-radar.db');

const EVENT_RETENTION_DAYS = 30;
const SESSION_RETENTION_DAYS = 7;
const TREND_RETENTION_DAYS = 14;

const PUBLISHED_TWEET_RETENTION_DAYS = parseInt(process.env.PUBLISHED_TWEET_RETENTION_DAYS ?? '7', 10);
const NEWS_ITEM_RETENTION_DAYS = parseInt(process.env.NEWS_ITEM_RETENTION_DAYS ?? '30', 10);
const TWEET_HISTORY_RETENTION_DAYS = parseInt(process.env.TWEET_HISTORY_RETENTION_DAYS ?? '90', 10);

const { Pool } = pg;

// ── Helpers ────────────────────────────────────────────────────────────

/** Get file size in MB. */
function getFileSizeMB(filePath: string): number {
  try {
    const stat = fs.statSync(filePath);
    return Math.round((stat.size / (1024 * 1024)) * 100) / 100;
  } catch {
    return 0;
  }
}

/** Run a SQL query on PostgreSQL via raw pool. */
async function runPgQuery(pool: pg.Pool, sql: string, params?: unknown[]): Promise<pg.QueryResult> {
  return pool.query(sql, params);
}

// ── Job implementation ─────────────────────────────────────────────────

export const runCleanup: JobFn = async (_data) => {
  const budget = new BudgetTracker(0.05); // small cap for cleanup (mostly DB ops, no AI)
  const startedAt = Date.now();

  console.log('═══════════════════════════════════════');
  console.log('[Job:cleanup] Starting data cleanup & archival');
  console.log('═══════════════════════════════════════');

  let archivedEvents = 0;
  let cleanedSessions = 0;
  let deletedTrends = 0;
  let deletedTweetDrafts = 0;
  let purgedArticles = 0;
  let deletedTweetHistory = 0;
  let sqliteDbSizeMB = 0;
  let vacuumDone = false;
  let checkpointDone = false;

  // ── 1. Archive events older than 30 days ────────────────────────────
  if (DATABASE_URL) {
    const pool = new Pool({ connectionString: DATABASE_URL });
    try {
      // Create archive table if not exists
      await runPgQuery(pool, `
        CREATE TABLE IF NOT EXISTS archive_events (
          id              TEXT PRIMARY KEY,
          title           TEXT NOT NULL,
          summary         TEXT,
          impact_score    INTEGER DEFAULT 0,
          media_consensus TEXT DEFAULT 'low',
          location        JSONB,
          created_at      TIMESTAMPTZ NOT NULL,
          archived_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      // Copy events older than 30 days to archive
      const archiveResult = await runPgQuery(pool, `
        INSERT INTO archive_events (id, title, summary, impact_score, media_consensus, location, created_at)
        SELECT e.id, e.title, e.summary, e."impactScore", e."mediaConsensus", e.location, e."createdAt"
        FROM "Event" e
        WHERE e."createdAt" < NOW() - INTERVAL '${EVENT_RETENTION_DAYS} days'
          AND NOT EXISTS (SELECT 1 FROM archive_events a WHERE a.id = e.id)
      `);
      archivedEvents = archiveResult.rowCount ?? 0;
      console.log(`[Cleanup] Archived ${archivedEvents} events > ${EVENT_RETENTION_DAYS} days old`);

      // Delete archived events from active table (and related joins via cascade)
      if (archivedEvents > 0) {
        await runPgQuery(pool, `
          DELETE FROM "Event"
          WHERE "createdAt" < NOW() - INTERVAL '${EVENT_RETENTION_DAYS} days'
        `);
        console.log(`[Cleanup] Deleted ${archivedEvents} archived events from Event table`);
      }
    } catch (err) {
      console.error('[Cleanup] Failed to archive events:', (err as Error).message);
    } finally {
      await pool.end();
    }
  } else {
    console.warn('[Cleanup] DATABASE_URL not set — skipping PG archive');
  }

  // ── 2. VACUUM SQLite database ──────────────────────────────────────
  let db: Database.Database | null = null;
  try {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');

    // Get size before compaction
    sqliteDbSizeMB = getFileSizeMB(DB_PATH);
    console.log(`[Cleanup] SQLite DB size before vacuum: ${sqliteDbSizeMB} MB`);

    // Run VACUUM
    db.exec('VACUUM');
    vacuumDone = true;
    console.log('[Cleanup] SQLite VACUUM completed');

    // Run WAL checkpoint (truncate mode)
    const checkpointResult = db.pragma('wal_checkpoint(TRUNCATE)') as unknown as { busy: number; log: number; checkpointed: number };
    console.log(`[Cleanup] WAL checkpoint: ${JSON.stringify(checkpointResult)}`);

    // Get size after compaction
    sqliteDbSizeMB = getFileSizeMB(DB_PATH);
    console.log(`[Cleanup] SQLite DB size after vacuum: ${sqliteDbSizeMB} MB`);
  } catch (err) {
    console.error('[Cleanup] Failed to VACUUM SQLite:', (err as Error).message);
  } finally {
    if (db) db.close();
  }

  // ── 3. Run PostgreSQL WAL checkpoint ────────────────────────────────
  if (DATABASE_URL) {
    const pool = new Pool({ connectionString: DATABASE_URL });
    try {
      await runPgQuery(pool, 'CHECKPOINT');
      checkpointDone = true;
      console.log('[Cleanup] PostgreSQL CHECKPOINT completed');
    } catch (err) {
      console.error('[Cleanup] PostgreSQL CHECKPOINT failed:', (err as Error).message);
    } finally {
      await pool.end();
    }
  }

  // ── 4. Clean stale sessions (>7 days) via Prisma ────────────────────
  try {
    const deleteResult = await prisma.session.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { createdAt: { lt: new Date(Date.now() - SESSION_RETENTION_DAYS * 86_400_000) } },
        ],
      },
    });
    cleanedSessions = deleteResult.count;
    console.log(`[Cleanup] Deleted ${cleanedSessions} stale sessions > ${SESSION_RETENTION_DAYS} days`);
  } catch (err) {
    console.error('[Cleanup] Failed to clean sessions:', (err as Error).message);
  }

  // ── 5. Delete old trends (>14 days) via Prisma ──────────────────────
  try {
    const deleteResult = await prisma.trend.deleteMany({
      where: {
        detectedAt: { lt: new Date(Date.now() - TREND_RETENTION_DAYS * 86_400_000) },
      },
    });
    deletedTrends = deleteResult.count;
    console.log(`[Cleanup] Deleted ${deletedTrends} old trends > ${TREND_RETENTION_DAYS} days`);
  } catch (err) {
    console.error('[Cleanup] Failed to delete old trends:', (err as Error).message);
  }

  // ── 6. Purge published tweet drafts from approval_queue ────────────────
  let db2: Database.Database | null = null;
  try {
    db2 = new Database(DB_PATH);
    db2.pragma('journal_mode = WAL');

    // Step 6: published tweet drafts older than retention window
    const draftResult = db2
      .prepare(
        `DELETE FROM approval_queue
         WHERE status = 'published'
           AND published_at < datetime('now', '-' || ? || ' days')`,
      )
      .run(PUBLISHED_TWEET_RETENTION_DAYS);
    deletedTweetDrafts = draftResult.changes;
    console.log(
      `[Cleanup] Deleted ${deletedTweetDrafts} published tweet drafts older than ${PUBLISHED_TWEET_RETENTION_DAYS} days`,
    );

    // Step 7: published/discarded news_items older than retention window
    const articleResult = db2
      .prepare(
        `DELETE FROM news_items
         WHERE status IN ('published', 'discarded')
           AND ingested_at < datetime('now', '-' || ? || ' days')`,
      )
      .run(NEWS_ITEM_RETENTION_DAYS);
    purgedArticles = articleResult.changes;
    console.log(
      `[Cleanup] Purged ${purgedArticles} old published/discarded articles older than ${NEWS_ITEM_RETENTION_DAYS} days`,
    );

    // Step 8: tweet_history records older than retention window
    const historyResult = db2
      .prepare(
        `DELETE FROM tweet_history
         WHERE posted_at < datetime('now', '-' || ? || ' days')`,
      )
      .run(TWEET_HISTORY_RETENTION_DAYS);
    deletedTweetHistory = historyResult.changes;
    console.log(
      `[Cleanup] Deleted ${deletedTweetHistory} old tweet history records older than ${TWEET_HISTORY_RETENTION_DAYS} days`,
    );

    // Step 9: run VACUUM again if any rows were deleted in steps 6-8
    const newDeletions = deletedTweetDrafts + purgedArticles + deletedTweetHistory;
    if (newDeletions > 0) {
      db2.exec('VACUUM');
      console.log('[Cleanup] Post-purge VACUUM completed');
    }
  } catch (err) {
    console.error('[Cleanup] Failed during SQLite purge steps:', (err as Error).message);
  } finally {
    if (db2) db2.close();
  }

  // ── Summary ──────────────────────────────────────────────────────────
  const totalCleaned = cleanedSessions + deletedTrends;
  const totalPurged = deletedTweetDrafts + purgedArticles + deletedTweetHistory;
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log('===========================================');
  console.log(`[Job:cleanup] Complete in ${elapsed}s`);
  console.log(`  Archived events:       ${archivedEvents}`);
  console.log(`  Cleaned sessions:      ${cleanedSessions}`);
  console.log(`  Deleted trends:        ${deletedTrends}`);
  console.log(`  Tweet drafts purged:   ${deletedTweetDrafts}`);
  console.log(`  Articles purged:       ${purgedArticles}`);
  console.log(`  Tweet history purged:  ${deletedTweetHistory}`);
  console.log(`  SQLite VACUUM:         ${vacuumDone ? 'yes' : 'no'}`);
  console.log(`  PG CHECKPOINT:         ${checkpointDone ? 'yes' : 'no'}`);
  console.log(`  DB size:               ${sqliteDbSizeMB} MB`);
  console.log(
    `  Summary: Archived ${archivedEvents} events, cleaned ${totalCleaned} records, ` +
    `purged ${totalPurged} pipeline records, DB size: ${sqliteDbSizeMB} MB`,
  );
  console.log('===========================================');
};
