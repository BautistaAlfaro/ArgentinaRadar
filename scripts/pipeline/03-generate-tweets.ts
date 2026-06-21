/**
 * Pipeline Phase 3 — Generate Tweet Drafts
 *
 * Reads filtered articles, generates tweet drafts via the ai-processor,
 * and inserts them into the approval_queue table for human review.
 *
 * This script also runs the approval_queue migration if the table
 * does not yet exist.
 *
 * Usage:
 *   npx tsx scripts/pipeline/03-generate-tweets.ts
 *
 * Requires:
 *   - ai-processor running at http://localhost:3013 (or AI_PROCESSOR_URL env var)
 *     Tries /api/summarize first, falls back to /api/process, then to manual construction.
 */

import Database from 'better-sqlite3';
import path from 'path';

// ─── Config ──────────────────────────────────────────────────────────

const DB_PATH = path.resolve(process.cwd(), 'data', 'argentina-radar.db');
const AI_PROCESSOR_URL = process.env.AI_PROCESSOR_URL ?? 'http://localhost:3013';
const BATCH_SIZE = 20;
const AI_TIMEOUT_MS = 30_000;
const TWEET_MAX_LENGTH = 280;

// ─── Types ───────────────────────────────────────────────────────────

interface ArticleRow {
  id: string;
  title: string;
  summary: string | null;
  source: string;
  url: string;
  category: string | null;
  ai_summary: string | null;
}

interface SummarizeResponse {
  tweet?: string;
  text?: string;
  summary?: string;
}

interface ProcessResponse {
  category?: string;
  entities?: Array<{ name: string; type: string }>;
}

// ─── Migration ───────────────────────────────────────────────────────

function runApprovalQueueMigration(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS approval_queue (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id   TEXT NOT NULL,
      tweet_draft  TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      approved_at  TEXT,
      published_at TEXT,
      tweet_id     TEXT,
      batch_id     TEXT,
      FOREIGN KEY (article_id) REFERENCES news_items(id)
    );

    CREATE INDEX IF NOT EXISTS idx_approval_status ON approval_queue(status);
    CREATE INDEX IF NOT EXISTS idx_approval_batch  ON approval_queue(batch_id);
  `);
  console.log('[tweets] approval_queue table ready');
}

// ─── Batch ID ────────────────────────────────────────────────────────

function buildBatchId(): string {
  const now = new Date();
  const pad = (n: number, len = 2): string => String(n).padStart(len, '0');
  const Y = now.getFullYear();
  const M = pad(now.getMonth() + 1);
  const D = pad(now.getDate());
  const h = pad(now.getHours());
  const m = pad(now.getMinutes());
  const s = pad(now.getSeconds());
  return `batch_${Y}${M}${D}_${h}${m}${s}`;
}

// ─── AI summarize call (/api/summarize) ──────────────────────────────

async function callSummarize(
  title: string,
  summary: string,
  source: string,
): Promise<string | null> {
  try {
    const resp = await fetch(`${AI_PROCESSOR_URL}/api/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, summary, source, maxLength: TWEET_MAX_LENGTH }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });

    if (!resp.ok) return null;

    const data = (await resp.json()) as SummarizeResponse;
    return data.tweet ?? data.text ?? data.summary ?? null;
  } catch {
    return null; // endpoint may not exist — handled by caller
  }
}

// ─── AI process call (/api/process) — fallback ───────────────────────

async function callProcess(
  title: string,
  summary: string,
  source: string,
): Promise<ProcessResponse | null> {
  try {
    const resp = await fetch(`${AI_PROCESSOR_URL}/api/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, summary, source }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });

    if (!resp.ok) return null;
    return (await resp.json()) as ProcessResponse;
  } catch {
    return null;
  }
}

// ─── Tweet construction ──────────────────────────────────────────────

/**
 * Craft a tweet from /api/process result: prepend top entity if available,
 * then title and source. Falls back gracefully.
 */
function craftTweetFromProcess(
  title: string,
  source: string,
  url: string,
  processResult: ProcessResponse | null,
): string {
  const tag =
    processResult?.entities?.[0]?.name
      ? `[${processResult.entities[0].name}] `
      : '';

  return truncateTweet(`${tag}${title} - ${source} ${url}`);
}

/**
 * Manual fallback: "[title] - [source] [url]" truncated to 280 chars.
 */
function buildManualTweet(title: string, source: string, url: string): string {
  return truncateTweet(`${title} - ${source} ${url}`);
}

function truncateTweet(text: string): string {
  if (text.length <= TWEET_MAX_LENGTH) return text;
  // Leave room for ellipsis
  return text.slice(0, TWEET_MAX_LENGTH - 1) + '\u2026';
}

// ─── Generate draft for a single article ─────────────────────────────

async function generateDraft(article: ArticleRow): Promise<string> {
  const title = article.title;
  const summary = article.summary ?? '';
  const source = article.source;
  const url = article.url;

  // 1. Try /api/summarize
  const summarized = await callSummarize(title, summary, source);
  if (summarized) {
    return truncateTweet(summarized);
  }

  // 2. Try /api/process and craft from entities
  const processed = await callProcess(title, summary, source);
  if (processed !== null) {
    return craftTweetFromProcess(title, source, url, processed);
  }

  // 3. Manual fallback
  return buildManualTweet(title, source, url);
}

// ─── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('[tweets] Starting tweet draft generation');
  console.log(`[tweets] DB: ${DB_PATH}`);
  console.log(`[tweets] AI processor: ${AI_PROCESSOR_URL}`);

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Ensure approval_queue exists
  runApprovalQueueMigration(db);

  // Find filtered articles not yet queued
  const articles = db
    .prepare(
      `SELECT id, title, summary, source, url, category, ai_summary
       FROM news_items
       WHERE status = 'filtered'
         AND id NOT IN (SELECT article_id FROM approval_queue)
       LIMIT ?`,
    )
    .all(BATCH_SIZE) as ArticleRow[];

  if (articles.length === 0) {
    console.log('[tweets] No filtered articles pending tweet generation. Nothing to do.');
    db.close();
    process.exit(0);
  }

  const batchId = buildBatchId();
  console.log(`[tweets] Batch ID: ${batchId}`);
  console.log(`[tweets] Generating drafts for ${articles.length} article(s)...`);

  const insertDraft = db.prepare(`
    INSERT INTO approval_queue (article_id, tweet_draft, status, batch_id)
    VALUES (@article_id, @tweet_draft, 'pending', @batch_id)
  `);

  const markPendingApproval = db.prepare(
    `UPDATE news_items SET status = 'pending_approval' WHERE id = ?`,
  );

  const processBatch = db.transaction(
    (drafts: Array<{ article_id: string; tweet_draft: string; batch_id: string }>) => {
      for (const draft of drafts) {
        insertDraft.run(draft);
        markPendingApproval.run(draft.article_id);
      }
    },
  );

  const drafts: Array<{ article_id: string; tweet_draft: string; batch_id: string }> = [];

  for (const article of articles) {
    const draft = await generateDraft(article);
    console.log(`[tweets]   "${article.title.slice(0, 50)}" -> ${draft.slice(0, 60)}...`);
    drafts.push({ article_id: article.id, tweet_draft: draft, batch_id: batchId });
  }

  processBatch(drafts);

  db.close();

  console.log('');
  console.log(`[tweets] Done. Generated ${drafts.length} tweet draft(s) for batch ${batchId}`);
}

main().catch((err) => {
  console.error('[tweets] Fatal error:', err);
  process.exit(1);
});
