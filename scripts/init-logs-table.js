#!/usr/bin/env node
/**
 * Initialize the service_logs table in the ArgentinaRadar SQLite database.
 *
 * Run this once to ensure the logging infrastructure exists:
 *   node scripts/init-logs-table.js
 *
 * The logger module (shared/logger.js) creates the table automatically
 * on first use, but this script is useful for manual setup or verification.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// ─── Resolve DB path (same logic as shared modules) ───────────────────

function resolveDbPath() {
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'data');
    if (fs.existsSync(candidate)) {
      return path.join(candidate, 'argentina-radar.db');
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(__dirname, '..', 'data', 'argentina-radar.db');
}

const DB_PATH = resolveDbPath();

console.log(`[init-logs] DB: ${DB_PATH}`);
console.log(`[init-logs] Creating service_logs table...`);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS service_logs (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT    NOT NULL,
    level     TEXT    NOT NULL,
    service   TEXT    NOT NULL,
    message   TEXT    NOT NULL,
    data      TEXT
  )
`);

// Indexes for efficient filtering
db.exec(`CREATE INDEX IF NOT EXISTS idx_svc_logs_service   ON service_logs(service)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_svc_logs_level     ON service_logs(level)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_svc_logs_timestamp ON service_logs(timestamp)`);

// Also create pipeline_metrics table (used by shared/metrics.js)
db.exec(`
  CREATE TABLE IF NOT EXISTS pipeline_metrics (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    date    TEXT NOT NULL,
    metric  TEXT NOT NULL,
    value   INTEGER DEFAULT 0
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_pm_date   ON pipeline_metrics(date)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_pm_metric ON pipeline_metrics(metric)`);

db.close();

console.log(`[init-logs] ✅ service_logs table ready`);
console.log(`[init-logs] ✅ pipeline_metrics table ready`);
console.log(`[init-logs] Done.`);
