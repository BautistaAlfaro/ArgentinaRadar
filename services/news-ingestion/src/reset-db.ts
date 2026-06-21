/**
 * ArgentinaRadar — Database Reset Script
 *
 * Clears all test/fake data while preserving schema and source configuration.
 * Tables cleared: news_items, tweet_history, approval_queue
 * Tables kept:   sources, ai_filter_costs, economic_data
 *
 * Usage:
 *   npm run db:reset            # requires --force flag as safety
 *   npm run db:reset --force    # execute the reset
 *   npm run db:reset -- --force # alternative (npm passes -- to script)
 *
 * Safety: always creates a backup before clearing.
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { runMigrations } from './migrations.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH =
  process.env.DB_PATH ?? path.resolve(__dirname, '..', '..', '..', 'data', 'argentina-radar.db');
const BACKUP_PATH = DB_PATH + '.backup';

/** Main reset routine */
function resetDatabase(force: boolean): void {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[reset] Database not found at ${DB_PATH}`);
    process.exit(1);
  }

  // ── Safety gate ──────────────────────────────────────────────────────
  if (!force) {
    console.log(`
[reset] ⚠  This will DELETE ALL rows from:
  • news_items
  • tweet_history
  • approval_queue

[reset] ✓ The following tables will be KEPT:
  • sources
  • ai_filter_costs
  • economic_data

[reset] A backup will be saved to: ${BACKUP_PATH}

[reset] To proceed, run with --force:
  npm run db:reset --force
`);
    process.exit(0);
  }

  // ── Backup ────────────────────────────────────────────────────────────
  console.log(`[reset] Creating backup at ${BACKUP_PATH} ...`);
  fs.copyFileSync(DB_PATH, BACKUP_PATH);
  console.log('[reset] Backup created.');

  // ── Also backup WAL/SHM if present ───────────────────────────────────
  const walPath = DB_PATH + '-wal';
  const shmPath = DB_PATH + '-shm';
  if (fs.existsSync(walPath)) {
    fs.copyFileSync(walPath, BACKUP_PATH + '-wal');
  }
  if (fs.existsSync(shmPath)) {
    fs.copyFileSync(shmPath, BACKUP_PATH + '-shm');
  }

  // ── Open and clear ────────────────────────────────────────────────────
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Disable FK checks temporarily to allow any deletion order
  db.pragma('foreign_keys = OFF');

  console.log('[reset] Deleting from approval_queue...');
  const aqResult = db.prepare('DELETE FROM approval_queue').run();
  console.log(`[reset]   → ${aqResult.changes} rows deleted`);

  console.log('[reset] Deleting from tweet_history...');
  const thResult = db.prepare('DELETE FROM tweet_history').run();
  console.log(`[reset]   → ${thResult.changes} rows deleted`);

  console.log('[reset] Deleting from news_items...');
  const niResult = db.prepare('DELETE FROM news_items').run();
  console.log(`[reset]   → ${niResult.changes} rows deleted`);

  // Re-enable FK checks
  db.pragma('foreign_keys = ON');

  // ── Row count verification ────────────────────────────────────────────
  const verifyRows = db.prepare(`
    SELECT 'news_items' AS tbl, COUNT(*) AS cnt FROM news_items
    UNION ALL
    SELECT 'tweet_history', COUNT(*) FROM tweet_history
    UNION ALL
    SELECT 'approval_queue', COUNT(*) FROM approval_queue
    UNION ALL
    SELECT 'sources', COUNT(*) FROM sources
  `).all() as Array<{ tbl: string; cnt: number }>;

  console.log('[reset] Post-cleanup row counts:');
  for (const r of verifyRows) {
    console.log(`  ${r.tbl}: ${r.cnt}`);
  }

  // ── Run migrations to ensure latest schema (indexes, columns) ─────────
  console.log('[reset] Running schema migrations...');
  runMigrations(db);
  console.log('[reset] Schema up to date.');

  // ── VACUUM ────────────────────────────────────────────────────────────
  console.log('[reset] Running VACUUM to reclaim space...');
  db.exec('VACUUM');
  console.log('[reset] VACUUM complete.');

  db.close();

  // ── Integrity check ───────────────────────────────────────────────────
  console.log('[reset] Running integrity check...');
  const integrityDb = new Database(DB_PATH);
  const integrityRows = integrityDb.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
  for (const row of integrityRows) {
    console.log(`  integrity: ${row.integrity_check}`);
  }
  integrityDb.close();

  const allOk = integrityRows.every(r => r.integrity_check === 'ok');
  if (!allOk) {
    console.error('[reset] ⚠ Database integrity check FAILED — restore from backup.');
    process.exit(1);
  }

  console.log('[reset] ✓ Database reset complete.');
  console.log(`[reset]   Backup: ${BACKUP_PATH}`);
}

// ── Entry point ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const force = args.includes('--force') || args.includes('-f');

resetDatabase(force);
