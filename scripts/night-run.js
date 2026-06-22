#!/usr/bin/env node
/**
 * Night Runner — Auto-Publish Masivo Nocturno
 *
 * Procesa TODOS los artículos con status='ingested' o status='pending':
 *   1. Categoriza (si no tiene categoría)
 *   2. Quality score (si no tiene score)
 *   3. Genera imagen vía Pollinations.ai (gratis)
 *   4. Publica a Bluesky
 *
 * Rate limit: 1 artículo cada 5 segundos (para no saturar APIs)
 * Usa createLoop() para graceful shutdown.
 * Trackea sesiones en la tabla session_summaries.
 *
 * Uso:
 *   node scripts/night-run.js
 *
 * Config:
 *   - BATCH_SIZE: cuántos artículos tomar por ciclo (default: 50)
 *   - RATE_LIMIT_MS: ms entre publicaciones (default: 5000)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', 'config', '.env') });

const Database = require('better-sqlite3');
const path = require('path');

// ─── Inline Categorizer (pure JS port of shared/categorizer.ts) ──────────

const KEYWORD_MAPS = {
  urgente: [
    'último momento', 'ultimo momento', 'urgente', 'emergencia',
    'alerta', 'explosión', 'explosion', 'terremoto', 'catástrofe', 'catastrofe',
  ],
  politica: [
    'milei', 'presidente', 'diputado', 'senador', 'congreso',
    'ley', 'decreto', 'ministro', 'gobernador', 'elección', 'eleccion',
    'votación', 'votacion',
  ],
  economia: [
    'dólar', 'dolar', 'inflación', 'inflacion', 'fmi', 'bcra',
    'economía', 'economia', 'pib', 'recesión', 'recesion', 'impuesto',
    'salario', 'jubilación', 'jubilacion', 'presupuesto',
  ],
  deportes: [
    'fútbol', 'futbol', 'boca', 'river', 'selección', 'seleccion',
    'messi', 'scaloneta', 'argentinos juniors', 'racing', 'independiente',
    'liga profesional', 'copa argentina', 'libertadores',
  ],
  policial: [
    'secuestro', 'homicidio', 'robo', 'detenido', 'allanamiento',
    'crimen', 'violencia', 'narcotráfico', 'narcotrafico', 'mafia',
    'feminicidio', 'violación', 'violacion', 'asalto', 'inseguridad',
  ],
  sociedad: [
    'salud', 'educación', 'educacion', 'derechos', 'protesta',
    'manifestación', 'manifestacion', 'paro', 'huelga', 'corte',
    'covid', 'vacuna', 'pobreza', 'desempleo', 'vivienda',
  ],
};

function categorizeArticle(title, summary, source) {
  const text = `${title} ${summary || ''} ${source || ''}`.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const scores = {};
  let max = 0;
  let best = 'general';
  for (const [cat, keywords] of Object.entries(KEYWORD_MAPS)) {
    let count = 0;
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) count++;
    }
    scores[cat] = count;
    if (count > max) { max = count; best = cat; }
  }
  return best;
}

// ─── Inline Quality Scorer ─────────────────────────────────────────────

function scoreArticleQuality(title, summary, source) {
  let score = 0;
  const tLen = (title || '').length;
  score += tLen >= 15 && tLen <= 80 ? 20 : tLen > 0 ? 10 : 0;
  const t = title || '';
  if (t === t.toUpperCase() && tLen > 20) score += 0; else score += 20;
  if (t.includes('!!!') || t.includes('???')) score -= 10;
  if ((summary || '').length > 30) score += 15;
  const s = (source || '').toLowerCase();
  const reputable = ['clarin','lanacion','infobae','ambito','cronista','pagina12','tn','perfil'];
  if (reputable.includes(s)) score += 25;
  else if (s.length > 0) score += 15;
  score += 5;
  return Math.min(100, Math.max(0, score));
}

// ─── Config ──────────────────────────────────────────────────────────────

const DB_PATH = process.env.DB_PATH ?? path.resolve(__dirname, '..', 'data', 'argentina-radar.db');
const TWITTER_PUBLISHER_URL = process.env.TWITTER_PUBLISHER_URL ?? 'http://127.0.0.1:3004';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE ?? '50', 10);
const RATE_LIMIT_MS = parseInt(process.env.NIGHT_RATE_LIMIT ?? '5000', 10);

// ─── DB ──────────────────────────────────────────────────────────────────

let db;

function getDb() {
  if (db) return db;
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  // Ensure session_summaries table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      articles_processed INTEGER DEFAULT 0,
      articles_published INTEGER DEFAULT 0,
      articles_failed INTEGER DEFAULT 0,
      images_generated INTEGER DEFAULT 0,
      status TEXT DEFAULT 'running'
    )
  `);
  return db;
}

// ─── NanoBanana Prompt ──────────────────────────────────────────────────

function buildNanoBananaPrompt(title, source, category) {
  const headline = (title || '').substring(0, 120).replace(/[*_`[\]()#+-.!]/g, '');
  const scene = (title || '').substring(0, 150).replace(/[*_`[\]()#+-.!]/g, '');
  const catBadge = category === 'urgente' ? '🚨 URGENTE' : category === 'politica' ? '🇦🇷 POLÍTICA' :
    category === 'economia' ? '📈 ECONOMÍA' : category === 'deportes' ? '⚽ DEPORTES' : '🌎 INTERNACIONAL';

  return [
    'Professional Argentine news thumbnail, horizontal 16:9 layout.',
    `Headline: "${headline}".`,
    'Style: dramatic Argentine TV news ("Only Fonseca" channel style) — high contrast, cinematic lighting, photorealistic.',
    'Color palette: dark navy blue (#003087) background with gold (#FFD700) accents and text.',
    `Source badge: ${(source || '').toUpperCase()} logo in top corner.`,
    'Elements: bold news typography, expressive faces if relevant, dramatic shadows.',
    `Scene: ${scene}`,
    'No cartoon, no illustration — photorealistic news broadcast style.',
    'Clean modern composition, professional Argentine journalism aesthetic.'
  ].join(' ');
}

// ─── Bluesky Format ─────────────────────────────────────────────────────

function formatBlueskyTweet(title, source, category) {
  const catEmoji = category === 'urgente' ? '🚨' : category === 'politica' ? '🗳️' :
    category === 'economia' ? '💰' : category === 'deportes' ? '⚽' :
    category === 'policial' ? '🚔' : category === 'sociedad' ? '🌎' : '📰';
  const catTag = category ? ` #${category.charAt(0).toUpperCase() + category.slice(1)}` : '';
  const suffix = `\n\n📌 ${source} | ${catEmoji} | #ArgentinaRadar${catTag}`;
  const suffixLen = suffix.length;

  let headline = (title || '').trim();
  const maxHeadline = 300 - suffixLen;
  if (headline.length > maxHeadline) {
    headline = headline.substring(0, maxHeadline - 3);
    const lastSpace = headline.lastIndexOf(' ');
    if (lastSpace > maxHeadline * 0.7) headline = headline.substring(0, lastSpace);
    headline += '...';
  }
  return `🇦🇷 ${headline}${suffix}`;
}

// ─── Session Management ─────────────────────────────────────────────────

let sessionId = null;

function startSession() {
  const d = getDb();
  const result = d.prepare(
    "INSERT INTO session_summaries (started_at, status) VALUES (datetime('now'), 'running')"
  ).run();
  sessionId = result.lastInsertRowid;
  console.log(`[night-run] 📊 Session #${sessionId} started`);
  return sessionId;
}

function updateSession(stats) {
  if (!sessionId) return;
  const d = getDb();
  d.prepare(`
    UPDATE session_summaries SET
      articles_processed = ?,
      articles_published = ?,
      articles_failed = ?,
      images_generated = ?
    WHERE id = ?
  `).run(
    stats.processed || 0,
    stats.published || 0,
    stats.failed || 0,
    stats.imagesGenerated || 0,
    sessionId
  );
}

function endSession(stats) {
  if (!sessionId) return;
  const d = getDb();
  d.prepare(`
    UPDATE session_summaries SET
      ended_at = datetime('now'),
      articles_processed = ?,
      articles_published = ?,
      articles_failed = ?,
      images_generated = ?,
      status = ?
    WHERE id = ?
  `).run(
    stats.processed || 0,
    stats.published || 0,
    stats.failed || 0,
    stats.imagesGenerated || 0,
    stats.status || 'completed',
    sessionId
  );
  console.log(`[night-run] 📊 Session #${sessionId} ended: ${stats.processed} processed, ${stats.published} published, ${stats.failed} failed`);
}

// ─── Stats ──────────────────────────────────────────────────────────────

let totalStats = { processed: 0, published: 0, failed: 0, imagesGenerated: 0 };
let lastLogCount = 0;

function logProgress(totalArticles) {
  // Log every 50 articles processed
  const sinceLastLog = totalStats.processed - lastLogCount;
  if (sinceLastLog >= 50 || totalStats.processed === totalArticles) {
    const pct = totalArticles > 0 ? Math.round((totalStats.processed / totalArticles) * 100) : 0;
    console.log(
      `[night-run] 📊 Procesados: ${totalStats.processed}/${totalArticles} (${pct}%) — ` +
      `Publicados: ${totalStats.published} — Fallidos: ${totalStats.failed} — ` +
      `Imágenes: ${totalStats.imagesGenerated}`
    );
    updateSession(totalStats);
    lastLogCount = totalStats.processed;
  }
}

// ─── Process One Article ────────────────────────────────────────────────

async function processArticle(article) {
  const d = getDb();
  const articleId = article.id;

  try {
    // 1. Categorize if needed
    let category = article.category || 'general';
    if (!article.category || article.category === 'general') {
      category = categorizeArticle(article.title, article.summary || '', article.source);
      d.prepare('UPDATE news_items SET category = ? WHERE id = ?').run(category, articleId);
    }

    // 2. Quality score if needed
    let qualityScore = article.quality_score;
    if (qualityScore === null || qualityScore === undefined) {
      qualityScore = scoreArticleQuality(article.title, article.summary || '', article.source);
      d.prepare('UPDATE news_items SET quality_score = ? WHERE id = ?').run(qualityScore, articleId);
    }

    // 3. Generate image via Pollinations
    const nanoPrompt = buildNanoBananaPrompt(article.title, article.source, category);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(nanoPrompt)}?width=1280&height=720&nologo=true&seed=${Math.floor(Math.random() * 1000)}`;
    totalStats.imagesGenerated++;

    // 4. Format Bluesky tweet
    const tweetText = formatBlueskyTweet(article.title, article.source, category);

    // 5. Insert into approval_queue as approved
    const queueId = `nr_${articleId.slice(0, 12)}`;
    d.prepare(
      `INSERT OR IGNORE INTO approval_queue (id, article_id, draft_tweet, image_url, image_prompt, status, reviewed_at)
       VALUES (?, ?, ?, ?, ?, 'approved', datetime('now'))`
    ).run(queueId, articleId, tweetText, imageUrl, nanoPrompt);

    // 6. Update article status
    d.prepare("UPDATE news_items SET status = 'auto_published' WHERE id = ? AND status NOT IN ('published', 'auto_published')")
      .run(articleId);

    // 7. Publish to Bluesky
    const pubResp = await fetch(`${TWITTER_PUBLISHER_URL}/api/publish-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ article_id: articleId, text: tweetText, image_url: imageUrl }),
      signal: AbortSignal.timeout(15_000),
    });
    const pubResult = await pubResp.json();
    if (pubResult.success) {
      totalStats.published++;
      console.log(`  ✅ Publicado: ${(article.title || '').substring(0, 50)}...`);
    } else {
      totalStats.failed++;
      console.warn(`  ❌ Falló: ${(article.title || '').substring(0, 50)}... — ${pubResult.error || 'error'}`);
    }

    totalStats.processed++;

  } catch (err) {
    totalStats.failed++;
    totalStats.processed++;
    console.warn(`  ⚠️ Error: ${(article.title || '').substring(0, 50)}... — ${err.message}`);
  }
}

// ─── Main Batch Function ────────────────────────────────────────────────

async function processBatch() {
  const d = getDb();

  // Count total articles to process (for progress tracking)
  const totalRow = d.prepare(
    "SELECT COUNT(*) as c FROM news_items WHERE status IN ('ingested', 'pending')"
  ).get();
  const totalArticles = totalRow.c;

  if (totalArticles === 0) {
    console.log('[night-run] No hay artículos pendientes.');
    return;
  }

  // Fetch a batch
  const articles = d.prepare(
    `SELECT id, title, summary, source, category, quality_score, url, published_at
     FROM news_items
     WHERE status IN ('ingested', 'pending')
     ORDER BY ingested_at ASC
     LIMIT ?`
  ).all(BATCH_SIZE);

  console.log(`[night-run] 🚀 Procesando lote de ${articles.length} artículos (${totalArticles} pendientes totales)`);

  for (const article of articles) {
    await processArticle(article);
    // Rate limit: 1 article every 5 seconds
    await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
    logProgress(totalArticles);
  }

  console.log(`[night-run] ✅ Lote completado: ${totalStats.processed} procesados esta sesión`);
}

// ─── Graceful Shutdown via createLoop ───────────────────────────────────

let running = false;
let shutdownRequested = false;

process.on('SIGINT', () => {
  console.log('\n[night-run] 🛑 SIGINT recibido — cerrando graceful...');
  shutdownRequested = true;
});

process.on('SIGTERM', () => {
  console.log('\n[night-run] 🛑 SIGTERM recibido — cerrando graceful...');
  shutdownRequested = true;
});

// ─── Bootstrap ──────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  🌙 ArgentinaRadar — Night Runner');
  console.log('  Auto-publish masivo nocturno');
  console.log(`  DB: ${DB_PATH}`);
  console.log(`  Rate limit: ${RATE_LIMIT_MS}ms`);
  console.log(`  Batch size: ${BATCH_SIZE}`);
  console.log('═══════════════════════════════════════════════');

  startSession();

  try {
    while (!shutdownRequested) {
      await processBatch();

      if (shutdownRequested) break;

      // Check if there are still pending articles
      const d = getDb();
      const remaining = d.prepare(
        "SELECT COUNT(*) as c FROM news_items WHERE status IN ('ingested', 'pending')"
      ).get().c;

      if (remaining === 0) {
        console.log('[night-run] ✅ Todos los artículos procesados. Sesión completa.');
        break;
      }

      // Wait a bit before next batch
      console.log(`[night-run] ⏳ Aún quedan ${remaining} artículos. Esperando 10s para próximo lote...`);
      await new Promise(r => setTimeout(r, 10000));
    }
  } catch (err) {
    console.error('[night-run] Error fatal:', err.message);
    endSession({ ...totalStats, status: 'failed' });
    process.exit(1);
  }

  endSession({ ...totalStats, status: 'completed' });
  console.log(`[night-run] 🏁 Sesión finalizada. Total: ${totalStats.processed} procesados, ${totalStats.published} publicados, ${totalStats.failed} fallidos.`);

  if (db) {
    db.close();
    db = null;
  }

  process.exit(0);
}

main();

// ─── Export for programmatic use ────────────────────────────────────────

module.exports = { processBatch, startSession, endSession, getDb };
