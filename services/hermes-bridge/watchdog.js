/**
 * Service Watchdog — ArgentinaRadar
 *
 * Health-checks all core services every 60 seconds. If a service is down
 * for 2 consecutive checks, attempts to restart it via PM2. If the restart
 * fails twice, escalates with a Telegram alert.
 *
 * Controlled via:
 *   - env: WATCHDOG_ENABLED, WATCHDOG_INTERVAL
 *   - automations.json: watchdog (true/false)
 *
 * Usage:
 *   const { runWatchdog } = require('./watchdog');
 *   await runWatchdog();
 */

const Database = require('better-sqlite3');
const path = require('path');
const { execSync } = require('child_process');
const { createLogger } = require('../../shared/logger');

const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'argentina-radar.db');
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8653838115:AAFBRBhHEq3VXbfgiZwV1dtNjesBYwvhUqg';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '1923443777';
const INTERVAL = parseInt(process.env.WATCHDOG_INTERVAL || '60000', 10);

const logger = createLogger('watchdog');

// ─── Services to monitor ──────────────────────────────────────────────────

const SERVICES = [
  { name: 'news-service',     port: 3001 },
  { name: 'bsky-publisher',   port: 3004 },
  { name: 'ai-processor',     port: 3012 },
  { name: 'ai-processor-alt', port: 3013 },
  { name: 'frontend',         port: 5173 },
];

// ─── State tracking ───────────────────────────────────────────────────────

/** @type {Object<string, number>} Consecutive health-check failures per service */
const failureCounts = {};

/** @type {Object<string, number>} Consecutive failed restart attempts per service */
const restartAttempts = {};

let lastRun = 0;

// ─── DB helpers ────────────────────────────────────────────────────────────

/**
 * Ensure the service_incidents table exists (idempotent).
 */
function ensureIncidentsTable() {
  try {
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
    db.close();
  } catch (e) {
    logger.error('Failed to ensure incidents table', { error: e.message });
  }
}

/**
 * Insert an incident record.
 * @param {string} service
 * @param {string} type
 * @param {string} details
 */
function logIncident(service, type, details) {
  try {
    const db = new Database(DB_PATH);
    db.prepare(
      'INSERT INTO service_incidents (service, incident_type, details) VALUES (?, ?, ?)'
    ).run(service, type, details);
    db.close();
  } catch (e) {
    logger.error('Failed to log incident', { error: e.message });
  }
}

// ─── Telegram helper ───────────────────────────────────────────────────────

/**
 * Send a Markdown message to the configured Telegram chat.
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
    if (!resp.ok) {
      const err = await resp.text();
      logger.warn('Telegram API error', { error: err.slice(0, 200) });
    }
    return resp.ok;
  } catch (e) {
    logger.warn('Telegram send failed', { error: e.message });
    return false;
  }
}

// ─── Health check ──────────────────────────────────────────────────────────

/**
 * Check whether a service is alive by hitting its /health endpoint.
 * @param {{ name: string, port: number }} service
 * @returns {Promise<boolean>}
 */
async function healthCheck(service) {
  try {
    const resp = await fetch(`http://127.0.0.1:${service.port}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Attempt to restart a service via PM2.
 * @param {string} serviceName
 * @returns {boolean}
 */
function attemptRestart(serviceName) {
  try {
    execSync(`pm2 restart ${serviceName}`, { timeout: 15000, stdio: 'pipe' });
    logger.info(`PM2 restart succeeded for ${serviceName}`);
    return true;
  } catch (e) {
    logger.warn(`PM2 restart failed for ${serviceName}`, { error: e.message });
    return false;
  }
}

// ─── Main runner ───────────────────────────────────────────────────────────

/**
 * Run one watchdog cycle: check all services and react to failures.
 *
 * Called from the main notifier loop. Never throws — all errors are caught
 * and logged internally.
 */
async function runWatchdog() {
  const now = Date.now();
  if (now - lastRun < INTERVAL) return;
  lastRun = now;

  logger.info('🔍 Running service health check...');

  for (const service of SERVICES) {
    try {
      const alive = await healthCheck(service);

      if (alive) {
        // Service is healthy — reset counters
        if (failureCounts[service.name] && failureCounts[service.name] >= 2) {
          logger.info(`${service.name} recovered — health OK`);
        }
        failureCounts[service.name] = 0;
        continue;
      }

      // ── Service is down ──
      failureCounts[service.name] = (failureCounts[service.name] || 0) + 1;
      logger.warn(`${service.name}:${service.port} DOWN (${failureCounts[service.name]}/2 failures)`);

      if (failureCounts[service.name] < 2) {
        // First consecutive failure — just observe
        continue;
      }

      // 2+ consecutive failures — attempt restart
      const attempt = (restartAttempts[service.name] || 0) + 1;
      restartAttempts[service.name] = attempt;

      logIncident(service.name, 'down', `Port ${service.port} unreachable after ${failureCounts[service.name]} consecutive failures`);

      if (attempt > 2) {
        // Already tried twice — escalate
        await sendTelegram(
          `🚨 *Watchdog — ${service.name}*\n\nEl servicio cayó y no pudo reiniciarse tras varios intentos.\n\n📌 *Puerto:* ${service.port}\n⚠️ *Se requiere intervención manual.*`
        );
        logIncident(service.name, 'restart_failed', `Escalated after ${attempt} failed restart attempts`);
        restartAttempts[service.name] = 0; // Reset to avoid re-escalating every cycle
        continue;
      }

      // Try to restart
      await sendTelegram(
        `🔴 *${service.name}* cayó (puerto ${service.port}). Reiniciando... (intento ${attempt})`
      );

      const restarted = attemptRestart(service.name);

      if (restarted) {
        logIncident(service.name, 'restart_success', `Service restarted on attempt ${attempt}`);
        await sendTelegram(`✅ *${service.name}* reiniciado correctamente.`);
        failureCounts[service.name] = 0;
        restartAttempts[service.name] = 0;
      } else {
        logIncident(service.name, 'restart_failed', `Restart attempt ${attempt} failed`);
        // Next cycle with still-failing health check will trigger another attempt or escalation
      }
    } catch (e) {
      logger.error(`Error processing ${service.name}`, { error: e.message });
    }
  }
}

// ─── Init ──────────────────────────────────────────────────────────────────

ensureIncidentsTable();

module.exports = { runWatchdog };
