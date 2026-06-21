/**
 * Night Owl — Backfill Processor
 *
 * Scheduled: 01:00 ART
 *
 * Re-processes articles that didn't get AI processing (no embedding).
 * For each unprocessed article (max 200 per run):
 *   1. Call ai-processor  POST /api/process  → embedding + NER + category
 *   2. Call geolocation   POST /api/geolocate → location extraction
 *   3. Update the SQLite row directly (embedding, entities, category, location)
 *   4. Log progress every 50 articles
 *
 * One failed article does NOT stop the batch — errors are logged and the
 * next article is attempted.
 *
 * Dependencies:
 *   - better-sqlite3 (shared via workspace, used by geolocation)
 *   - Built-in fetch (Node 18+)
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import type { JobFn } from './index.js';
import { BudgetTracker } from './budget.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Service URLs (configurable via env) ──────────────────────────────

const NEWS_SERVICE_URL = process.env.NEWS_SERVICE_URL ?? 'http://localhost:3001';
const AI_PROCESSOR_URL  = process.env.AI_PROCESSOR_URL  ?? 'http://localhost:3010';
const GEOLOCATION_URL   = process.env.GEOLOCATION_URL   ?? 'http://localhost:3002';

// Shared SQLite database — same one used by news-ingestion + geolocation
const DB_PATH =
  process.env.DB_PATH ??
  path.resolve(__dirname, '..', '..', '..', '..', 'data', 'argentina-radar.db');

// ── Job implementation ──────────────────────────────────────────────

export const runBackfill: JobFn = async (_data) => {
  const budget = new BudgetTracker();
  const startedAt = Date.now();

  console.log('═══════════════════════════════════════');
  console.log('[Job:backfill] Starting backfill processor');
  console.log('═══════════════════════════════════════');

  // ── 1. Fetch articles with status = 'ingested' ──────────────────
  let articles: Array<Record<string, unknown>>;
  try {
    const resp = await fetch(
      `${NEWS_SERVICE_URL}/api/news?status=ingested&limit=200`,
    );
    if (!resp.ok) {
      throw new Error(`News service returned ${resp.status} ${resp.statusText}`);
    }
    const body = (await resp.json()) as { items: Array<Record<string, unknown>> };
    articles = body.items ?? [];
    console.log(`[Job:backfill] Fetched ${articles.length} ingested articles`);
  } catch (err) {
    console.error('[Job:backfill] Failed to fetch articles from news-ingestion:', (err as Error).message);
    return;
  }

  // Filter to articles that genuinely lack an embedding
  const unprocessed = articles.filter((a) => !a.embedding);
  console.log(
    `[Job:backfill] ${unprocessed.length}/${articles.length} articles lack embeddings`,
  );

  if (unprocessed.length === 0) {
    console.log('[Job:backfill] Nothing to backfill. Done.');
    return;
  }

  // ── 2. Open shared SQLite for direct writes ──────────────────────
  let db: Database.Database;
  try {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
  } catch (err) {
    console.error(`[Job:backfill] Failed to open SQLite at ${DB_PATH}:`, (err as Error).message);
    return;
  }

  // Prepared statement — only updates rows that are still 'ingested'
  // (avoids races with the real-time pipeline)
  const updateStmt = db.prepare(`
    UPDATE news_items
    SET embedding = ?,
        entities  = ?,
        ai_category = ?,
        location  = ?,
        status    = 'published'
    WHERE id = ? AND status = 'ingested'
  `);

  // ── 3. Process each article ──────────────────────────────────────
  let processed = 0;
  let failed = 0;
  let skipped = 0;

  for (const article of unprocessed) {
    const articleId = String(article.id);

    // Check budget before spending on AI
    if (!budget.check()) {
      console.log('[Job:backfill] Budget exhausted — stopping early');
      break;
    }

    try {
      // ── Step A: AI processing (embedding + NER + category) ──────
      const aiResp = await fetch(`${AI_PROCESSOR_URL}/api/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: article.title ?? '',
          summary: article.summary ?? '',
          source: article.source ?? '',
        }),
      });

      if (!aiResp.ok) {
        const errBody: Record<string, unknown> =
          (await aiResp.json().catch(() => ({}))) as Record<string, unknown>;
        const detail = errBody.detail as Record<string, unknown> | undefined;

        // If the AI processor itself reports budget exceeded, stop the batch
        if (detail?.error === 'budget_exceeded') {
          console.warn('[Job:backfill] AI processor budget exceeded — stopping batch');
          break;
        }
        throw new Error(`AI processor returned ${aiResp.status}: ${JSON.stringify(errBody)}`);
      }

      interface AiProcessResult {
        embedding: number[];
        entities: Array<Record<string, unknown>>;
        category: string;
        tokens_used: number;
        cost: number;
      }
      const aiResult = (await aiResp.json()) as AiProcessResult;

      // Track AI cost through our budget
      budget.record(aiResult.cost ?? 0, aiResult.tokens_used ?? 0);

      // ── Step B: Geolocation ──────────────────────────────────────
      const text = [article.title ?? '', article.summary ?? '']
        .filter(Boolean)
        .join('. ')
        .trim() || '';

      let location: Record<string, unknown> | null = null;
      try {
        const geoResp = await fetch(`${GEOLOCATION_URL}/api/geolocate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (geoResp.ok) {
          location = (await geoResp.json()) as Record<string, unknown>;
        } else {
          console.warn(`  ~ Geolocation returned ${geoResp.status} for article ${articleId}`);
        }
      } catch (geoErr) {
        // Geolocation failure is non-fatal — proceed without location
        console.warn(`  ~ Geolocation error for article ${articleId}:`, (geoErr as Error).message);
      }

      // ── Step C: Update SQLite ────────────────────────────────────
      const info = updateStmt.run(
        JSON.stringify(aiResult.embedding),
        JSON.stringify(aiResult.entities),
        aiResult.category,
        location ? JSON.stringify(location) : null,
        articleId,
      );

      if (info.changes > 0) {
        processed++;
      } else {
        // Row was already updated by another process (real-time pipeline)
        skipped++;
      }

      // ── Step D: Progress log every 50 articles ───────────────────
      if (processed > 0 && processed % 50 === 0) {
        console.log(
          `[Job:backfill] Progress: ${processed} processed, ${failed} failed, ${skipped} skipped`,
        );
      }
    } catch (err) {
      failed++;
      console.error(`[Job:backfill] Failed article ${articleId}:`, (err as Error).message);
      // One failure does NOT stop the batch — continue with next article
    }
  }

  db.close();

  // ── 4. Summary ───────────────────────────────────────────────────
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('═══════════════════════════════════════');
  console.log(`[Job:backfill] Complete in ${elapsed}s`);
  console.log(`  Processed: ${processed}`);
  console.log(`  Failed:    ${failed}`);
  console.log(`  Skipped:   ${skipped}`);
  console.log(`  Budget:    $${budget.getSummary().spent.toFixed(6)} (${budget.getSummary().tokens} tokens)`);
  console.log('═══════════════════════════════════════');
};
