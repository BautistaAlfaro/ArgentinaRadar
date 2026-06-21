/**
 * Processing Loop — permanent pipeline for processing ingested articles.
 *
 * Runs continuously, polling for new articles and pushing them through:
 *   1. Geolocation → adds location data
 *   2. AI Filter → classifies PUBLISH/DISCARD
 *   3. Approval Queue → creates entries for Telegram approval
 *
 * Uses createLoop() for graceful shutdown handling.
 */

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DB_PATH ?? path.resolve(process.cwd(), '..', '..', 'data', 'argentina-radar.db');
const GEO_API = process.env.GEO_API ?? 'http://127.0.0.1:3002';
const AI_API = process.env.AI_API ?? 'http://127.0.0.1:3013';
const POLL_INTERVAL = parseInt(process.env.PROCESS_INTERVAL ?? '30000', 10); // 30 seconds

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
        // 2. Geolocate
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

        // 3. AI Filter
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
              // Create approval queue entry
              const draftTweet = `🇦🇷 ${article.title.slice(0, 250)} | 📰 ${article.source} #ArgentinaRadar`;
              const queueId = `q_${article.id.slice(0, 12)}`;

              d.prepare(
                `INSERT OR IGNORE INTO approval_queue (id, article_id, draft_tweet, status)
                 VALUES (?, ?, ?, 'pending')`
              ).run(queueId, article.id, draftTweet);

              d.prepare('UPDATE news_items SET status = ?, ai_score = ? WHERE id = ?')
                .run('pending_approval', JSON.stringify(aiResult), article.id);

              console.log(`  ✅ ${article.id.slice(0, 8)} → PUBLISH → pending approval`);
              processedCount++;
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
