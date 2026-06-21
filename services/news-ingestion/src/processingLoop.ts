/**
 * Processing Loop — permanent pipeline for processing ingested articles.
 *
 * Runs continuously, polling for new articles and pushing them through:
 *   1. Categorization → assigns category
 *   2. Keyword alert check → notifies users on keyword matches
 *   3. Geolocation → adds location data
 *   4. Province alert check → notifies users on location matches
 *   5. AI Filter → classifies PUBLISH/DISCARD
 *   6. Approval Queue → creates entries for Telegram approval / auto-publish
 *
 * Uses createLoop() for graceful shutdown handling.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { createRequire } from 'module';
import { categorizeArticle } from '../../../shared/categorizer';

// Import the alerts module (CommonJS → ESM bridge)
const cRequire = createRequire(import.meta.url);
const alerts = cRequire('../../hermes-bridge/alerts.js');

const DB_PATH = process.env.DB_PATH ?? path.resolve(process.cwd(), '..', '..', 'data', 'argentina-radar.db');
const GEO_API = process.env.GEO_API ?? 'http://127.0.0.1:3002';
const AI_API = process.env.AI_API ?? 'http://127.0.0.1:3013';
const POLL_INTERVAL = parseInt(process.env.PROCESS_INTERVAL ?? '30000', 10); // 30 seconds

// ─── High-Impact Auto-Publish ──────────────────────────────────────────
const AUTO_PUBLISH_THRESHOLD = parseInt(process.env.AUTO_PUBLISH_THRESHOLD ?? '80', 10);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? '';
const TWITTER_PUBLISHER_URL = process.env.TWITTER_PUBLISHER_URL ?? 'http://127.0.0.1:3004';

let db: Database.Database | null = null;
let processedCount = 0;

function getDb(): Database.Database {
  if (db) return db;
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  // Ensure approval_queue table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS approval_queue (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      event_id TEXT,
      draft_tweet TEXT NOT NULL,
      image_url TEXT,
      image_prompt TEXT,
      status TEXT DEFAULT 'pending',
      telegram_message_id INTEGER,
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  return db;
}

interface Article {
  id: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  category: string;
  location: string | null;
  published_at: string;
}

// ─── Helper functions (NanoBanana prompt & Bluesky formatting) ─────────

/**
 * Build a NanoBanana-style image prompt for Pollinations.ai.
 * Matches the version in hermes-bridge/telegram-notifier.js.
 */
function buildNanoBananaPrompt(title: string, source: string, category: string): string {
  const headline = title.substring(0, 100).replace(/[*_`[\]()#+-.!]/g, '');
  const sourceName = source.toUpperCase();
  const catEmoji = category === 'urgente' ? '🚨' : category === 'politica' ? '🗳️' :
    category === 'economia' ? '💰' : category === 'deportes' ? '⚽' : '📰';

  return [
    'Professional Argentine news thumbnail, horizontal 16:9 layout.',
    `Headline: "${headline}".`,
    'Style: dramatic Argentine TV news ("Only Fonseca" channel style) — high contrast, cinematic lighting, photorealistic.',
    `Color palette: dark navy blue (#003087) background with gold (#FFD700) accents and text.`,
    `Source badge: ${sourceName} logo in top corner.`,
    'Elements: bold news typography, expressive faces if relevant, dramatic shadows.',
    'Red "ULTIMO MOMENTO" banner element (subtle, professional).',
    'No cartoon, no illustration — photorealistic news broadcast style.',
    'Clean modern composition, professional Argentine journalism aesthetic.'
  ].join(' ');
}

/**
 * Format article text for Bluesky (300 char limit).
 * Matches the version in hermes-bridge/telegram-notifier.js.
 */
function formatBlueskyTweet(title: string, source: string, category: string): string {
  const catEmoji = category === 'urgente' ? '🚨' : category === 'politica' ? '🗳️' :
    category === 'economia' ? '💰' : category === 'deportes' ? '⚽' :
    category === 'policial' ? '🚔' : category === 'sociedad' ? '🌎' : '📰';

  const catTag = category ? ` #${category.charAt(0).toUpperCase() + category.slice(1)}` : '';
  const suffix = `\n\n📌 ${source} | ${catEmoji} | #ArgentinaRadar${catTag}`;
  const suffixLen = suffix.length;

  // Smart truncation: cut at last space before limit
  let headline = title.trim();
  const maxHeadline = 300 - suffixLen;
  if (headline.length > maxHeadline) {
    headline = headline.substring(0, maxHeadline - 3);
    const lastSpace = headline.lastIndexOf(' ');
    if (lastSpace > maxHeadline * 0.7) headline = headline.substring(0, lastSpace);
    headline += '...';
  }

  return `🇦🇷 ${headline}${suffix}`;
}

/**
 * Send a Telegram notification.
 */
async function sendTelegram(message: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: parseInt(TELEGRAM_CHAT_ID, 10),
        text: message,
        parse_mode: 'Markdown',
      }),
    });
  } catch (e) {
    console.warn(`[processing] ⚠️ Telegram notification failed: ${(e as Error).message}`);
  }
}

/**
 * Attempt to auto-publish a high-impact article: generate image, publish to
 * Bluesky, and notify via Telegram.
 */
async function autoPublishArticle(article: Article, aiResult: Record<string, unknown>): Promise<void> {
  const d = getDb();
  const tweetText = formatBlueskyTweet(article.title, article.source, article.category || 'general');
  const queueId = `q_${article.id.slice(0, 12)}`;

  // Generate image via Pollinations
  const nanoPrompt = buildNanoBananaPrompt(article.title, article.source, article.category || 'general');
  const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(nanoPrompt)}?width=1280&height=720&nologo=true&seed=${Math.floor(Math.random() * 1000)}`;

  // Insert into approval_queue as auto-approved
  d.prepare(
    `INSERT OR IGNORE INTO approval_queue (id, article_id, draft_tweet, image_url, image_prompt, status, reviewed_at)
     VALUES (?, ?, ?, ?, ?, 'approved', datetime('now'))`
  ).run(queueId, article.id, tweetText, imageUrl, nanoPrompt);

  // Update article status
  d.prepare('UPDATE news_items SET status = ?, ai_score = ? WHERE id = ?')
    .run('auto_published', JSON.stringify(aiResult), article.id);

  // Publish to Bluesky
  try {
    const pubResp = await fetch(`${TWITTER_PUBLISHER_URL}/api/publish-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ article_id: article.id, text: tweetText, image_url: imageUrl }),
    });
    const pubResult: Record<string, unknown> = await pubResp.json();
    if (pubResult.success) {
      console.log(`  🚀 ${article.id.slice(0, 8)} → AUTO-PUBLISHED`);
    } else {
      console.warn(`  ⚠️ ${article.id.slice(0, 8)} → auto-publish failed: ${pubResult.error}`);
    }
  } catch (e) {
    console.warn(`  ⚠️ ${article.id.slice(0, 8)} → auto-publish network error: ${(e as Error).message}`);
  }

  // Send Telegram notification
  await sendTelegram(`🚨 *Auto-publicado:* ${article.title}\n📰 ${article.source} | Impacto alto`);
}

async function processBatch(): Promise<void> {
  try {
    // 1. Fetch unprocessed ingested articles
    const d = getDb();
    const articles = d.prepare(
      `SELECT * FROM news_items WHERE status = 'ingested' LIMIT 50`
    ).all() as Article[];

    if (articles.length === 0) return;

    console.log(`[processing] Processing ${articles.length} new articles...`);

    for (const article of articles) {
      try {
        // 2. Categorize (if not already set)
        if (!article.category || article.category === 'general') {
          const category = categorizeArticle(article.title, article.summary || '', article.source);
          d.prepare('UPDATE news_items SET category = ? WHERE id = ?').run(category, article.id);
          article.category = category;
          console.log(`  🏷️ ${article.id.slice(0, 8)} → ${category}`);
        }

        // ── Alert check: keyword alerts ──────────────────────────────
        try {
          const matches = alerts.checkAlerts(article);
          const keywordMatches = matches.filter((m: { type: string }) => m.type === 'keyword');
          if (keywordMatches.length > 0) {
            await alerts.sendAlertNotification(keywordMatches, article);
            console.log(`  🔔 ${article.id.slice(0, 8)} → ${keywordMatches.length} keyword alert(s)`);
          }
        } catch (e) {
          console.warn(`  ⚠️ Keyword alert check failed:`, (e as Error).message);
        }

        // 3. Geolocate
        let location = article.location;
        if (!location) {
          try {
            const geoResp = await fetch(`${GEO_API}/api/geolocate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: `${article.title}. ${article.summary || ''}` }),
            });
            if (geoResp.ok) {
              const geoResult = await geoResp.json();
              location = JSON.stringify(geoResult);
              d.prepare('UPDATE news_items SET location = ?, status = ? WHERE id = ?')
                .run(location, 'geolocated', article.id);
              console.log(`  📍 ${article.id.slice(0, 8)} → ${geoResult.province || 'unknown'}`);
            }
          } catch (e) { /* continue without location */ }
        }

        // ── Alert check: province alerts ─────────────────────────────
        try {
          const matches = alerts.checkAlerts(article);
          const provinceMatches = matches.filter((m: { type: string }) => m.type === 'province');
          if (provinceMatches.length > 0) {
            await alerts.sendAlertNotification(provinceMatches, article);
            console.log(`  🔔 ${article.id.slice(0, 8)} → ${provinceMatches.length} province alert(s)`);
          }
        } catch (e) {
          console.warn(`  ⚠️ Province alert check failed:`, (e as Error).message);
        }

        // 4. AI Filter
        try {
          const aiResp = await fetch(`${AI_API}/api/filter`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: article.title,
              summary: article.summary || '',
              source: article.source,
              category: article.category || 'general',
            }),
          });

          if (aiResp.ok) {
            const aiResult = await aiResp.json();
            const verdict = aiResult.verdict; // PUBLISH or DISCARD

            if (verdict === 'PUBLISH') {
              // ── Check for high-impact auto-publish ──────────────
              const scores: Record<string, number> = (aiResult.scores as Record<string, number>) ?? {};
              const combined = (aiResult.combined as number) ?? 0;
              // Normalize combined (0-40) to 0-100 scale
              const impact = Math.round((combined / 40) * 100);
              // Proxy for PUBLISH_URGENT: all individual scores >= 8/10
              const isUrgent =
                (scores.political ?? 0) >= 8 &&
                (scores.economic ?? 0) >= 8 &&
                (scores.social ?? 0) >= 8 &&
                (scores.urgency ?? 0) >= 8;

              if (impact >= AUTO_PUBLISH_THRESHOLD || isUrgent) {
                await autoPublishArticle(article, aiResult as Record<string, unknown>);
                processedCount++;
              } else {
                // Create approval queue entry for manual review
                const draftTweet = `🇦🇷 ${article.title.slice(0, 250)} | 📰 ${article.source} #ArgentinaRadar`;
                const queueId = `q_${article.id.slice(0, 12)}`;

                d.prepare(
                  `INSERT OR IGNORE INTO approval_queue (id, article_id, draft_tweet, status)
                   VALUES (?, ?, ?, 'pending')`
                ).run(queueId, article.id, draftTweet);

                d.prepare('UPDATE news_items SET status = ?, ai_score = ? WHERE id = ?')
                  .run('pending_approval', JSON.stringify(aiResult), article.id);

                console.log(`  ✅ ${article.id.slice(0, 8)} → PUBLISH → pending approval (impact: ${impact})`);
                processedCount++;
              }
            } else {
              d.prepare('UPDATE news_items SET status = ?, ai_score = ? WHERE id = ?')
                .run('discarded', JSON.stringify(aiResult), article.id);
              console.log(`  ❌ ${article.id.slice(0, 8)} → DISCARD`);
            }
          } else {
            // AI not available — set all to pending_approval for manual review
            const draftTweet = `🇦🇷 ${article.title.slice(0, 250)} | 📰 ${article.source} #ArgentinaRadar`;
            const queueId = `q_${article.id.slice(0, 12)}`;
            
            d.prepare(
              `INSERT OR IGNORE INTO approval_queue (id, article_id, draft_tweet, status)
               VALUES (?, ?, ?, 'pending')`
            ).run(queueId, article.id, draftTweet);

            d.prepare('UPDATE news_items SET status = ? WHERE id = ?')
              .run('pending_approval', article.id);
            
            console.log(`  ⚠️ ${article.id.slice(0, 8)} → AI unavailable → pending approval`);
            processedCount++;
          }
        } catch (e) {
          console.warn(`[processing] AI error for ${article.id.slice(0, 8)}:`, (e as Error).message);
        }
      } catch (e) {
        console.error(`[processing] Error processing ${article.id.slice(0, 8)}:`, e);
      }
    }

    if (processedCount > 0) {
      console.log(`[processing] Total processed: ${processedCount} articles`);
    }
  } catch (e) {
    console.error('[processing] Batch error:', e);
  }
}

// Use plain setInterval since createLoop might not be available
let interval: ReturnType<typeof setInterval> | null = null;

export function startProcessingLoop(): void {
  console.log(`[processing] Starting processing loop (every ${POLL_INTERVAL / 1000}s)`);
  console.log(`[processing] Geo API: ${GEO_API}`);
  console.log(`[processing] AI API: ${AI_API}`);
  
  processBatch(); // Run immediately
  interval = setInterval(processBatch, POLL_INTERVAL);
}

export function stopProcessingLoop(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
  if (db) {
    db.close();
    db = null;
  }
  console.log('[processing] Stopped');
}

// Run if called directly
startProcessingLoop();
