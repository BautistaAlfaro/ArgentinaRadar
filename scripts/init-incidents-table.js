#!/usr/bin/env node
/**
 * Initialize the service_incidents table in the ArgentinaRadar SQLite database.
 *
 * Run this once to create the watchdog incident tracking infrastructure:
 *   node scripts/init-incidents-table.js
 *
 * The watchdog module (services/hermes-bridge/watchdog.js) also auto-creates
 * this table on first run, but this script is useful for manual setup or
 * verifying the schema.
 *
 * Schema:
 *   id            INTEGER PRIMARY KEY AUTOINCREMENT
 *   service       TEXT    NOT NULL     — e.g. 'news-service', 'bsky-publisher'
 *   incident_type TEXT                 — 'down', 'restart_success', 'restart_failed', 'high_memory'
 *   details       TEXT                 — free-text description
 *   created_at    TEXT    DEFAULT (datetime('now'))
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.resolve(__dirname, '..', 'data', 'argentina-radar.db');

console.log(`[init-incidents] DB: ${DB_PATH}`);
console.log(`[init-incidents] Creating service_incidents table...`);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS service_incidents (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    service       TEXT    NOT NULL,
    incident_type TEXT,            -- 'down', 'restart_success', 'restart_failed', 'high_memory'
    details       TEXT,
    created_at    TEXT    DEFAULT (datetime('now'))
  )
`);

// Index for efficient queries by service and time range
db.exec(`CREATE INDEX IF NOT EXISTS idx_incidents_service    ON service_incidents(service)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_incidents_type       ON service_incidents(incident_type)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON service_incidents(created_at)`);

db.close();

console.log(`[init-incidents] ✅ service_incidents table ready`);
console.log(`[init-incidents] Done.`);
