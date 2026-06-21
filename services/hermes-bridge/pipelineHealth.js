/**
 * Pipeline Health Check — ArgentinaRadar
 *
 * Monitors pipeline health every 15 minutes and reports anomalies:
 *   - Articles ingested in the last hour (should be > 0 if sources active)
 *   - Articles pending approval (should be < 50, otherwise alert)
 *   - Failed publishes in the last hour (should be < 5)
 *   - DB size (should be < 500 MB)
 *
 * Sends a summary every 6 hours with overall pipeline stats.
 *
 * Controlled via:
 *   - env: PIPELINE_HEALTH_ENABLED, PIPELINE_HEALTH_INTERVAL
 *   - automations.json: pipelineHealth (true/false)
 *
 * Usage:
 *   const { runPipelineHealth } = require('./pipelineHealth');
 *   await runPipelineHealth();
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { createLogger } = require('../../shared/logger');

const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'argentina-radar.db');
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CHECK_INTERVAL = parseInt(process.env.PIPELINE_HEALTH_INTERVAL || '900000', 10); // 15 min
const SUMMARY_INTERVAL = 21600000; // 6 hours

const logger = createLogger('pipeline-health');

// ─── Thresholds ────────────────────────────────────────────────────────────

const THRESHOLDS = {
  minArticlesPerHour: 1,        // Alert if 0 articles in the last hour
  maxPendingApproval: 50,       // Alert if more than 50 pending
  maxFailedPublishes: 5,        // Alert if more than 5 failed in the last hour
  maxDbSizeMB: 500,             // Alert if DB exceeds 500MB
};

// ─── State ─────────────────────────────────────────────────────────────────

let lastCheck = 0;
let lastSummary = 0;

// ─── Helpers ───────────────────────────────────────────────────────────────

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
 * Get approximate DB size (main + WAL + SHM).
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

// ─── Metrics queries ───────────────────────────────────────────────────────

/**
 * Gather current pipeline metrics from the database.
 * @param {import('better-sqlite3').Database} db
 * @returns {Object} metrics
 */
function gatherMetrics(db) {
  const articlesLastHour = db.prepare(`
    SELECT COUNT(*) AS c FROM news_items WHERE ingested_at >= datetime('now', '-1 hour')
  `).get().c;

  const pendingApproval = db.prepare(`
    SELECT COUNT(*) AS c FROM approval_queue WHERE status = 'pending'
  `).get().c;

  const failedLastHour = db.prepare(`
    SELECT COUNT(*) AS c FROM approval_queue
    WHERE status = 'rejected' AND reviewed_at >= datetime('now', '-1 hour')
  `).get().c;

  const totalArticles = db.prepare(`SELECT COUNT(*) AS c FROM news_items`).get().c;
  const totalPublished = db.prepare(`SELECT COUNT(*) AS c FROM news_items WHERE status = 'published'`).get().c;
  const totalDiscarded = db.prepare(`SELECT COUNT(*) AS c FROM news_items WHERE status = 'discarded'`).get().c;

  const dbSizeBytes = getDbSize();

  return {
    articlesLastHour,
    pendingApproval,
    failedLastHour,
    totalArticles,
    totalPublished,
    totalDiscarded,
    dbSizeBytes,
    dbSizeMB: Math.round((dbSizeBytes / (1024 * 1024)) * 10) / 10,
  };
}

// ─── Check runner ──────────────────────────────────────────────────────────

/**
 * Check pipeline health metrics and alert if thresholds are breached.
 * Called every 15 minutes from the main loop.
 */
async function checkThresholds() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  try {
    const m = gatherMetrics(db);
    const alerts = [];

    // (1) Articles ingested in last hour
    if (m.articlesLastHour < THRESHOLDS.minArticlesPerHour) {
      alerts.push(`⚠️ *0 artículos* ingeridos en la última hora. Las fuentes pueden estar inactivas.`);
    }

    // (2) Pending approval
    if (m.pendingApproval > THRESHOLDS.maxPendingApproval) {
      alerts.push(`⚠️ *${m.pendingApproval} artículos* pendientes de aprobación (límite: ${THRESHOLDS.maxPendingApproval}). Revisá la cola.`);
    }

    // (3) Failed publishes
    if (m.failedLastHour > THRESHOLDS.maxFailedPublishes) {
      alerts.push(`⚠️ *${m.failedLastHour} publicaciones* fallaron en la última hora (límite: ${THRESHOLDS.maxFailedPublishes}).`);
    }

    // (4) DB size
    if (m.dbSizeMB > THRESHOLDS.maxDbSizeMB) {
      alerts.push(`⚠️ *Base de datos*: ${m.dbSizeMB}MB (límite: ${THRESHOLDS.maxDbSizeMB}MB). Considerar cleanup.`);
    }

    if (alerts.length > 0) {
      const msg = `🔍 *Pipeline Health — Alertas*\n\n${alerts.join('\n\n')}`;
      await sendTelegram(msg);
      logger.warn('Pipeline health alerts triggered', { alertCount: alerts.length });
    }
  } catch (e) {
    logger.error('Health check failed', { error: e.message });
  } finally {
    try { db.close(); } catch (_) {}
  }
}

// ─── Summary runner ────────────────────────────────────────────────────────

/**
 * Send a comprehensive pipeline summary.
 * Runs every 6 hours regardless of threshold breaches.
 */
async function sendSummary() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  try {
    const m = gatherMetrics(db);

    const msg = [
      `📊 *Pipeline Health — Resumen*`,
      ``,
      `⏱️ *Última hora*`,
      `   📰 Artículos ingeridos: ${m.articlesLastHour}`,
      `   ❌ Publicaciones fallidas: ${m.failedLastHour}`,
      ``,
      `📋 *Estado actual*`,
      `   ⏳ Pendientes de aprobación: ${m.pendingApproval}`,
      `   ✅ Publicados: ${m.totalPublished}`,
      `   🗑️ Descartados: ${m.totalDiscarded}`,
      `   📊 Total: ${m.totalArticles}`,
      ``,
      `💾 *Base de datos*`,
      `   Tamaño: ${formatSize(m.dbSizeBytes)}`,
      ``,
      `🔗 Usá /panel para gestionar automatizaciones.`,
    ].join('\n');

    await sendTelegram(msg);
    logger.info('Pipeline health summary sent');
  } catch (e) {
    logger.error('Summary failed', { error: e.message });
  } finally {
    try { db.close(); } catch (_) {}
  }
}

// ─── Main runner ───────────────────────────────────────────────────────────

/**
 * Run one pipeline health cycle:
 *   - Every 15 min: check thresholds and alert if breached
 *   - Every 6 hours: send comprehensive summary
 *
 * Called from the main notifier loop. Never throws.
 */
async function runPipelineHealth() {
  const now = Date.now();

  // Threshold check every CHECK_INTERVAL
  if (now - lastCheck >= CHECK_INTERVAL) {
    lastCheck = now;
    await checkThresholds();
  }

  // Summary every SUMMARY_INTERVAL
  if (now - lastSummary >= SUMMARY_INTERVAL) {
    lastSummary = now;
    await sendSummary();
  }
}

module.exports = { runPipelineHealth };
