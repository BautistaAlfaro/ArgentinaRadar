/**
 * Weekly Digest — ArgentinaRadar
 *
 * Generates a comprehensive weekly summary of news activity:
 * top articles, ingestion stats, source rankings, and category
 * breakdown — sent as a rich Telegram message.
 *
 * Usage:
 *   node scripts/digest.js                     # sends via Telegram
 *   node scripts/digest.js --dry-run            # prints to console only
 *
 * Schedule: every Monday at 9:00 AM via Task Scheduler.
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.resolve(__dirname, '..', 'data', 'argentina-radar.db');
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) { console.error('FATAL: TELEGRAM_BOT_TOKEN no configurado'); process.exit(1); }
const DEFAULT_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// ─── Category helpers (mirrored from morning-briefing.js) ──────────────

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

function getWeekRange() {
  const now = new Date();
  const end = now.toLocaleDateString('es-AR', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const start = new Date(now);
  start.setDate(start.getDate() - 7);
  const startStr = start.toLocaleDateString('es-AR', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  return { start: startStr, end };
}

// ─── DB queries ────────────────────────────────────────────────────────

const QUERIES = {
  topArticles: `
    SELECT id, title, source, url, category
    FROM news_items
    WHERE ingested_at >= datetime('now', '-7 days')
    ORDER BY CAST(ai_score AS REAL) DESC
    LIMIT 10
  `,
  totalIngested: `
    SELECT COUNT(*) AS c
    FROM news_items
    WHERE ingested_at >= datetime('now', '-7 days')
  `,
  totalPublished: `
    SELECT COUNT(*) AS c
    FROM news_items
    WHERE ingested_at >= datetime('now', '-7 days')
      AND status = 'published'
  `,
  totalPending: `
    SELECT COUNT(*) AS c
    FROM approval_queue aq
    JOIN news_items n ON aq.article_id = n.id
    WHERE n.ingested_at >= datetime('now', '-7 days')
      AND aq.status = 'pending'
  `,
  totalRejected: `
    SELECT COUNT(*) AS c
    FROM approval_queue aq
    JOIN news_items n ON aq.article_id = n.id
    WHERE n.ingested_at >= datetime('now', '-7 days')
      AND aq.status = 'rejected'
  `,
  topSources: `
    SELECT source, COUNT(*) AS c
    FROM news_items
    WHERE ingested_at >= datetime('now', '-7 days')
    GROUP BY source
    ORDER BY c DESC
    LIMIT 5
  `,
  topCategory: `
    SELECT category, COUNT(*) AS c
    FROM news_items
    WHERE ingested_at >= datetime('now', '-7 days')
    GROUP BY category
    ORDER BY c DESC
    LIMIT 1
  `,
};

function runQueries(db) {
  return {
    topArticles: db.prepare(QUERIES.topArticles).all(),
    totalIngested: db.prepare(QUERIES.totalIngested).get().c,
    totalPublished: db.prepare(QUERIES.totalPublished).get().c,
    totalPending: db.prepare(QUERIES.totalPending).get().c,
    totalRejected: db.prepare(QUERIES.totalRejected).get().c,
    topSources: db.prepare(QUERIES.topSources).all(),
    topCategory: db.prepare(QUERIES.topCategory).get(),
  };
}

// ─── Message formatting ────────────────────────────────────────────────

function formatDigestMessage(stats) {
  const { start, end } = getWeekRange();

  // Top 10 articles
  const topLines = stats.topArticles.map((a, i) => {
    const emoji = getCatMeta(a.category).emoji;
    const title = a.title.length > 60 ? a.title.substring(0, 57) + '...' : a.title;
    return `${i + 1}. ${emoji} [${title}](${a.url}) — *${a.source}*`;
  });

  // Top sources
  const totalFromTop = stats.topSources.reduce((sum, s) => sum + s.c, 0);
  const sourceLines = stats.topSources.map(s =>
    `• ${s.source}: *${s.c}* artículos`,
  );

  // Most active category
  const catMeta = getCatMeta(stats.topCategory?.category || 'general');
  const activeCat = stats.topCategory
    ? `${catMeta.emoji} *${catMeta.label}* (${stats.topCategory.c} artículos)`
    : '—';

  return [
    `📅 *ArgentinaRadar — Weekly Digest*`,
    `Semana del ${start} al ${end}`,
    ``,
    `🔥 *Top 10 noticias*`,
    topLines.join('\n'),
    ``,
    `📊 *Estadísticas semanales*`,
    `📰 Total ingeridos: *${stats.totalIngested}*`,
    `✅ Publicados: *${stats.totalPublished}*`,
    `⏳ Pendientes: *${stats.totalPending}*`,
    `❌ Rechazados: *${stats.totalRejected}*`,
    ``,
    `🏆 *Fuentes más activas*`,
    sourceLines.join('\n'),
    ``,
    `📈 *Categoría más activa*`,
    activeCat,
    ``,
    `🔗 Ver todo: /today`,
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
    console.error('[digest] Telegram error:', e.message);
    return null;
  }
}

// ─── Main ──────────────────────────────────────────────────────────────

async function main() {
  const isDryRun = process.argv.includes('--dry-run');

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  let stats;
  try {
    stats = runQueries(db);
  } finally {
    db.close();
  }

  if (stats.totalIngested === 0) {
    const msg = '📅 *Weekly Digest*\n\nNo hay artículos en los últimos 7 días.';
    if (isDryRun) {
      console.log(msg.replace(/\*+/g, ''));
    } else {
      await sendTelegramMessage(DEFAULT_CHAT_ID, msg);
    }
    console.log('[digest] No articles found in last 7 days');
    return;
  }

  const message = formatDigestMessage(stats);

  if (isDryRun) {
    console.log('─── Weekly Digest (dry run) ───');
    console.log(message);
    console.log('────────────────────────────────');
  } else {
    await sendTelegramMessage(DEFAULT_CHAT_ID, message);
    console.log(`[digest] Digest sent — ${stats.totalIngested} articles in 7 days`);
  }
}

main().catch(err => {
  console.error('[digest] Fatal error:', err);
  process.exit(1);
});
