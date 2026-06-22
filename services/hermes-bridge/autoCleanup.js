/**
 * Auto-Cleanup — ArgentinaRadar
 *
 * Runs every 6 hours to purge stale data:
 *   - Deletes discarded news_items older than 7 days
 *   - Keeps max 500 articles in DB (deletes oldest ingested first)
 *   - Deletes service_logs older than 7 days
 *   - Deletes service_incidents older than 30 days
 *   - Vacuums the SQLite DB to reclaim space
 *
 * Also runs a daily deep cleanup at 3:00 AM (legacy behavior).
 *
 * Sends a Telegram notification with cleanup stats.
 *
 * Controlled via:
 *   - env: AUTO_CLEANUP_ENABLED, AUTO_CLEANUP_HOUR
 *   - automations.json: autoCleanup (true/false)
 *
 * Usage:
 *   const { runAutoCleanup } = require('./autoCleanup');
 *   await runAutoCleanup();
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { createLogger } = require('../../shared/logger');

const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'argentina-radar.db');
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CLEANUP_HOUR = parseInt(process.env.AUTO_CLEANUP_HOUR || '3', 10);
const MAX_ARTICLES = 500;

const logger = createLogger('auto-cleanup');

let lastRunDate = ''; // YYYY-MM-DD — ensures we only run once per day
let lastSixHourRun = 0; // timestamp — ensures we run every 6 hours

// ─── Helpers ───────────────────────────────────────────────────────────────

function getToday() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Format bytes to human-readable.
 * @param {number} bytes
 * @returns {string}
 */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Get the DB file size on disk (approximate, including WAL/SHM).
 * @returns {number} Size in bytes
 */
function getDbSize() {
  let total = 0;
  for (const ext of ['', '-wal', '-shm']) {
    try {
      total += fs.statSync(DB_PATH + ext).size;
    } catch { /* file may not exist */ }
  }
  return total;
}

/**
 * Send a Telegram notification.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function sendTelegram(text) {
  try {
    const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: parseInt(CHAT_ID), text, parse_mode: 'Markdown' }),
      signal: AbortSignal.timeout(10000),
    });
    return resp.ok;
  } catch (e) {
    logger.warn('Telegram send failed', { error: e.message });
    return false;
  }
}

/**
 * Enforce max 500 articles: delete oldest ingested articles beyond the limit.
 * @param {import('better-sqlite3').Database} db
 * @returns {number} Number of deleted rows
 */
function enforceMaxArticles(db) {
  const totalRow = db.prepare('SELECT COUNT(*) as count FROM news_items').get();
  const total = totalRow.count;
  if (total <= MAX_ARTICLES) return 0;

  const toDelete = total - MAX_ARTICLES;
  const result = db.prepare(`
    DELETE FROM news_items WHERE id IN (
      SELECT id FROM news_items ORDER BY ingested_at ASC LIMIT ?
    )
  `).run(toDelete);
  return result.changes;
}

// ─── Main runner ───────────────────────────────────────────────────────────

/**
 * Run one cleanup cycle.
 *
 * Two modes:
 *   1. Every 6 hours (light): delete discarded > 7 days, enforce max 500, vacuum
 *   2. Daily at CLEANUP_HOUR (deep): also purge logs + incidents
 *
 * Called from the main notifier loop. Never throws.
 */
async function runAutoCleanup() {
  const today = getToday();
  const now = Date.now();
  const currentHour = new Date().getHours();

  // Check if 6 hours have passed since last run
  const isSixHourRun = (now - lastSixHourRun) >= 6 * 60 * 60 * 1000;
  // Check if daily deep cleanup
  const isDailyRun = lastRunDate !== today && currentHour === CLEANUP_HOUR;

  if (!isSixHourRun && !isDailyRun) return;

  logger.info(`🧹 Running auto-cleanup (${isDailyRun ? 'daily deep' : '6-hour cycle'})...`);

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  const sizeBefore = getDbSize();
  let deletedArticles = 0;
  let deletedLogs = 0;
  let deletedIncidents = 0;
  let deletedOverflow = 0;

  try {
    // ── Delete discarded news_items older than 7 days ──
    const discardedResult = db.prepare(`
      DELETE FROM news_items WHERE status = 'discarded' AND ingested_at < datetime('now', '-7 days')
    `).run();
    deletedArticles = discardedResult.changes;

    // ── Enforce max 500 articles ──
    deletedOverflow = enforceMaxArticles(db);
    if (deletedOverflow > 0) {
      logger.info(`Capped articles at ${MAX_ARTICLES}, deleted ${deletedOverflow}`);
    }

    // ── Daily deep cleanup: also purge logs + incidents ──
    if (isDailyRun) {
      const logsResult = db.prepare(`
        DELETE FROM service_logs WHERE timestamp < datetime('now', '-7 days')
      `).run();
      deletedLogs = logsResult.changes;

      const incidentsResult = db.prepare(`
        DELETE FROM service_incidents WHERE created_at < datetime('now', '-30 days')
      `).run();
      deletedIncidents = incidentsResult.changes;
    }

    // ── Vacuum ──
    logger.info('Vacuuming database...');
    db.exec('VACUUM');

    const sizeAfter = getDbSize();
    const saved = sizeBefore - sizeAfter;

    lastRunDate = today;
    lastSixHourRun = now;

    // ── Send notification (only if something was actually deleted) ──
    const totalDeleted = deletedArticles + deletedLogs + deletedIncidents + deletedOverflow;
    if (totalDeleted === 0 && saved === 0) {
      logger.info('Cleanup: nothing to delete');
      return;
    }

    const lines = [];
    if (deletedArticles > 0) lines.push(`📰 ${deletedArticles} descartados (>7d)`);
    if (deletedOverflow > 0) lines.push(`🗑️ ${deletedOverflow} oldest (>${MAX_ARTICLES})`);
    if (deletedLogs > 0) lines.push(`📋 ${deletedLogs} logs`);
    if (deletedIncidents > 0) lines.push(`🚨 ${deletedIncidents} incidentes`);

    const stats = [
      `🧹 *Cleanup completado* (${isDailyRun ? 'diario' : '6h'})`,
      ``,
    ];
    if (lines.length > 0) {
      stats.push(`*Eliminado:*`);
      stats.push(lines.join('\n'));
      stats.push(``);
    }
    stats.push(`💾 *DB:* ${formatSize(sizeBefore)} → ${formatSize(sizeAfter)}`);
    if (saved > 0) stats.push(`📉 *Ahorrado:* ${formatSize(saved)}`);

    await sendTelegram(stats.join('\n'));
    logger.info(`Cleanup done: ${totalDeleted} total items. DB: ${formatSize(sizeBefore)} → ${formatSize(sizeAfter)}`);
  } catch (e) {
    logger.error('Cleanup failed', { error: e.message });
  } finally {
    try { db.close(); } catch (_) {}
  }
}

module.exports = { runAutoCleanup };
