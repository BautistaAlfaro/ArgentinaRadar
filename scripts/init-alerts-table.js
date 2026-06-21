/**
 * Initialize the alerts table in the database.
 *
 * Idempotent — safe to run multiple times (uses IF NOT EXISTS).
 * Run this once after deploying the alert system, or let alerts.js
 * auto-create the table on first access.
 *
 * Usage:
 *   node scripts/init-alerts-table.js
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.resolve(__dirname, '..', 'data', 'argentina-radar.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS alerts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword    TEXT    NOT NULL,
    type       TEXT    DEFAULT 'keyword',
    chat_id    TEXT    NOT NULL,
    active     INTEGER DEFAULT 1,
    created_at TEXT    DEFAULT (datetime('now'))
  )
`);

console.log('[init-alerts] ✅ alerts table ready');
db.close();
