/**
 * ArgentinaRadar — Pipeline Processor
 *
 * Bridges the gap between geolocation and event detection by:
 *   1. Reads articles from the shared DB that need AI enrichment
 *      (status='geolocated' OR (status='ingested' AND location IS NOT NULL))
 *   2. Calls the ai-processor (/api/process) for NER + embedding
 *   3. Stores entities + embedding back in the DB
 *   4. Pushes to the event-detector (/api/detect) for event clustering
 *   5. Updates status to 'filtered' for articles with publish=true
 *
 * Designed to be run as a standalone background loop so the pipeline
 * works even when the full ai-filter service isn't available.
 *
 * Usage:
 *   npx tsx services/news-ingestion/src/processPipeline.ts
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Config ──────────────────────────────────────────────────────────
const DB_PATH = process.env.DB_PATH ?? path.resolve(__dirname, '..', '..', '..', 'data', 'argentina-radar.db');
const AI_PROCESSOR_URL = process.env.AI_PROCESSOR_URL ?? 'http://localhost:3013';
const EVENT_DETECTOR_URL = process.env.EVENT_DETECTOR_URL ?? 'http://localhost:3008';
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL ?? '60000', 10); // 1 min

// ─── DB helpers ──────────────────────────────────────────────────────

function getDb(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  return db;
}

// ─── AI Processor client ─────────────────────────────────────────────

interface AiProcessResult {
  entities: Array<{ name: string; type: string; tier: string }>;
  category: string;
  embedding: number[];
  tokens_used: number;
  cost: number;
}

async function callAiProcess(title: string, summary: string, source: string): Promise<AiProcessResult | null> {
  try {
    const resp = await fetch(`${AI_PROCESSOR_URL}/api/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, summary, source }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) {
      console.warn(`[processPipeline] ai-processor returned ${resp.status} for "${title.slice(0, 40)}…"`);
      return null;
    }
    return await resp.json() as AiProcessResult;
  } catch (err) {
    console.warn(`[processPipeline] ai-processor unreachable:`, (err as Error).message);
    return null;
  }
}

// ─── Event-detector push ─────────────────────────────────────────────

interface DetectPayload {
  article_id: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  publishedAt: string;
  category?: string;
  embedding?: number[];
  entities?: Array<{ name: string; type: string; tier: string }>;
}

async function pushToEventDetector(payload: DetectPayload): Promise<string | null> {
  try {
    const resp = await fetch(`${EVENT_DETECTOR_URL}/api/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      console.warn(`[processPipeline] event-detector returned ${resp.status} for ${payload.article_id.slice(0, 8)}…`);
      return null;
    }
    const result = await resp.json() as { eventId?: string; event?: { id?: string } };
    return result.eventId ?? result.event?.id ?? null;
  } catch (err) {
    console.warn(`[processPipeline] event-detector unreachable:`, (err as Error).message);
    return null;
  }
}

// ─── Main processing loop ────────────────────────────────────────────

interface ArticleRow {
  id: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  category: string;
  published_at: string;
  location: string | null;
  ai_score: string | null;
}

async function processNextBatch(): Promise<number> {
  const db = getDb();
  try {
    // Find articles that need AI processing:
    // - status='geolocated' (geolocated but not yet AI-enriched)
    // - status='ingested' AND location IS NOT NULL (had location from seed)
    // Exclude articles that already have embeddings
    const rows = db.prepare(`
      SELECT id, title, summary, source, url, category, published_at, location, ai_score
      FROM news_items
      WHERE (status = 'geolocated' OR (status = 'ingested' AND location IS NOT NULL))
        AND (embedding IS NULL OR embedding = '')
      ORDER BY published_at ASC
      LIMIT 10
    `).all() as ArticleRow[];

    if (rows.length === 0) return 0;

    console.log(`[processPipeline] Processing ${rows.length} article(s)…`);

    const updateStmt = db.prepare(`
      UPDATE news_items
      SET embedding = ?, entities = ?, ai_category = ?, status = ?
      WHERE id = ?
    `);

    let processed = 0;

    for (const row of rows) {
      // 1. Parse existing ai_score to determine if it's a PUBLISH candidate
      let shouldPublish = false;
      if (row.ai_score) {
        try {
          const score = JSON.parse(row.ai_score);
          shouldPublish = score.publish === true;
        } catch { /* ignore malformed */ }
      }

      // 2. Call ai-processor for NER + embedding
      console.log(`  → AI processing: "${row.title.slice(0, 50)}…"`);
      const aiResult = await callAiProcess(row.title, row.summary || '', row.source);

      if (aiResult) {
        // 3. Store embedding + entities in DB
        const newStatus = shouldPublish ? 'filtered' : 'geolocated';
        updateStmt.run(
          JSON.stringify(aiResult.embedding),
          JSON.stringify(aiResult.entities),
          aiResult.category,
          newStatus,
          row.id,
        );
        console.log(`  ✓ Stored embedding (${aiResult.embedding.length} dims) + ${aiResult.entities.length} entities → status=${newStatus}`);

        // 4. Push to event-detector (only for publishable articles)
        if (shouldPublish) {
          const eventId = await pushToEventDetector({
            article_id: row.id,
            title: row.title,
            summary: row.summary || '',
            source: row.source,
            url: row.url,
            publishedAt: row.published_at,
            category: aiResult.category,
            embedding: aiResult.embedding,
            entities: aiResult.entities,
          });
          if (eventId) {
            console.log(`  → Event: ${eventId.slice(0, 8)}…`);
          }
        }
      } else {
        // ai-processor unavailable — still publish if ai_score says so,
        // event-detector's ensureEmbedding() will generate on demand
        console.log(`  ⚠ No AI result, pushing raw article to event-detector`);
        if (shouldPublish) {
          const eventId = await pushToEventDetector({
            article_id: row.id,
            title: row.title,
            summary: row.summary || '',
            source: row.source,
            url: row.url,
            publishedAt: row.published_at,
          });
          if (eventId) {
            console.log(`  → Event: ${eventId.slice(0, 8)}…`);
          }
          // Mark as filtered so fallback loops pick it up
          db.prepare('UPDATE news_items SET status = ? WHERE id = ?').run('filtered', row.id);
        }
      }

      processed++;
    }

    return processed;
  } finally {
    db.close();
  }
}

// ─── Background loop ─────────────────────────────────────────────────

async function mainLoop(): Promise<void> {
  console.log('[processPipeline] Starting background pipeline processor');
  console.log(`[processPipeline] AI Processor: ${AI_PROCESSOR_URL}`);
  console.log(`[processPipeline] Event Detector: ${EVENT_DETECTOR_URL}`);
  console.log(`[processPipeline] Poll interval: ${POLL_INTERVAL_MS}ms\n`);

  // Immediate first run
  await processNextBatch();

  // Then poll on interval
  setInterval(async () => {
    try {
      const count = await processNextBatch();
      if (count > 0) {
        console.log(`[processPipeline] Processed ${count} article(s)\n`);
      }
    } catch (err) {
      console.error('[processPipeline] Error:', err);
    }
  }, POLL_INTERVAL_MS);
}

// ─── Entry point ─────────────────────────────────────────────────────

mainLoop().catch((err) => {
  console.error('[processPipeline] Fatal:', err);
  process.exit(1);
});
