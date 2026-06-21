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

const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'argentina-radar.db');
const BOT_TOKEN = '8653838115:AAFBRBhHEq3VXbfgiZwV1dtNjesBYwvhUqg';
const DEFAULT_CHAT_ID = '1923443777';
const LAST_BRIEFING_FILE = path.resolve(__dirname, '..', '..', 'data', 'last-briefing.txt');

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

// ─── DB queries ────────────────────────────────────────────────────────

function fetchTopArticles(db) {
  return db.prepare(`
    SELECT id, title, source, url, category
    FROM news_items
    WHERE ingested_at >= datetime('now', '-1 day')
    ORDER BY CAST(ai_score AS REAL) DESC
    LIMIT 5
  `).all();
}

function fetchCategoryCounts(db) {
  return db.prepare(`
    SELECT category, COUNT(*) AS c
    FROM news_items
    WHERE ingested_at >= datetime('now', '-1 day')
    GROUP BY category
    ORDER BY c DESC
  `).all();
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
    console.error('[briefing] Telegram error:', e.message);
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
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
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
  } finally {
    db.close();
  }
}

/**
 * Check if the briefing should be sent (auto-schedule).
 * Only sends if it hasn't been sent today, then records the date.
 *
 * @returns {Promise<boolean>} Whether the briefing was sent
 */
async function checkAndSendBriefing() {
  const today = getTodayDate();
  const lastSent = getLastBriefingDate();

  if (lastSent === today) {
    console.log('[briefing] Already sent today, skipping');
    return false;
  }

  const sent = await sendMorningBriefing(DEFAULT_CHAT_ID);
  if (sent) {
    setLastBriefingDate(today);
    console.log(`[briefing] Sent briefing for ${today}`);
  } else {
    console.log('[briefing] No articles found, not recording date');
  }
  return sent;
}

// ─── Standalone entry point ────────────────────────────────────────────

if (require.main === module) {
  checkAndSendBriefing()
    .then(sent => {
      console.log(sent ? '✓ Briefing sent' : '− Briefing skipped or no articles');
      process.exit(0);
    })
    .catch(err => {
      console.error('✗ Briefing error:', err);
      process.exit(1);
    });
}

module.exports = { sendMorningBriefing, checkAndSendBriefing };
