/**
 * Auto-Backup — ArgentinaRadar
 *
 * Creates a timestamped copy of the SQLite database every 6 hours.
 * Retains the last N backups (default: 7) and purges older ones.
 * Sends a Telegram notification with the backup file size.
 *
 * Controlled via:
 *   - env: AUTO_BACKUP_ENABLED, AUTO_BACKUP_INTERVAL, AUTO_BACKUP_KEEP
 *   - automations.json: autoBackup (true/false)
 *
 * Usage:
 *   const { runAutoBackup } = require('./autoBackup');
 *   await runAutoBackup();
 */

const fs = require('fs');
const path = require('path');
const { createLogger } = require('../../shared/logger');

const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'argentina-radar.db');
const BACKUP_DIR = path.resolve(__dirname, '..', '..', 'data', 'backups');
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const INTERVAL = parseInt(process.env.AUTO_BACKUP_INTERVAL || '21600000', 10); // 6 hours
const KEEP = parseInt(process.env.AUTO_BACKUP_KEEP || '7', 10);

const logger = createLogger('auto-backup');

let lastRun = 0;

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Format bytes to a human-readable string (KB, MB, etc.).
 * @param {number} bytes
 * @returns {string}
 */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Generate a timestamped backup filename.
 * @returns {string} e.g. argentina-radar-2026-06-21-1800.db
 */
function backupFilename() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `argentina-radar-${y}-${m}-${d}-${hh}${mm}.db`;
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
 * Run one backup cycle: create a timestamped copy, purge old backups,
 * and send a notification.
 *
 * Called from the main notifier loop. Never throws — all errors are caught
 * and logged internally.
 */
async function runAutoBackup() {
  const now = Date.now();
  if (now - lastRun < INTERVAL) return;
  lastRun = now;

  logger.info('💾 Running auto-backup...');

  try {
    // Ensure backup directory exists
    fs.mkdirSync(BACKUP_DIR, { recursive: true });

    // Verify source DB exists
    if (!fs.existsSync(DB_PATH)) {
      logger.error('Source DB not found for backup', { path: DB_PATH });
      return;
    }

    // Create the backup
    const filename = backupFilename();
    const dest = path.join(BACKUP_DIR, filename);
    fs.copyFileSync(DB_PATH, dest);

    // Get file size
    const stats = fs.statSync(dest);
    const sizeStr = formatSize(stats.size);

    logger.info(`Backup created: ${filename} (${sizeStr})`);

    // Purge old backups
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('argentina-radar-') && f.endsWith('.db'))
      .sort()
      .reverse();

    let deleted = 0;
    while (backups.length > KEEP) {
      const oldFile = backups.pop();
      fs.unlinkSync(path.join(BACKUP_DIR, oldFile));
      deleted++;
    }

    if (deleted > 0) {
      logger.info(`Purged ${deleted} old backup(s)`);
    }

    // Send notification
    const msg = `💾 *Backup completado:* \`${filename}\` (${sizeStr})` +
      (deleted > 0 ? `\n🗑️ *Eliminados:* ${deleted} backup(s) antiguo(s)` : '');
    await sendTelegram(msg);
  } catch (e) {
    logger.error('Backup failed', { error: e.message });
  }
}

module.exports = { runAutoBackup };
