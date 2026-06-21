/**
 * Alert Manager — ArgentinaRadar
 *
 * Manages keyword and province alerts for Telegram users.
 * Handles alert CRUD (add/remove/list) and the matching logic
 * that checks articles against configured alerts.
 *
 * The alerts table stores both keyword and province-type alerts:
 *   - keyword: matched against article title, summary, and location
 *   - province: matched against article location data (from geolocation)
 *
 * Usage (CommonJS):
 *   const { addAlert, removeAlert, listAlerts, checkAlerts, sendAlertNotification, PROVINCES }
 *     = require('./alerts');
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'argentina-radar.db');

// Fallback to hardcoded token for backward compatibility
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8653838115:AAFBRBhHEq3VXbfgiZwV1dtNjesBYwvhUqg';

// ─── Argentine Provinces ────────────────────────────────────────────────

const PROVINCES = [
  'Buenos Aires', 'CABA', 'Catamarca', 'Chaco', 'Chubut',
  'Córdoba', 'Corrientes', 'Entre Ríos', 'Formosa', 'Jujuy',
  'La Pampa', 'La Rioja', 'Mendoza', 'Misiones', 'Neuquén',
  'Río Negro', 'Salta', 'San Juan', 'San Luis', 'Santa Cruz',
  'Santa Fe', 'Santiago del Estero', 'Tierra del Fuego', 'Tucumán',
];

// ─── Database ───────────────────────────────────────────────────────────

/**
 * Open a connection to the shared SQLite DB and ensure the alerts table exists.
 */
function getDb() {
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
  return db;
}

// ─── CRUD Operations ────────────────────────────────────────────────────

/**
 * Add an alert for a user.
 *
 * @param {string} keyword  - The word or phrase to watch (e.g. "Córdoba", "inflación")
 * @param {'keyword'|'province'} type - Alert type
 * @param {string|number} chatId - Telegram chat ID
 * @returns {boolean} True if added, false if duplicate or invalid
 */
function addAlert(keyword, type, chatId) {
  const normalized = keyword.trim();
  if (!normalized) return false;

  const db = getDb();
  try {
    const existing = db.prepare(
      `SELECT id FROM alerts
       WHERE LOWER(keyword) = LOWER(?) AND chat_id = ? AND type = ? AND active = 1`
    ).get(normalized, String(chatId), type);

    if (existing) return false; // Duplicate

    db.prepare(
      'INSERT INTO alerts (keyword, type, chat_id) VALUES (?, ?, ?)'
    ).run(normalized, type, String(chatId));

    return true;
  } finally {
    db.close();
  }
}

/**
 * Remove (deactivate) an alert for a user.
 *
 * @param {string} keyword - The keyword to remove
 * @param {string|number} chatId - Telegram chat ID
 * @returns {boolean} True if an alert was deactivated
 */
function removeAlert(keyword, chatId) {
  const db = getDb();
  try {
    const result = db.prepare(
      `UPDATE alerts SET active = 0
       WHERE LOWER(keyword) = LOWER(?) AND chat_id = ? AND active = 1`
    ).run(keyword.trim(), String(chatId));

    return result.changes > 0;
  } finally {
    db.close();
  }
}

/**
 * List all active alerts for a user.
 *
 * @param {string|number} chatId - Telegram chat ID
 * @returns {Array<{keyword: string, type: string, created_at: string}>}
 */
function listAlerts(chatId) {
  const db = getDb();
  try {
    return db.prepare(
      `SELECT keyword, type, created_at FROM alerts
       WHERE chat_id = ? AND active = 1
       ORDER BY created_at DESC`
    ).all(String(chatId));
  } finally {
    db.close();
  }
}

// ─── Matching Engine ────────────────────────────────────────────────────

/**
 * Check an article against ALL active alerts across all users.
 *
 * The matching is case-insensitive and uses simple substring containment:
 *   - keyword alerts: match against title + summary + location text
 *   - province alerts: match against location text only
 *
 * @param {Object} article
 * @param {string} article.title
 * @param {string} [article.summary]
 * @param {string|Object|null} [article.location] - JSON string or parsed object from geolocation
 * @returns {Array<{keyword: string, type: string, chat_id: string}>} Matched alerts
 */
function checkAlerts(article) {
  const db = getDb();
  try {
    const activeAlerts = db.prepare(
      'SELECT keyword, type, chat_id FROM alerts WHERE active = 1'
    ).all();

    if (activeAlerts.length === 0) return [];

    // Build searchable text
    const searchText = [article.title || '', article.summary || '']
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    // Normalize location to a flat lowercase string
    let locationText = '';
    if (article.location) {
      if (typeof article.location === 'string') {
        try {
          const parsed = JSON.parse(article.location);
          locationText = Object.values(parsed).filter(Boolean).join(' ').toLowerCase();
        } catch {
          locationText = article.location.toLowerCase();
        }
      } else if (typeof article.location === 'object') {
        locationText = Object.values(article.location).filter(Boolean).join(' ').toLowerCase();
      }
    }

    const matches = [];

    for (const alert of activeAlerts) {
      const keyword = alert.keyword.toLowerCase().trim();

      if (alert.type === 'province') {
        // Province alerts match against location data only
        if (locationText.includes(keyword)) {
          matches.push(alert);
        }
      } else {
        // Keyword alerts match against title + summary + location
        if (searchText.includes(keyword) || locationText.includes(keyword)) {
          matches.push(alert);
        }
      }
    }

    return matches;
  } finally {
    db.close();
  }
}

// ─── Notification ───────────────────────────────────────────────────────

/**
 * Send a Telegram notification for each matched alert.
 *
 * Format: 🔔 *Alerta: {keyword}* — {title} ({source})
 *
 * @param {Array<{keyword: string, type: string, chat_id: string}>} matches
 * @param {Object} article
 * @param {string} article.title
 * @param {string} [article.source]
 */
/**
 * Escape Markdown special characters for Telegram.
 */
function escapeMarkdown(text) {
  return (text || '').replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

async function sendAlertNotification(matches, article) {
  for (const match of matches) {
    const safeKeyword = escapeMarkdown(match.keyword);
    const safeTitle = escapeMarkdown(article.title);
    const safeSource = escapeMarkdown(article.source || 'Desconocida');
    const text = `🔔 *Alerta: ${safeKeyword}*\n\n📰 ${safeTitle}\n📌 ${safeSource}`;

    try {
      const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: parseInt(match.chat_id, 10),
          text,
          parse_mode: 'Markdown',
        }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        console.error(`[alerts] Telegram API error for ${match.chat_id}:`, err.slice(0, 200));
      }
    } catch (e) {
      console.error(`[alerts] Network error sending to ${match.chat_id}:`, e.message);
    }
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────

module.exports = {
  PROVINCES,
  addAlert,
  removeAlert,
  listAlerts,
  checkAlerts,
  sendAlertNotification,
};
