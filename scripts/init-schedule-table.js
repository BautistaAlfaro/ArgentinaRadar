/**
 * Initialize the scheduled_posts table in the database.
 *
 * Idempotent — safe to run multiple times (uses IF NOT EXISTS).
 * Run this once to create the table, or let scheduleManager.js
 * auto-create it on first access.
 *
 * Usage:
 *   node scripts/init-schedule-table.js
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.resolve(__dirname, '..', 'data', 'argentina-radar.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS scheduled_posts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id     TEXT    NOT NULL,
    text           TEXT    NOT NULL,
    image_url      TEXT,
    url            TEXT,
    scheduled_for  TEXT    NOT NULL,
    status         TEXT    DEFAULT 'scheduled'
                           CHECK(status IN ('scheduled','published','failed','cancelled')),
    published_at   TEXT,
    retry_count    INTEGER DEFAULT 0,
    last_error     TEXT,
    created_at     TEXT    DEFAULT (datetime('now'))
  )
`);

console.log('[init-schedule-table] ✅ scheduled_posts table ready');
db.close();
