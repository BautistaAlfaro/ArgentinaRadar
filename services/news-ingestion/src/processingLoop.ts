/**
 * Processing Loop — permanent pipeline for processing ingested articles.
 *
 * Runs continuously, polling for new articles and pushing them through:
 *   0. Language detection + Auto-translation → detects non-Spanish articles, translates them
 *   1. Categorization → assigns category
 *   2. Quality scoring + engagement prediction → scores and auto-discards low quality
 *   3. Keyword alert check → notifies users on keyword matches
 *   4. Geolocation → adds location data
 *   5. Province alert check → notifies users on location matches
 *   6. AI Filter → classifies PUBLISH/DISCARD (Ollama or OpenAI/OpenRouter)
 *   6b. Embedding generation → stores vector embedding for semantic search (Ollama mode)
 *   7. Approval Queue → creates entries for Telegram approval / auto-publish
 *   8. Periodic Clustering → groups similar articles every 30 minutes
 *
 * Uses createLoop() for graceful shutdown handling.
 *
 * AI modes:
 *   - AI_PROVIDER=ollama: calls /api/ollama-classify directly + generates embeddings
 *   - AI_PROVIDER=openai|openrouter: calls /api/filter via ai-processor (existing behavior)
 */

import Database from 'better-sqlite3';
import path from 'path';
import { createRequire } from 'module';
import { categorizeArticle } from '../../../shared/categorizer';
import { scoreArticleQuality } from '../../../shared/qualityScorer';
import { predictEngagement } from '../../../shared/engagementPredictor';
import { clusterArticles } from '../../../shared/clustering.js';
import type { NewsItem } from '../../../shared/types/index.js';
import { detectLanguage } from '../../../shared/language';

// Import the alerts module (CommonJS → ESM bridge)
const cRequire = createRequire(import.meta.url);
const alerts = cRequire('../../hermes-bridge/alerts.js');
const { createLogger } = cRequire('../../../shared/logger.js');
const { increment } = cRequire('../../../shared/metrics.js');

const logger = createLogger('processing-loop');

const DB_PATH = process.env.DB_PATH ?? path.resolve(process.cwd(), '..', '..', 'data', 'argentina-radar.db');
const GEO_API = process.env.GEO_API ?? 'http://127.0.0.1:3002';
const AI_API = process.env.AI_API ?? 'http://127.0.0.1:3013';
const AI_PROVIDER = process.env.AI_PROVIDER ?? 'openai'; // ollama | openai | openrouter
const POLL_INTERVAL = parseInt(process.env.PROCESS_INTERVAL ?? '30000', 10); // 30 seconds

// ─── Translation Settings ──────────────────────────────────────────────
const AUTO_TRANSLATE = process.env.AUTO_TRANSLATE === 'true';
const TRANSLATION_PROVIDER = process.env.TRANSLATION_PROVIDER ?? 'google';

// ─── AI Summarizer ─────────────────────────────────────────────────────
const AUTO_SUMMARIZE = process.env.AUTO_SUMMARIZE === 'true';

// ─── Periodic Clustering ────────────────────────────────────────────────
const CLUSTER_INTERVAL = parseInt(process.env.CLUSTER_INTERVAL ?? '1800000', 10); // 30 min
const CLUSTER_WINDOW = parseInt(process.env.CLUSTER_WINDOW ?? '2', 10); // hours to look back

// ─── High-Impact Auto-Publish ──────────────────────────────────────────
const AUTO_PUBLISH_THRESHOLD = parseInt(process.env.AUTO_PUBLISH_THRESHOLD ?? '80', 10);
const MIN_QUALITY_THRESHOLD = parseInt(process.env.MIN_QUALITY_THRESHOLD ?? '40', 10);
const MIN_ENGAGEMENT_PREDICTION = parseInt(process.env.MIN_ENGAGEMENT_PREDICTION ?? '30', 10);
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
  sources?: string; // JSON array of dedup source names
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
      signal: AbortSignal.timeout(10_000),
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
      signal: AbortSignal.timeout(15_000),
    });
    const pubResult: Record<string, unknown> = await pubResp.json();
    if (pubResult.success) {
      logger.info('AUTO-PUBLISHED', { articleId: article.id.slice(0, 8) });
    } else {
      logger.warn('Auto-publish failed', { articleId: article.id.slice(0, 8), error: pubResult.error });
    }
  } catch (e) {
    logger.warn('Auto-publish network error', { articleId: article.id.slice(0, 8), error: (e as Error).message });
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

    logger.info('Processing articles', { count: articles.length });
    increment('articles_ingested', articles.length);

    for (const article of articles) {
      try {
        // ── Validate required fields before processing ──────────────
        if (!article.id || !article.title || !article.source) {
          logger.warn('Artículo omitido por datos incompletos', { id: article.id?.slice(0, 8) || 'sin ID', title: !!article.title, source: !!article.source });
          if (article.id) {
            d.prepare("UPDATE news_items SET status = ? WHERE id = ?").run('validation_failed', article.id);
          }
          continue;
        }

        // ── Step 0: Language detection + Auto-translation ──────────
        if (AUTO_TRANSLATE) {
          const combinedText = `${article.title} ${article.summary || ''}`;
          const detectedLang = detectLanguage(combinedText);

          if (detectedLang !== 'es' && detectedLang !== 'other') {
            logger.info('Language detected, translating', { articleId: article.id.slice(0, 8), lang: detectedLang });

            const originalTitle = article.title;
            const originalSummary = article.summary || '';

            try {
              // Translate title
              const titleResp = await fetch(`${AI_API}/api/translate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  text: article.title,
                  source: detectedLang,
                  provider: TRANSLATION_PROVIDER,
                }),
                signal: AbortSignal.timeout(10_000),
              });

              if (titleResp.ok) {
                const titleResult = await titleResp.json();
                const translatedTitle = titleResult.translated_text;

                // Translate summary if present
                let translatedSummary = article.summary || '';
                  if (article.summary) {
                    const summaryResp = await fetch(`${AI_API}/api/translate`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        text: article.summary,
                        source: detectedLang,
                        provider: TRANSLATION_PROVIDER,
                      }),
                      signal: AbortSignal.timeout(10_000),
                    });
                  if (summaryResp.ok) {
                    const summaryResult = await summaryResp.json();
                    translatedSummary = summaryResult.translated_text;
                  }
                }

                // Store originals and update with translations in DB
                d.prepare(`
                  UPDATE news_items
                  SET title_en = ?, summary_en = ?,
                      title = ?, summary = ?,
                      translated = 1, detected_language = ?
                  WHERE id = ?
                `).run(
                  originalTitle,
                  originalSummary,
                  translatedTitle,
                  translatedSummary,
                  detectedLang,
                  article.id,
                );

                // Update in-memory article for downstream steps
                article.title = translatedTitle;
                article.summary = translatedSummary;

                logger.info('Translated article', { articleId: article.id.slice(0, 8), from: originalTitle.slice(0, 40) });
              } else {
                logger.warn('Error de API de traducción', { articleId: article.id.slice(0, 8), status: titleResp.status });
              }
            } catch (e) {
              logger.warn('Traducción fallida', { articleId: article.id.slice(0, 8), error: (e as Error).message });
            }
          }
        }

        // 1. Categorize (if not already set)
        if (!article.category || article.category === 'general') {
          const category = categorizeArticle(article.title, article.summary || '', article.source);
          d.prepare('UPDATE news_items SET category = ? WHERE id = ?').run(category, article.id);
          article.category = category;
          logger.info('Categorized article', { articleId: article.id.slice(0, 8), category });
        }

        // ── 1b. Quality scoring + engagement prediction ──────────────
        try {
          const quality = scoreArticleQuality(article.title, article.summary || '', article.source);

          // Parse sources JSON safely
          let sourcesList: string[] | undefined;
          try {
            sourcesList = article.sources ? JSON.parse(article.sources) : undefined;
          } catch {
            // ignore parse errors
          }

          const engagement = predictEngagement({
            title: article.title,
            category: article.category || 'general',
            source: article.source,
            sources: sourcesList,
            publishedAt: article.published_at,
          });

          d.prepare(
            `UPDATE news_items SET quality_score = ?, engagement_score = ? WHERE id = ?`
          ).run(quality, engagement, article.id);

          // Auto-discard low-quality articles early
          if (quality < MIN_QUALITY_THRESHOLD) {
            d.prepare("UPDATE news_items SET status = ? WHERE id = ?")
              .run('discarded', article.id);
            logger.warn('Artículo descartado por baja calidad', { articleId: article.id.slice(0, 8), quality, threshold: MIN_QUALITY_THRESHOLD });
            continue; // skip remaining processing for this article
          }

          logger.info('Quality scored', { articleId: article.id.slice(0, 8), quality, engagement });
        } catch (e) {
          logger.warn('Error al puntuar calidad', { articleId: article.id.slice(0, 8), error: (e as Error).message });
        }

        // ── Alert check: keyword alerts ──────────────────────────────
        try {
          const matches = alerts.checkAlerts(article);
          const keywordMatches = matches.filter((m: { type: string }) => m.type === 'keyword');
          if (keywordMatches.length > 0) {
            await alerts.sendAlertNotification(keywordMatches, article);
            logger.info('Keyword alerts matched', { articleId: article.id.slice(0, 8), count: keywordMatches.length });
          }
        } catch (e) {
          logger.warn('Error al verificar alertas de palabras clave', { articleId: article.id.slice(0, 8), error: (e as Error).message });
        }

        // 3. Geolocate
        let location = article.location;
        if (!location) {
          try {
            const geoResp = await fetch(`${GEO_API}/api/geolocate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: `${article.title}. ${article.summary || ''}` }),
              signal: AbortSignal.timeout(10_000),
            });
            if (geoResp.ok) {
              const geoResult = await geoResp.json();
              location = JSON.stringify(geoResult);
              d.prepare('UPDATE news_items SET location = ?, status = ? WHERE id = ?')
                .run(location, 'geolocated', article.id);
              logger.info('Geolocated article', { articleId: article.id.slice(0, 8), province: geoResult.province || 'unknown' });
            }
          } catch (e) { /* continue without location */ }
        }

        // ── Alert check: province alerts ─────────────────────────────
        try {
          const matches = alerts.checkAlerts(article);
          const provinceMatches = matches.filter((m: { type: string }) => m.type === 'province');
          if (provinceMatches.length > 0) {
            await alerts.sendAlertNotification(provinceMatches, article);
            logger.info('Province alerts matched', { articleId: article.id.slice(0, 8), count: provinceMatches.length });
          }
        } catch (e) {
          logger.warn('Error al verificar alertas de provincia', { articleId: article.id.slice(0, 8), error: (e as Error).message });
        }

        // 4. AI Filter — supports both direct Ollama and OpenAI/OpenRouter
        try {
          let aiResult: Record<string, unknown> = {};
          let aiSuccess = false;

          if (AI_PROVIDER === 'ollama') {
            increment('api_calls_ollama');
            // ── Direct Ollama classification ──────────────────────────
            const resp = await fetch(`${AI_API}/api/ollama-classify`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                title: article.title,
                summary: article.summary || '',
                source: article.source,
              }),
              signal: AbortSignal.timeout(15_000),
            });
            if (resp.ok) {
              const data = await resp.json() as Record<string, unknown>;
              // Normalise to match the /api/filter response shape
              aiResult = {
                verdict: data.verdict,
                scores: {
                  political: data.political ?? 0,
                  economic: data.economic ?? 0,
                  social: data.social ?? 0,
                  urgency: data.urgency ?? 0,
                  quality: data.quality ?? 0,
                  relevance: data.relevance ?? 0,
                },
                combined: data.combined ?? 0,
                reason: data.reason ?? '',
              };
              aiSuccess = true;
            }
          } else {
            // ── Standard OpenAI / OpenRouter filter ─────────────────
            const resp = await fetch(`${AI_API}/api/filter`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                title: article.title,
                summary: article.summary || '',
                source: article.source,
                category: article.category || 'general',
              }),
              signal: AbortSignal.timeout(15_000),
            });
            if (resp.ok) {
              aiResult = await resp.json() as Record<string, unknown>;
              aiSuccess = true;
            }
          }

          if (aiSuccess) {
            const verdict = aiResult.verdict as string; // PUBLISH or DISCARD
            const scores: Record<string, number> = (aiResult.scores as Record<string, number>) ?? {};
            const relevanceScore = scores.relevance ?? 0;
            const combined = (aiResult.combined as number) ?? 0;

            // Save relevance_score to DB
            if (relevanceScore > 0) {
              d.prepare('UPDATE news_items SET relevance_score = ? WHERE id = ?')
                .run(relevanceScore, article.id);
            }

            // ── 4b. Generate embedding (Ollama mode only) ──────────
            if (AI_PROVIDER === 'ollama') {
              try {
                const embedText = `${article.title} ${article.summary || ''}`.trim();
                if (embedText.length > 0) {
                  const embedResp = await fetch(`${AI_API}/api/embeddings`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: embedText }),
                    signal: AbortSignal.timeout(10_000),
                  });
                  if (embedResp.ok) {
                    const embedData = await embedResp.json() as { embedding: number[] };
                    d.prepare('UPDATE news_items SET embedding = ? WHERE id = ?')
                      .run(JSON.stringify(embedData.embedding), article.id);
                    logger.info('Embedding generated', { articleId: article.id.slice(0, 8), dimensions: embedData.embedding.length });
                  }
                }
              } catch (e) {
                logger.warn('Embedding generation failed', { articleId: article.id.slice(0, 8), error: (e as Error).message });
              }
            }

            if (verdict === 'PUBLISH') {
              // ── AI Summarizer (optional) ─────────────────────────
              let aiSummary: string | null = null;
              if (AUTO_SUMMARIZE) {
                try {
                  const smrResp = await fetch(`${AI_API}/api/summarize`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      title: article.title,
                      summary: article.summary || '',
                      max_chars: 200,
                    }),
                    signal: AbortSignal.timeout(15000),
                  });
                  if (smrResp.ok) {
                    const smrResult = await smrResp.json();
                    aiSummary = smrResult.generated_summary || null;
                    if (aiSummary) {
                      d.prepare('UPDATE news_items SET ai_summary = ? WHERE id = ?')
                        .run(aiSummary, article.id);
                      logger.info('AI summary generated', { articleId: article.id.slice(0, 8) });
                    }
                  }
                } catch (e) {
                  logger.warn('AI summarize failed', { articleId: article.id.slice(0, 8), error: (e as Error).message });
                }
              }

              // ── Check for high-impact auto-publish ──────────────
              const impact = Math.round((combined / 10) * 100);
              const isUrgent =
                (scores.political ?? 0) >= 8 &&
                (scores.economic ?? 0) >= 8 &&
                (scores.social ?? 0) >= 8 &&
                (scores.urgency ?? 0) >= 8;

              if (impact >= AUTO_PUBLISH_THRESHOLD || isUrgent) {
                await autoPublishArticle(article, aiResult);
                processedCount++;
              } else {
                const draftTweet = `🇦🇷 ${article.title.slice(0, 250)} | 📰 ${article.source} #ArgentinaRadar`;
                const queueId = `q_${article.id.slice(0, 12)}`;

                d.prepare(
                  `INSERT OR IGNORE INTO approval_queue (id, article_id, draft_tweet, status)
                   VALUES (?, ?, ?, 'pending')`
                ).run(queueId, article.id, draftTweet);

                d.prepare('UPDATE news_items SET status = ?, ai_score = ? WHERE id = ?')
                  .run('pending_approval', JSON.stringify(aiResult), article.id);

                logger.info('Article pending approval', { articleId: article.id.slice(0, 8), impact });
                processedCount++;
              }
            } else {
              d.prepare('UPDATE news_items SET status = ?, ai_score = ? WHERE id = ?')
                .run('discarded', JSON.stringify(aiResult), article.id);
              logger.info('Article discarded by AI', { articleId: article.id.slice(0, 8) });
              increment('articles_rejected');
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

            logger.warn('AI unavailable — article pending approval', { articleId: article.id.slice(0, 8) });
            processedCount++;
          }
        } catch (e) {
          logger.error('AI filter error', { articleId: article.id.slice(0, 8), error: (e as Error).message });
          increment('errors');
        }
      } catch (e) {
        logger.error('Error processing article', { articleId: article.id.slice(0, 8), error: String(e) });
        increment('errors');
      }
    }

    if (processedCount > 0) {
      logger.info('Batch complete', { processedCount });
    }
  } catch (e) {
    logger.error('Batch processing error', { error: (e as Error).message });
    increment('errors');
  }
}

// ─── Periodic Clustering Runner ─────────────────────────────────────────

/**
 * Run clustering on recent articles and store results in article_clusters table.
 * Groups articles from the last CLUSTER_WINDOW hours, then persists clusters
 * and marks cluster_id on each news_item that belongs to a cluster.
 */
async function runClustering(): Promise<void> {
  try {
    const d = getDb();

    // Ensure table exists
    d.exec(`
      CREATE TABLE IF NOT EXISTS article_clusters (
        id           TEXT PRIMARY KEY,
        topic        TEXT NOT NULL,
        article_ids  TEXT NOT NULL,
        source_count INTEGER DEFAULT 0,
        created_at   TEXT DEFAULT (datetime('now'))
      )
    `);

    // Add cluster_id column if not present
    try {
      d.exec(`ALTER TABLE news_items ADD COLUMN cluster_id TEXT`);
    } catch {
      // Already exists
    }

    // Fetch recent articles
    const rows = d.prepare(
      `SELECT * FROM news_items
       WHERE ingested_at >= datetime('now', ?)
       ORDER BY published_at DESC`
    ).all(`-${CLUSTER_WINDOW} hours`) as Array<Record<string, unknown>>;

    if (rows.length < 2) {
      logger.info('Skipping clustering — insufficient articles', { count: rows.length });
      return;
    }

    // Convert rows to NewsItem-like objects
    const articles: NewsItem[] = rows.map((row) => ({
      id: row.id as string,
      title: row.title as string,
      summary: (row.summary as string) || '',
      source: row.source as string,
      sources: row.sources ? JSON.parse(row.sources as string) : [row.source],
      url: row.url as string,
      category: (row.category as string) as NewsItem['category'],
      publishedAt: (row.published_at as string) || (row.ingested_at as string),
      ingestedAt: row.ingested_at as string,
      location: row.location ? JSON.parse(row.location as string) : null,
      aiScore: row.ai_score ? JSON.parse(row.ai_score as string) : null,
      tweetId: (row.tweet_id as string) || null,
      status: row.status as NewsItem['status'],
    }));

    const clusters = clusterArticles(articles, 0.3);
    const multiSource = clusters.filter((c) => c.articleCount > 1);

    if (multiSource.length === 0) {
      logger.info('No multi-source clusters found', { hours: CLUSTER_WINDOW });
      return;
    }

    // Clear old clusters for this window to avoid duplicates
    const clearBefore = new Date();
    clearBefore.setHours(clearBefore.getHours() - CLUSTER_WINDOW);
    d.prepare('DELETE FROM article_clusters WHERE created_at >= ?').run(clearBefore.toISOString());

    // Clear old cluster_id markings
    d.prepare('UPDATE news_items SET cluster_id = NULL WHERE cluster_id IS NOT NULL');
    // Focus on the window
    d.prepare(
      `UPDATE news_items SET cluster_id = NULL
       WHERE ingested_at >= datetime('now', ?)`
    ).run(`-${CLUSTER_WINDOW} hours`);

    // Insert clusters and mark articles
    const insertCluster = d.prepare(
      `INSERT OR REPLACE INTO article_clusters (id, topic, article_ids, source_count, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    );

    const updateArticle = d.prepare(
      'UPDATE news_items SET cluster_id = ? WHERE id = ?'
    );

    const insertAll = d.transaction((cls: Array<{
      clusterId: string; mainTopic: string; articleIds: string[]; sourceCount: number;
    }>) => {
      for (const cluster of cls) {
        insertCluster.run(
          cluster.clusterId,
          cluster.mainTopic,
          JSON.stringify(cluster.articleIds),
          cluster.sourceCount,
        );
        for (const articleId of cluster.articleIds) {
          updateArticle.run(cluster.clusterId, articleId);
        }
      }
    });

    insertAll(multiSource);

    logger.info('Clustering complete', { clusters: multiSource.length, articles: rows.length, hours: CLUSTER_WINDOW });
  } catch (e) {
    logger.error('Clustering error', { error: (e as Error).message });
    increment('errors');
  }
}

// Use plain setInterval since createLoop might not be available
let interval: ReturnType<typeof setInterval> | null = null;

let clusteringInterval: ReturnType<typeof setInterval> | null = null;

export function startProcessingLoop(): void {
  logger.info('Starting processing loop', {
    interval: `${POLL_INTERVAL / 1000}s`,
    geoApi: GEO_API,
    aiApi: AI_API,
    aiProvider: AI_PROVIDER,
    clusteringInterval: `${Math.round(CLUSTER_INTERVAL / 1000)}s`,
    clusteringWindow: `${CLUSTER_WINDOW}h`,
  });
  
  processBatch(); // Run immediately
  interval = setInterval(processBatch, POLL_INTERVAL);

  // Start periodic clustering
  runClustering(); // Run immediately
  clusteringInterval = setInterval(runClustering, CLUSTER_INTERVAL);
}

export function stopProcessingLoop(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
  if (clusteringInterval) {
    clearInterval(clusteringInterval);
    clusteringInterval = null;
  }
  if (db) {
    db.close();
    db = null;
  }
  logger.info('Processing loop stopped');
}

// Run if called directly
startProcessingLoop();
