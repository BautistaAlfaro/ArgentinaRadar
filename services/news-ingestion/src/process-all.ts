/**
 * process-all.ts — Batch pipeline processor
 *
 * Reads all articles at a given status, runs them through geolocation and AI
 * filter, then marks them for approval or discard.
 *
 * Usage:
 *   export AI_PROCESSOR_URL=http://localhost:3013
 *   cd services/news-ingestion && npx tsx src/process-all.ts
 *
 * Env vars:
 *   DB_PATH             — SQLite path (default: ../../data/argentina-radar.db)
 *   GEOLOCATION_URL     — Geolocation service URL (default: http://localhost:3002)
 *   AI_PROCESSOR_URL    — AI Processor URL (default: http://localhost:3013)
 *   BATCH_SIZE          — Batch size (default: 20)
 *   MAX_ARTICLES        — Max articles to process (default: 0 = all)
 *   SOURCE_STATUS       — Source article status (default: geolocated)
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH =
  process.env.DB_PATH ??
  path.resolve(__dirname, '..', '..', '..', 'data', 'argentina-radar.db');

const GEOLOCATION_URL =
  process.env.GEOLOCATION_URL ?? 'http://127.0.0.1:3002';

const AI_PROCESSOR_URL =
  process.env.AI_PROCESSOR_URL ?? 'http://127.0.0.1:3013';

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE ?? '20', 10);
const MAX_ARTICLES = parseInt(process.env.MAX_ARTICLES ?? '0', 10);
const SOURCE_STATUS = process.env.SOURCE_STATUS ?? 'geolocated';

// ---------------------------------------------------------------------------
// DB
// ---------------------------------------------------------------------------

function getDb(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  return db;
}

function ensureApprovalTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS approval_queue (
      id                   TEXT PRIMARY KEY,
      article_id           TEXT NOT NULL,
      event_id             TEXT,
      draft_tweet          TEXT NOT NULL,
      status               TEXT DEFAULT 'pending',
      telegram_message_id  INTEGER,
      telegram_chat_id     TEXT,
      reviewed_by          TEXT,
      reviewed_at          TEXT,
      edited_text          TEXT,
      image_url            TEXT,
      image_prompt         TEXT,
      created_at           TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (article_id) REFERENCES news_items(id)
    );
    CREATE INDEX IF NOT EXISTS idx_approval_queue_status
        ON approval_queue(status);
    CREATE INDEX IF NOT EXISTS idx_approval_queue_article
        ON approval_queue(article_id);
  `);
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

interface GeoLocation {
  province: string;
  city: string;
  confidence: number;
  coordinates?: { lat: number; lng: number };
}

async function geolocateArticle(
  title: string,
  summary: string,
): Promise<GeoLocation | null> {
  const text = `${title}. ${summary ?? ''}`.trim();
  try {
    const resp = await fetch(`${GEOLOCATION_URL}/api/geolocate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!resp.ok) {
      console.warn(`  ⚠️  Geolocation returned HTTP ${resp.status}`);
      return null;
    }
    return (await resp.json()) as GeoLocation;
  } catch (err) {
    console.warn(`  ⚠️  Geolocation request failed: ${(err as Error).message}`);
    return null;
  }
}

interface FilterResult {
  article_id: string;
  verdict: string;       // PUBLISH | DISCARD
  reason: string;
  scores: Record<string, number>;
  combined: number;
  tokens_used: number;
  cost: number;
}

async function filterArticle(
  articleId: string,
  title: string,
  summary: string,
  source: string,
  category: string = '',
): Promise<FilterResult | null> {
  try {
    const resp = await fetch(`${AI_PROCESSOR_URL}/api/filter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        article_id: articleId,
        title,
        summary: summary ?? '',
        source,
        category,
      }),
    });
    if (!resp.ok) {
      console.warn(`  ⚠️  AI filter returned HTTP ${resp.status}`);
      return null;
    }
    return (await resp.json()) as FilterResult;
  } catch (err) {
    console.warn(`  ⚠️  AI filter request failed: ${(err as Error).message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Draft generation
// ---------------------------------------------------------------------------

function generateDraft(title: string, sourceCount: number = 1): string {
  const suffix = ` | Reportado por ${sourceCount} medio${sourceCount !== 1 ? 's' : ''} #ArgentinaRadar`;
  const prefix = '🇦🇷 ';
  const maxTitle = 280 - prefix.length - suffix.length;

  const truncated = title.length <= maxTitle
    ? title
    : title.slice(0, maxTitle - 1) + '…';

  return `${prefix}${truncated}${suffix}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface ArticleRow {
  id: string;
  title: string;
  summary: string | null;
  source: string;
  sources: string;
  category: string | null;
  url: string;
  location: string | null;
}

async function main(): Promise<void> {
  console.log('═'.repeat(60));
  console.log('  ArgentinaRadar — Batch Pipeline Processor');
  console.log('═'.repeat(60));
  console.log(`  DB:              ${DB_PATH}`);
  console.log(`  Geolocation:     ${GEOLOCATION_URL}`);
  console.log(`  AI Processor:    ${AI_PROCESSOR_URL}`);
  console.log(`  Batch size:      ${BATCH_SIZE}`);
  console.log(`  Source status:   ${SOURCE_STATUS}`);
  console.log(`  Max articles:    ${MAX_ARTICLES || 'ALL'}`);
  console.log('');

  // ── Connect to DB ─────────────────────────────────────────────────
  const db = getDb();
  ensureApprovalTable(db);

  // ── Count total ───────────────────────────────────────────────────
  const totalRow = db.prepare(
    'SELECT COUNT(*) as c FROM news_items WHERE status = ?',
  ).get(SOURCE_STATUS) as { c: number };

  const total = totalRow.c;
  const limit = MAX_ARTICLES > 0 ? Math.min(MAX_ARTICLES, total) : total;

  if (total === 0) {
    console.log('⚠️  No articles found with status =', SOURCE_STATUS);
    db.close();
    return;
  }

  console.log(`📡 Found ${total} articles with status='${SOURCE_STATUS}'`);
  console.log(`   Processing ${limit} articles in batches of ${BATCH_SIZE}...\n`);

  // ── Fetch articles ────────────────────────────────────────────────
  const articles = db.prepare(
    `SELECT id, title, summary, source, sources, category, url, location
     FROM news_items
     WHERE status = ?
     ORDER BY ingested_at DESC
     LIMIT ?`,
  ).all(SOURCE_STATUS, limit) as ArticleRow[];

  let processed = 0;
  let pendingApproval = 0;
  let discarded = 0;
  let errors = 0;
  let runningCost = 0;

  // ── Process in batches ────────────────────────────────────────────
  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    const batch = articles.slice(i, i + BATCH_SIZE);
    console.log(`\n── Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(articles.length / BATCH_SIZE)} ──`);

    for (const article of batch) {
      const shortId = article.id.slice(0, 8);
      process.stdout.write(`  [${shortId}] ${article.title.slice(0, 60)}…`);

      try {
        // Step 1: Geolocation
        const geo = await geolocateArticle(article.title, article.summary ?? '');
        if (geo && geo.province) {
          process.stdout.write(` 📍${geo.province}`);
        }

        // Step 2: AI Filter
        const filterResult = await filterArticle(
          article.id,
          article.title,
          article.summary ?? '',
          article.source,
          article.category ?? '',
        );

        if (!filterResult) {
          process.stdout.write(' ❌\n');
          errors++;
          continue;
        }

        runningCost += filterResult.cost;

        // Step 3: Decision
        if (
          filterResult.verdict === 'PUBLISH' &&
          filterResult.combined >= 15
        ) {
          // ── 3a. Mark as pending_approval + create approval entry ──
          const draft = generateDraft(article.title);
          const entryId = `batch_${article.id.slice(0, 8)}_${Date.now()}`;

          db.prepare(
            `UPDATE news_items
             SET status = 'pending_approval',
                 location = COALESCE(?, location)
             WHERE id = ? AND status = ?`,
          ).run(
            geo ? JSON.stringify(geo) : null,
            article.id,
            SOURCE_STATUS,
          );

          db.prepare(
            `INSERT OR IGNORE INTO approval_queue
             (id, article_id, draft_tweet, status)
             VALUES (?, ?, ?, 'pending')`,
          ).run(entryId, article.id, draft);

          pendingApproval++;
          process.stdout.write(
            ` ✅ PUBLISH (combined=${filterResult.combined}, cost=$${filterResult.cost.toFixed(6)})`,
          );
        } else {
          // ── 3b. Mark as discarded ──
          db.prepare(
            `UPDATE news_items
             SET status = 'discarded'
             WHERE id = ? AND status = ?`,
          ).run(article.id, SOURCE_STATUS);

          discarded++;
          process.stdout.write(
            ` ❌ DISCARD (${filterResult.verdict}, combined=${filterResult.combined})`,
          );
        }
      } catch (err) {
        process.stdout.write(` 💥 ERROR: ${(err as Error).message}`);
        errors++;
      }

      process.stdout.write('\n');
      processed++;
    }

    // Log batch progress
    console.log(
      `  ── Progress: ${processed}/${limit} — ` +
      `${pendingApproval} pending approval, ${discarded} discarded, ` +
      `${errors} errors, running cost=$${runningCost.toFixed(4)}`,
    );
  }

  // ── Summary ───────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log('  PROCESSING COMPLETE');
  console.log('═'.repeat(60));
  console.log(`  Total processed:    ${processed}/${total}`);
  console.log(`  Pending approval:   ${pendingApproval}`);
  console.log(`  Discarded:          ${discarded}`);
  console.log(`  Errors:             ${errors}`);
  console.log(`  Total cost:         $${runningCost.toFixed(4)}`);
  console.log('');

  // Verify
  const verifyPending = db.prepare(
    "SELECT COUNT(*) as c FROM news_items WHERE status = 'pending_approval'",
  ).get() as { c: number };
  const verifyDiscarded = db.prepare(
    "SELECT COUNT(*) as c FROM news_items WHERE status = 'discarded'",
  ).get() as { c: number };
  const verifyQueue = db.prepare(
    "SELECT COUNT(*) as c FROM approval_queue WHERE status = 'pending'",
  ).get() as { c: number };

  console.log('  Verification:');
  console.log(`    news_items pending_approval: ${verifyPending.c}`);
  console.log(`    news_items discarded:        ${verifyDiscarded.c}`);
  console.log(`    approval_queue pending:      ${verifyQueue.c}`);

  db.close();
  console.log('\n✅ Done.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
