/**
 * Auto-Cleanup — ArgentinaRadar
 *
 * Runs daily at 3:00 AM to purge stale data:
 *   - Deletes discarded news_items older than 30 days
 *   - Deletes service_logs older than 7 days
 *   - Deletes service_incidents older than 30 days
 *   - Vacuums the SQLite DB to reclaim space
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
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8653838115:AAFBRBhHEq3VXbfgiZwV1dtNjesBYwvhUqg';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '1923443777';
const CLEANUP_HOUR = parseInt(process.env.AUTO_CLEANUP_HOUR || '3', 10);

const logger = createLogger('auto-cleanup');

let lastRunDate = ''; // YYYY-MM-DD — ensures we only run once per day

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

// ─── Main runner ───────────────────────────────────────────────────────────

/**
 * Run one cleanup cycle. Only executes once per day during the configured
 * hour (default 3:00-3:59). Checks the current hour — any minute within
 * the target hour triggers the run, then it's blocked until the next day.
 *
 * Called from the main notifier loop. Never throws.
 */
async function runAutoCleanup() {
  const today = getToday();
  const currentHour = new Date().getHours();

  // Only run once per day, during the configured hour
  if (lastRunDate === today) return;
  if (currentHour !== CLEANUP_HOUR) return;

  logger.info(`🧹 Running auto-cleanup (hour ${CLEANUP_HOUR})...`);

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  const sizeBefore = getDbSize();

  try {
    // ── Delete discarded news_items older than 30 days ──
    const discardedResult = db.prepare(`
      DELETE FROM news_items WHERE status = 'discarded' AND ingested_at < datetime('now', '-30 days')
    `).run();
    const deletedArticles = discardedResult.changes;

    // ── Delete service_logs older than 7 days ──
    const logsResult = db.prepare(`
      DELETE FROM service_logs WHERE timestamp < datetime('now', '-7 days')
    `).run();
    const deletedLogs = logsResult.changes;

    // ── Delete service_incidents older than 30 days ──
    const incidentsResult = db.prepare(`
      DELETE FROM service_incidents WHERE created_at < datetime('now', '-30 days')
    `).run();
    const deletedIncidents = incidentsResult.changes;

    // ── Vacuum ──
    logger.info('Vacuuming database...');
    db.exec('VACUUM');

    const sizeAfter = getDbSize();
    const saved = sizeBefore - sizeAfter;

    lastRunDate = today;

    // ── Send notification ──
    const lines = [];
    if (deletedArticles > 0) lines.push(`📰 ${deletedArticles} artículos descartados`);
    if (deletedLogs > 0) lines.push(`📋 ${deletedLogs} logs`);
    if (deletedIncidents > 0) lines.push(`🚨 ${deletedIncidents} incidentes`);

    if (lines.length === 0 && saved === 0) {
      logger.info('Cleanup: nothing to delete');
      return;
    }

    const stats = [
      `🧹 *Cleanup completado*`,
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
    logger.info(`Cleanup done: ${deletedArticles} articles, ${deletedLogs} logs, ${deletedIncidents} incidents. DB: ${formatSize(sizeBefore)} → ${formatSize(sizeAfter)}`);
  } catch (e) {
    logger.error('Cleanup failed', { error: e.message });
  } finally {
    try { db.close(); } catch (_) {}
  }
}

module.exports = { runAutoCleanup };
