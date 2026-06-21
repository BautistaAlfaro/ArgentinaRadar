/**
 * Morning Briefing — ArgentinaRadar
 *
 * Fetches top articles from the last 24 hours, formats a rich
 * Telegram message grouped by category, and sends it via the
 * Telegram bot. Designed for both scheduled (auto) and on-demand
 * (/briefing) use.
 *
 * Standalone usage:
 *   node services/hermes-bridge/morning-briefing.js
 *
 * Module usage (from telegram-notifier.js):
 *   const { sendMorningBriefing, checkAndSendBriefing } = require('./morning-briefing');
 *   await sendMorningBriefing(chatId);           // on-demand, no dedup
 *   await checkAndSendBriefing();                // auto-schedule, with dedup
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { createLogger } = require('../../shared/logger');
const logger = createLogger('morning-briefing');

const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'argentina-radar.db');
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8653838115:AAFBRBhHEq3VXbfgiZwV1dtNjesBYwvhUqg';
const DEFAULT_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '1923443777';
const LAST_BRIEFING_FILE = path.resolve(__dirname, '..', '..', 'data', 'last-briefing.txt');
const DB_RETRY_DELAY = 1000; // 1 second between DB retries
const DB_MAX_RETRIES = 3;

// ─── Category helpers ──────────────────────────────────────────────────

const CATEGORY_META = {
  urgente:  { emoji: '🚨', label: 'Urgente' },
  politica: { emoji: '🗳️', label: 'Política' },
  economia: { emoji: '💰', label: 'Economía' },
  deportes: { emoji: '⚽', label: 'Deportes' },
  policial: { emoji: '🚔', label: 'Policial' },
  sociedad: { emoji: '🌎', label: 'Sociedad' },
};

function getCatMeta(cat) {
  return CATEGORY_META[cat] || { emoji: '📰', label: 'General' };
}

// ─── Date helpers ──────────────────────────────────────────────────────

function getTodayDate() {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

function getLocaleDateStr() {
  return new Date().toLocaleDateString('es-AR', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

// ─── Duplicate protection (auto-schedule only) ─────────────────────────

function getLastBriefingDate() {
  try {
    return fs.readFileSync(LAST_BRIEFING_FILE, 'utf8').trim();
  } catch {
    return null;
  }
}

function setLastBriefingDate(date) {
  fs.mkdirSync(path.dirname(LAST_BRIEFING_FILE), { recursive: true });
  fs.writeFileSync(LAST_BRIEFING_FILE, date, 'utf8');
}

// ─── DB helper with retry ──────────────────────────────────────────────

/**
 * Open a DB connection with retry for locked/busy SQLite.
 * Uses WAL mode and limited retries to avoid crashing the main loop.
 * @returns {import('better-sqlite3').Database|null}
 */
/**
 * Sleep helper for synchronous blocking (better-sqlite3 is sync).
 * @param {number} ms
 */
function sleep(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    // Busy-wait — acceptable for retry backoff in a sync context
  }
}

function openDbWithRetry() {
  for (let attempt = 0; attempt < DB_MAX_RETRIES; attempt++) {
    try {
      const db = new Database(DB_PATH);
      db.pragma('journal_mode = WAL');
      return db;
    } catch (e) {
      logger.warn('DB connection attempt failed', { attempt: attempt + 1, maxRetries: DB_MAX_RETRIES, error: e.message });
      if (attempt < DB_MAX_RETRIES - 1) {
        // Exponential backoff
        const delay = DB_RETRY_DELAY * Math.pow(2, attempt);
        sleep(delay);
      }
    }
  }
  console.error('[briefing] DB unavailable after retries — skipping');
  return null;
}

// ─── DB queries ────────────────────────────────────────────────────────

function fetchTopArticles(db) {
  try {
    return db.prepare(`
      SELECT id, title, source, url, category
      FROM news_items
      WHERE ingested_at >= datetime('now', '-1 day')
      ORDER BY CAST(ai_score AS REAL) DESC
      LIMIT 5
    `).all();
  } catch (e) {
    console.error('[briefing] Error fetching top articles:', e.message);
    return [];
  }
}

function fetchCategoryCounts(db) {
  try {
    return db.prepare(`
      SELECT category, COUNT(*) AS c
      FROM news_items
      WHERE ingested_at >= datetime('now', '-1 day')
      GROUP BY category
      ORDER BY c DESC
    `).all();
  } catch (e) {
    console.error('[briefing] Error fetching category counts:', e.message);
    return [];
  }
}

// ─── Message formatting ────────────────────────────────────────────────

function formatBriefingMessage(articles, categoryCounts) {
  const dateStr = getLocaleDateStr();

  // Top 5 articles
  const topLines = articles.map((a, i) => {
    const emoji = getCatMeta(a.category).emoji;
    return `${i + 1}. ${emoji} [${a.title}](${a.url}) — *${a.source}*`;
  });

  // Category breakdown
  const catLines = categoryCounts.map(c => {
    const meta = getCatMeta(c.category || 'general');
    return `${meta.emoji} ${meta.label}: ${c.c}`;
  });

  return [
    `☀️ *ArgentinaRadar — Morning Briefing*`,
    `${dateStr}`,
    ``,
    `🔥 *Top 5 noticias*`,
    topLines.join('\n'),
    ``,
    `📊 *Por categoría*`,
    catLines.join(' | '),
    ``,
    `🔗 Ver todas: /today`,
  ].join('\n');
}

// ─── Telegram sender ───────────────────────────────────────────────────

async function sendTelegramMessage(chatId, text) {
  try {
    const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: parseInt(chatId, 10),
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: false,
      }),
    });
    return await resp.json();
  } catch (e) {
    logger.error('Telegram error sending briefing', { error: e.message });
    return null;
  }
}

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Send the morning briefing immediately (on-demand).
 * Ignores duplicate protection — sends regardless of last-sent date.
 *
 * @param {string|number} chatId - Telegram chat ID
 * @returns {Promise<boolean>} Whether the briefing was sent
 */
async function sendMorningBriefing(chatId) {
  const db = openDbWithRetry();
  if (!db) {
    await sendTelegramMessage(
      chatId || DEFAULT_CHAT_ID,
      '☀️ *Morning Briefing*\n\n⚠️ No se pudo conectar a la base de datos. Intentalo de nuevo más tarde.',
    ).catch(() => {});
    return false;
  }
  try {
    const articles = fetchTopArticles(db);
    const categoryCounts = fetchCategoryCounts(db);

    if (articles.length === 0) {
      await sendTelegramMessage(
        chatId || DEFAULT_CHAT_ID,
        '☀️ *Morning Briefing*\n\nNo hay artículos en las últimas 24 horas.',
      );
      return false;
    }

    const message = formatBriefingMessage(articles, categoryCounts);
    await sendTelegramMessage(chatId || DEFAULT_CHAT_ID, message);
    return true;
  } catch (e) {
    console.error('[briefing] Error generating briefing:', e.message);
    try {
      await sendTelegramMessage(
        chatId || DEFAULT_CHAT_ID,
        '☀️ *Morning Briefing*\n\n⚠️ Error al generar el briefing.',
      );
    } catch (_) {}
    return false;
  } finally {
    try { db.close(); } catch (_) {}
  }
}

/**
 * Check if the briefing should be sent (auto-schedule).
 * Only sends if it hasn't been sent today, then records the date.
 *
 * @returns {Promise<boolean>} Whether the briefing was sent
 */
async function checkAndSendBriefing() {
  try {
    const today = getTodayDate();
    const lastSent = getLastBriefingDate();

    if (lastSent === today) {
      logger.info('Briefing already sent today, skipping');
      return false;
    }

    const sent = await sendMorningBriefing(DEFAULT_CHAT_ID);
    if (sent) {
      setLastBriefingDate(today);
      logger.info('Sent briefing', { date: today });
    } else {
      logger.info('No articles found, not recording briefing date');
    }
    return sent;
  } catch (e) {
    console.error('[briefing] Error in checkAndSendBriefing:', e.message);
    return false;
  }
}

// ─── Standalone entry point ────────────────────────────────────────────

if (require.main === module) {
  checkAndSendBriefing()
    .then(sent => {
      logger.info(sent ? 'Briefing sent' : 'Briefing skipped or no articles');
      process.exit(0);
    })
    .catch(err => {
      logger.error('Briefing error', { error: err });
      process.exit(1);
    });
}

module.exports = { sendMorningBriefing, checkAndSendBriefing };
