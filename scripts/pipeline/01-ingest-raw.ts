/**
 * Pipeline Phase 1 — Raw Ingestion
 *
 * Fetches RSS feeds from all active sources, deduplicates by URL,
 * and inserts new articles with status='ingested'.
 *
 * Usage:
 *   npx tsx scripts/pipeline/01-ingest-raw.ts [--limit N]
 *
 * Options:
 *   --limit N   Max articles to ingest per source (default: 10)
 */

import Database from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';

// ─── Config ──────────────────────────────────────────────────────────

const DB_PATH = path.resolve(process.cwd(), 'data', 'argentina-radar.db');
const FEED_TIMEOUT_MS = 15_000;
const DEFAULT_LIMIT = 10;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ─── CLI args ────────────────────────────────────────────────────────

function parseLimitArg(): number {
  const idx = process.argv.indexOf('--limit');
  if (idx !== -1 && process.argv[idx + 1]) {
    const val = parseInt(process.argv[idx + 1], 10);
    return isNaN(val) || val <= 0 ? DEFAULT_LIMIT : val;
  }
  return DEFAULT_LIMIT;
}

// ─── Types ───────────────────────────────────────────────────────────

interface SourceRow {
  name: string;
  url: string;
  category: string;
  type: string;
  status: string;
}

interface ParsedItem {
  id: string;
  title: string;
  summary: string;
  source: string;
  sources: string;
  url: string;
  category: string;
  published_at: string;
  ingested_at: string;
  status: 'ingested';
}

// ─── ID generation ───────────────────────────────────────────────────

function generateId(title: string, url: string): string {
  return crypto.createHash('sha256').update(title + url).digest('hex').slice(0, 16);
}

// ─── Date parsing ────────────────────────────────────────────────────

function parseDate(raw: string | null | undefined): string {
  if (!raw) return new Date().toISOString();
  try {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

// ─── Summary truncation ──────────────────────────────────────────────

function truncateSummary(text: string, max = 500): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return lastSpace > 0 ? cut.slice(0, lastSpace) + '...' : cut.slice(0, max - 1) + '...';
}

// ─── Category mapping ────────────────────────────────────────────────

function mapCategory(raw: string, sourceCat: string): string {
  if (/pol[ií]tica|gobierno/i.test(raw)) return 'politica';
  if (/econom|finanzas|negocios/i.test(raw)) return 'economia';
  if (/sociedad|actualidad/i.test(raw)) return 'sociedad';
  if (/deportes|f[uú]tbol/i.test(raw)) return 'deportes';
  return sourceCat || 'sociedad';
}

// ─── XML / RSS parsing ───────────────────────────────────────────────

interface RssEntry {
  title: string;
  link: string;
  summary: string;
  pubDate: string | null;
  category: string;
}

/**
 * Minimal RSS/Atom XML parser using regex.
 * Handles <item> (RSS 2.0) and <entry> (Atom) elements.
 * Avoids pulling in a heavy XML dependency for a standalone script.
 */
function parseXml(xml: string): RssEntry[] {
  const items: RssEntry[] = [];
  const itemPattern = /<(item|entry)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemPattern.exec(xml)) !== null) {
    const block = match[2];

    const extractTag = (tag: string): string => {
      const cdata = new RegExp(
        `<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`,
        'i',
      ).exec(block);
      if (cdata) return cdata[1].trim();
      const plain = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block);
      if (plain) return plain[1].replace(/<[^>]+>/g, '').trim();
      return '';
    };

    const extractAttr = (tag: string, attr: string): string => {
      const re = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, 'i').exec(block);
      return re ? re[1].trim() : '';
    };

    const title = extractTag('title') || 'Untitled';
    // Prefer <link> tag value; for Atom, fall back to href attribute
    const link = extractTag('link') || extractAttr('link', 'href');
    if (!link) continue;

    const summary =
      extractTag('description') ||
      extractTag('summary') ||
      extractTag('content') ||
      '';

    const pubDate =
      extractTag('pubDate') ||
      extractTag('published') ||
      extractTag('updated') ||
      null;

    const category = extractTag('category');

    items.push({ title, link: link.trim(), summary, pubDate, category });
  }

  return items;
}

// ─── Feed fetcher ────────────────────────────────────────────────────

async function fetchFeed(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    });
    if (!resp.ok) {
      console.warn(`[ingest] HTTP ${resp.status} fetching ${url}`);
      return null;
    }
    return await resp.text();
  } catch (err) {
    console.warn(`[ingest] Failed to fetch ${url}: ${(err as Error).message}`);
    return null;
  }
}

// ─── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const limit = parseLimitArg();
  console.log(`[ingest] Starting raw ingestion (limit: ${limit} per source)`);
  console.log(`[ingest] DB: ${DB_PATH}`);

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Load active sources
  const sources = db
    .prepare(
      `SELECT name, url, category, type, status FROM sources WHERE status IN ('healthy', 'active')`,
    )
    .all() as SourceRow[];

  if (sources.length === 0) {
    console.warn('[ingest] No active sources found. Exiting.');
    db.close();
    process.exit(0);
  }

  // RSS-only (scrape sources require a headless browser)
  const rssSources = sources.filter((s) => s.type === 'rss');
  const scrapeCount = sources.length - rssSources.length;
  console.log(
    `[ingest] ${rssSources.length} RSS source(s)` +
      (scrapeCount > 0 ? ` (${scrapeCount} scrape source(s) skipped)` : ''),
  );

  // Build URL dedup set from existing rows
  const knownUrls = new Set<string>();
  const existingRows = db.prepare('SELECT url FROM news_items').all() as Array<{ url: string }>;
  for (const row of existingRows) {
    knownUrls.add(row.url.toLowerCase().trim());
  }
  console.log(`[ingest] ${knownUrls.size} existing URLs loaded for dedup`);

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO news_items
      (id, title, summary, source, sources, url, category, published_at, ingested_at, status)
    VALUES
      (@id, @title, @summary, @source, @sources, @url, @category, @published_at, @ingested_at, @status)
  `);

  const insertBatch = db.transaction((items: ParsedItem[]) => {
    let count = 0;
    for (const item of items) {
      const result = insertStmt.run(item);
      if (result.changes > 0) count++;
    }
    return count;
  });

  let totalIngested = 0;
  let sourcesOk = 0;
  let sourcesFailed = 0;

  for (const source of rssSources) {
    console.log(`[ingest] Fetching "${source.name}" -> ${source.url}`);

    const xml = await fetchFeed(source.url);
    if (!xml) {
      sourcesFailed++;
      continue;
    }

    const entries = parseXml(xml);
    if (entries.length === 0) {
      console.log(`[ingest]   No items in feed`);
      sourcesOk++;
      continue;
    }

    const toInsert: ParsedItem[] = [];

    for (const entry of entries) {
      if (toInsert.length >= limit) break;

      const urlKey = entry.link.toLowerCase().trim();
      if (knownUrls.has(urlKey)) continue;

      const title = entry.title.slice(0, 500);
      const summary = truncateSummary(entry.summary.replace(/<[^>]+>/g, '').trim());
      const category = mapCategory(entry.category, source.category);
      const id = generateId(title, entry.link);

      toInsert.push({
        id,
        title,
        summary,
        source: source.name,
        sources: JSON.stringify([source.name]),
        url: entry.link,
        category,
        published_at: parseDate(entry.pubDate),
        ingested_at: new Date().toISOString(),
        status: 'ingested',
      });

      // Pre-add to dedup set so parallel entries in the same batch don't collide
      knownUrls.add(urlKey);
    }

    const inserted = insertBatch(toInsert);
    totalIngested += inserted;

    console.log(
      `[ingest]   "${source.name}": ${inserted} new article(s) inserted (${entries.length} in feed, ${toInsert.length} candidates)`,
    );
    sourcesOk++;
  }

  db.close();

  console.log('');
  console.log(
    `[ingest] Done. Ingested ${totalIngested} new articles from ${sourcesOk} source(s)` +
      (sourcesFailed > 0 ? ` (${sourcesFailed} source(s) failed)` : ''),
  );
}

main().catch((err) => {
  console.error('[ingest] Fatal error:', err);
  process.exit(1);
});
