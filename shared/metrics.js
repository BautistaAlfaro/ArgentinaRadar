/**
 * Pipeline Metrics — ArgentinaRadar
 *
 * Simple in-memory counters with periodic SQLite flush.
 * Tracks operational metrics across all services and aggregates
 * them in a shared pipeline_metrics table for the admin dashboard.
 *
 * Design:
 *  - increment() updates in-memory counters synchronously (fast, no I/O)
 *  - Every 30 seconds, deltas are flushed to the shared SQLite DB
 *  - getMetrics() reads aggregated data from the DB (cross-process)
 *  - Each process flushes its own deltas; SUM() across rows gives totals
 *
 * Metrics tracked:
 *  - articles_ingested     (news-ingestion)
 *  - articles_published    (twitter-publisher / approval)
 *  - articles_rejected     (processing-loop)
 *  - api_calls_ollama      (news-ingestion)
 *  - errors                (all services)
 *  - telegram_messages     (hermes-bridge)
 *
 * Usage (CommonJS):
 *   const { increment, getMetrics } = require('../../shared/metrics');
 *   increment('articles_ingested');
 *   const metrics = getMetrics();
 *
 * Usage (ESM with cRequire):
 *   const { increment, getMetrics } = cRequire('../../shared/metrics.js');
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// ─── Helpers ───────────────────────────────────────────────────────────

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
  const fallback = path.resolve(__dirname, '..', 'data', 'argentina-radar.db');
  fs.mkdirSync(path.dirname(fallback), { recursive: true });
  return fallback;
}

const DB_PATH = resolveDbPath();

// ─── In-memory counters ───────────────────────────────────────────────

/**
 * Each counter tracks { total, lastFlushed } so we can compute deltas.
 * @type {Record<string, { total: number, lastFlushed: number }>}
 */
const counters = {};

/** Service start timestamp for uptime calculation. */
const startTime = Date.now();

// ─── Database helpers ──────────────────────────────────────────────────

/** @type {import('better-sqlite3').Database | null} */
let metricsDb = null;
let metricsDbReady = false;

function ensureMetricsTable() {
  if (metricsDbReady) return;
  try {
    metricsDb = new Database(DB_PATH);
    metricsDb.pragma('journal_mode = WAL');
    metricsDb.exec(`
      CREATE TABLE IF NOT EXISTS pipeline_metrics (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        date    TEXT NOT NULL,
        metric  TEXT NOT NULL,
        value   INTEGER DEFAULT 0
      )
    `);
    metricsDb.exec('CREATE INDEX IF NOT EXISTS idx_pm_date   ON pipeline_metrics(date)');
    metricsDb.exec('CREATE INDEX IF NOT EXISTS idx_pm_metric ON pipeline_metrics(metric)');
    metricsDbReady = true;
  } catch (e) {
    console.error('[metrics] Failed to initialize metrics table:', e.message);
  }
}

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Increment a metric counter.
 *
 * @param {string} metric  - Metric name (e.g. 'articles_ingested')
 * @param {number} [value=1] - Amount to increment by
 */
function increment(metric, value) {
  if (value === undefined) value = 1;
  if (!counters[metric]) {
    counters[metric] = { total: 0, lastFlushed: 0 };
  }
  counters[metric].total += value;
}

/**
 * Get aggregated metrics from the shared DB.
 *
 * Returns today's metrics, grand totals, and uptime.
 * Uses SUM() across all rows so multiple processes' contributions
 * are aggregated correctly.
 *
 * @returns {{ today: Record<string, number>, totals: Record<string, number>, uptime_seconds: number }}
 */
function getMetrics() {
  const result = {
    today: {},
    totals: {},
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
  };

  ensureMetricsTable();
  if (!metricsDbReady) return result;

  try {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    // Today's metrics (aggregated from all processes)
    const todayRows = metricsDb.prepare(
      `SELECT metric, SUM(value) as value
       FROM pipeline_metrics
       WHERE date = ?
       GROUP BY metric`
    ).all(today);

    for (const row of todayRows) {
      result.today[row.metric] = row.value;
    }

    // Grand totals (all-time)
    const totalRows = metricsDb.prepare(
      `SELECT metric, SUM(value) as value
       FROM pipeline_metrics
       GROUP BY metric`
    ).all();

    for (const row of totalRows) {
      result.totals[row.metric] = row.value;
    }

    // Merge in-memory counters that haven't been flushed yet
    for (const [metric, state] of Object.entries(counters)) {
      const unflushed = state.total - state.lastFlushed;
      if (unflushed > 0) {
        result.today[metric] = (result.today[metric] || 0) + unflushed;
        result.totals[metric] = (result.totals[metric] || 0) + unflushed;
      }
    }
  } catch (e) {
    // Best-effort — metrics must never crash
    console.error('[metrics] getMetrics error:', e.message);
  }

  return result;
}

// ─── Periodic flush ────────────────────────────────────────────────────

/**
 * Flush in-memory deltas to the shared DB.
 * Only writes the delta since the last flush (not the total),
 * so SUM() across rows gives the correct aggregate.
 */
function flushMetrics() {
  if (!metricsDbReady) ensureMetricsTable();
  if (!metricsDbReady) return;

  try {
    const today = new Date().toISOString().slice(0, 10);
    const insert = metricsDb.prepare(
      'INSERT INTO pipeline_metrics (date, metric, value) VALUES (?, ?, ?)'
    );

    for (const [metric, state] of Object.entries(counters)) {
      const delta = state.total - state.lastFlushed;
      if (delta > 0) {
        insert.run(today, metric, delta);
        state.lastFlushed = state.total;
      }
    }
  } catch (e) {
    // Best-effort
    console.error('[metrics] flush error:', e.message);
  }
}

// Flush every 30 seconds
setInterval(flushMetrics, 30_000);

// ─── Exports ───────────────────────────────────────────────────────────

module.exports = { increment, getMetrics };
