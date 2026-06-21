/**
 * Structured Logger — ArgentinaRadar
 *
 * Provides color-coded console logging with SQLite persistence.
 * Supports both CommonJS (require) and ESM (createRequire) consumers.
 *
 * Usage (CommonJS):
 *   const { createLogger } = require('../../shared/logger');
 *   const log = createLogger('my-service');
 *   log.info('Hello', { extra: 'data' });
 *
 * Usage (ESM):
 *   const { createLogger } = cRequire('../../shared/logger.js');
 *   const log = createLogger('my-service');
 *   log.info('Hello');
 *
 * Log table: service_logs(id, timestamp, level, service, message, data)
 * Auto-rotate: keeps last 10,000 entries
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// ─── ANSI color codes ──────────────────────────────────────────────────

const COLORS = {
  debug: '\x1b[36m', // cyan
  info:  '\x1b[32m', // green
  warn:  '\x1b[33m', // yellow
  error: '\x1b[31m', // red
};

const LEVEL_NAMES = {
  debug: 'DEBUG',
  info:  'INFO',
  warn:  'WARN',
  error: 'ERROR',
};

const RESET = '\x1b[0m';
const MAX_LOG_ENTRIES = 10_000;

// ─── Database helpers ──────────────────────────────────────────────────

/**
 * Walk up directories looking for the data/ folder (project root).
 * Same pattern as scheduleManager.js.
 */
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
  // Fallback: assume standard project layout
  const fallback = path.resolve(__dirname, '..', 'data', 'argentina-radar.db');
  fs.mkdirSync(path.dirname(fallback), { recursive: true });
  return fallback;
}

const DB_PATH = resolveDbPath();

/** @type {import('better-sqlite3').Database | null} */
let logDb = null;
let logDbReady = false;

function ensureLogTable() {
  if (logDbReady) return;
  try {
    logDb = new Database(DB_PATH);
    logDb.pragma('journal_mode = WAL');
    logDb.exec(`
      CREATE TABLE IF NOT EXISTS service_logs (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT    NOT NULL,
        level     TEXT    NOT NULL,
        service   TEXT    NOT NULL,
        message   TEXT    NOT NULL,
        data      TEXT
      )
    `);
    // Create indexes for efficient filtering
    logDb.exec(`CREATE INDEX IF NOT EXISTS idx_svc_logs_service   ON service_logs(service)`);
    logDb.exec(`CREATE INDEX IF NOT EXISTS idx_svc_logs_level     ON service_logs(level)`);
    logDb.exec(`CREATE INDEX IF NOT EXISTS idx_svc_logs_timestamp ON service_logs(timestamp)`);
    logDbReady = true;
  } catch (e) {
    // If DB is locked or unavailable, log to console only
    console.error('[logger] Failed to initialize log table:', e.message);
  }
}

/**
 * Remove entries beyond the retention limit (oldest first).
 */
function rotateLogs() {
  if (!logDbReady) return;
  try {
    logDb.exec(
      `DELETE FROM service_logs WHERE id NOT IN (
         SELECT id FROM service_logs ORDER BY id DESC LIMIT ${MAX_LOG_ENTRIES}
       )`
    );
  } catch {
    // Best-effort rotation
  }
}

// ─── Logger factory ────────────────────────────────────────────────────

/**
 * Create a structured logger for a given service name.
 *
 * @param {string} service  - Service identifier (e.g. 'processing-loop', 'telegram-notifier')
 * @returns {{ debug: Function, info: Function, warn: Function, error: Function }}
 */
function createLogger(service) {
  // Ensure the log table exists on first logger creation
  ensureLogTable();

  /**
   * Internal log function.
   *
   * @param {'debug'|'info'|'warn'|'error'} level
   * @param {string} message
   * @param {*} [data]  - Optional structured data attached to the log entry
   */
  function log(level, message, data) {
    const timestamp = new Date().toISOString();
    const color = COLORS[level] || '';
    const levelName = LEVEL_NAMES[level] || level.toUpperCase();

    // ── Console output (color-coded) ──────────────────────────────
    if (data !== undefined) {
      console.log(`${color}[${timestamp}] [${levelName}] [${service}] ${message}${RESET}`, data);
    } else {
      console.log(`${color}[${timestamp}] [${levelName}] [${service}] ${message}${RESET}`);
    }

    // ── SQLite persistence (fire-and-forget) ──────────────────────
    if (logDbReady) {
      try {
        logDb.prepare(
          `INSERT INTO service_logs (timestamp, level, service, message, data)
           VALUES (?, ?, ?, ?, ?)`
        ).run(timestamp, level, service, message, data !== undefined ? JSON.stringify(data) : null);

        // Periodically rotate — check every 50 writes
        if (Math.floor(Math.random() * 50) === 0) {
          rotateLogs();
        }
      } catch (e) {
        // Fail silently — logging must never crash the application
        console.error('[logger] DB write failed:', e.message);
      }
    }
  }

  return {
    debug: (message, data) => log('debug', message, data),
    info:  (message, data) => log('info',  message, data),
    warn:  (message, data) => log('warn',  message, data),
    error: (message, data) => log('error', message, data),
  };
}

// ─── Exports ───────────────────────────────────────────────────────────

module.exports = { createLogger };
