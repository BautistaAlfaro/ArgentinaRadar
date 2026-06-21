/**
 * Pipeline Phase 2 — AI Filter Batch
 *
 * Reads articles with status='ingested', calls the ai-processor
 * to classify them, and marks each as 'filtered' or 'discarded'.
 *
 * Usage:
 *   npx tsx scripts/pipeline/02-filter-batch.ts
 *
 * Requires:
 *   - ai-processor running at http://localhost:3013 (or AI_PROCESSOR_URL env var)
 */

import Database from 'better-sqlite3';
import path from 'path';

// ─── Config ──────────────────────────────────────────────────────────

const DB_PATH = path.resolve(process.cwd(), 'data', 'argentina-radar.db');
const AI_PROCESSOR_URL = process.env.AI_PROCESSOR_URL ?? 'http://localhost:3013';
const BATCH_SIZE = 50;
const AI_TIMEOUT_MS = 30_000;

// ─── Types ───────────────────────────────────────────────────────────

interface ArticleRow {
  id: string;
  title: string;
  summary: string | null;
  source: string;
  url: string;
  category: string | null;
}

interface AiProcessResponse {
  publish?: boolean;
  category?: string;
  entities?: Array<{ name: string; type: string; tier?: string }>;
  embedding?: number[];
  tokens_used?: number;
  cost?: number;
}

// ─── AI processor call ───────────────────────────────────────────────

async function callAiProcess(
  title: string,
  summary: string,
  source: string,
): Promise<AiProcessResponse | null> {
  try {
    const resp = await fetch(`${AI_PROCESSOR_URL}/api/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, summary, source }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });

    if (!resp.ok) {
      console.warn(`[filter] ai-processor returned HTTP ${resp.status} for "${title.slice(0, 50)}"`);
      return null;
    }

    return (await resp.json()) as AiProcessResponse;
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    // ECONNREFUSED / timeout = service is down, warn once and continue
    if (msg.includes('ECONNREFUSED') || msg.includes('timeout') || msg.includes('fetch')) {
      console.warn(`[filter] ai-processor offline: ${msg}`);
    } else {
      console.warn(`[filter] ai-processor error: ${msg}`);
    }
    return null;
  }
}

// ─── Filtering logic ─────────────────────────────────────────────────

const DISCARD_CATEGORIES = new Set(['spam', 'offtopic', 'off-topic']);

function shouldKeep(result: AiProcessResponse): boolean {
  // Explicit publish flag takes priority
  if (result.publish === true) return true;
  if (result.publish === false) return false;

  // No publish flag: discard only if explicitly spam/offtopic
  if (result.category && DISCARD_CATEGORIES.has(result.category.toLowerCase())) {
    return false;
  }

  return true;
}

// ─── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('[filter] Starting AI filter batch');
  console.log(`[filter] DB: ${DB_PATH}`);
  console.log(`[filter] AI processor: ${AI_PROCESSOR_URL}`);
  console.log(`[filter] Batch size: ${BATCH_SIZE}`);

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const articles = db
    .prepare(
      `SELECT id, title, summary, source, url, category
       FROM news_items
       WHERE status = 'ingested'
       ORDER BY ingested_at ASC
       LIMIT ?`,
    )
    .all(BATCH_SIZE) as ArticleRow[];

  if (articles.length === 0) {
    console.log('[filter] No articles with status=ingested. Nothing to do.');
    db.close();
    process.exit(0);
  }

  console.log(`[filter] Processing ${articles.length} article(s)...`);

  const updateFiltered = db.prepare(`
    UPDATE news_items
    SET status = 'filtered',
        ai_category = @ai_category,
        entities    = @entities,
        embedding   = @embedding
    WHERE id = @id
  `);

  const updateDiscarded = db.prepare(
    `UPDATE news_items SET status = 'discarded', ai_category = @ai_category WHERE id = @id`,
  );

  let kept = 0;
  let discarded = 0;
  let skipped = 0; // ai-processor offline for this article

  for (const article of articles) {
    const title = article.title;
    const summary = article.summary ?? '';
    const source = article.source;

    const result = await callAiProcess(title, summary, source);

    if (!result) {
      // ai-processor unavailable — skip, do not change status
      console.warn(`[filter]   SKIP "${title.slice(0, 60)}" (ai-processor unavailable)`);
      skipped++;
      continue;
    }

    if (shouldKeep(result)) {
      updateFiltered.run({
        id: article.id,
        ai_category: result.category ?? null,
        entities: result.entities ? JSON.stringify(result.entities) : null,
        embedding: result.embedding ? JSON.stringify(result.embedding) : null,
      });
      console.log(
        `[filter]   KEEP "${title.slice(0, 60)}" (category=${result.category ?? 'n/a'}, entities=${result.entities?.length ?? 0})`,
      );
      kept++;
    } else {
      updateDiscarded.run({ id: article.id, ai_category: result.category ?? null });
      console.log(
        `[filter]   DISCARD "${title.slice(0, 60)}" (category=${result.category ?? 'n/a'})`,
      );
      discarded++;
    }
  }

  db.close();

  console.log('');
  console.log(
    `[filter] Done. Filtered ${articles.length} articles: ${kept} kept, ${discarded} discarded` +
      (skipped > 0 ? `, ${skipped} skipped (ai-processor offline)` : ''),
  );
}

main().catch((err) => {
  console.error('[filter] Fatal error:', err);
  process.exit(1);
});
