import type { NewsItem, Location, AiScore } from '../../../shared/types/index.js';
import { getDb } from './db.js';
import { callAiProcessor } from './aiClient.js';
import { pushToGeolocationQueue } from './queue.js';

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const SIMILARITY_THRESHOLD = 0.85;

/**
 * Deduplication engine: checks if an article already exists in the DB
 * within a 24h window, using normalized title similarity ≥85%.
 *
 * If a duplicate is found, the source is merged into the existing record's
 * `sources[]` array (to track multiple outlets reporting the same story).
 *
 * Returns the stored (existing or inserted) NewsItem.
 */
export function deduplicateAndStore(item: NewsItem): NewsItem {
  const db = getDb();
  const existing = findDuplicate(db, item);

  if (existing) {
    // Merge sources if not already recorded
    if (!existing.sources.includes(item.source)) {
      existing.sources.push(item.source);
      db.prepare(
        'UPDATE news_items SET sources = ? WHERE id = ?',
      ).run(JSON.stringify(existing.sources), existing.id);
    }
    console.log(`[dedup] Duplicate merged: "${item.title}" (existing: ${existing.id}, added source: ${item.source})`);
    return existing;
  }

  // Insert new article
  db.prepare(`
    INSERT INTO news_items (id, title, summary, source, sources, url, category, published_at, ingested_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    item.id,
    item.title,
    item.summary,
    item.source,
    JSON.stringify(item.sources),
    item.url,
    item.category,
    item.publishedAt,
    item.ingestedAt,
    item.status,
  );

  console.log(`[dedup] Inserted new article: "${item.title}" (${item.source})`);

  // Fire-and-forget AI processing — must not block RSS ingestion
  postProcessArticle(item).catch((err) => {
    console.error(`[dedup] Post-processing failed for "${item.title}":`, err);
  });

  return item;
}

// ─── AI post-processing ────────────────────────────────────────────

/**
 * Enrich article via AI processor then enqueue for geo-resolution.
 * Runs asynchronously so it never blocks the ingestion pipeline.
 */
async function postProcessArticle(item: NewsItem): Promise<void> {
  const aiResult = await callAiProcessor(item.title, item.summary, item.source);

  if (aiResult) {
    const db = getDb();
    db.prepare(
      'UPDATE news_items SET embedding = ?, entities = ?, ai_category = ? WHERE id = ?',
    ).run(
      JSON.stringify(aiResult.embedding),
      JSON.stringify(aiResult.entities),
      aiResult.category,
      item.id,
    );
    console.log(`[dedup] AI data stored for article ${item.id} (category: ${aiResult.category})`);
  }

  await pushToGeolocationQueue(item.id, item.title, item.summary);
}

/** Find a duplicate within the 24h window using normalized title similarity. */
function findDuplicate(
  db: ReturnType<typeof getDb>,
  item: NewsItem,
): NewsItem | null {
  const cutoff = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();
  const rows = db.prepare(
    'SELECT * FROM news_items WHERE ingested_at >= ? ORDER BY ingested_at DESC',
  ).all(cutoff) as Array<Record<string, unknown>>;

  const normalizedTitle = normalizeTitle(item.title);
  const canonicalUrl = canonicalizeUrl(item.url);

  for (const row of rows) {
    // Exact URL match
    if (canonicalizeUrl(String(row.url)) === canonicalUrl) {
      return rowToNewsItem(row);
    }

    // Title similarity check
    const rowTitle = String(row.title ?? '');
    if (similarity(normalizedTitle, normalizeTitle(rowTitle)) >= SIMILARITY_THRESHOLD) {
      return rowToNewsItem(row);
    }
  }

  return null;
}

/** Normalize a title: lowercase, trim, remove excess whitespace and punctuation. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\sáéíóúüñ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Canonicalize a URL by removing trailing slashes and common tracking params. */
export function canonicalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    // Remove common tracking parameters
    for (const param of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ref', 'source']) {
      u.searchParams.delete(param);
    }
    // Sort remaining params for deterministic comparison
    u.searchParams.sort();
    let result = u.origin + u.pathname.replace(/\/$/, '') + u.search;
    return result.toLowerCase();
  } catch {
    // If URL parsing fails, just strip trailing slash
    return url.replace(/\/$/, '').toLowerCase();
  }
}

/**
 * Levenshtein distance between two strings.
 * Used to compute similarity ratio for dedup comparison.
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }

  return dp[m][n];
}

/**
 * Similarity ratio between 0.0 and 1.0 based on Levenshtein distance.
 * 1.0 = identical, 0.0 = completely different.
 */
export function similarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1.0;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return 1.0 - dist / maxLen;
}

// ─── Helpers ────────────────────────────────────────────────────────

function rowToNewsItem(row: Record<string, unknown>): NewsItem {
  return {
    id: String(row.id),
    title: String(row.title),
    summary: String(row.summary ?? ''),
    source: String(row.source),
    sources: parseJsonArray(row.sources),
    url: String(row.url),
    category: String(row.category) as NewsItem['category'],
    publishedAt: String(row.published_at ?? ''),
    ingestedAt: String(row.ingested_at ?? ''),
    location: row.location ? (safeJsonParse(row.location) as Location) : null,
    aiScore: row.ai_score ? (safeJsonParse(row.ai_score) as AiScore) : null,
    tweetId: row.tweet_id ? String(row.tweet_id) : null,
    status: String(row.status ?? 'ingested') as NewsItem['status'],
  };
}

function parseJsonArray(val: unknown): string[] {
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [val];
    } catch {
      return [val];
    }
  }
  return [];
}

function safeJsonParse(val: unknown): unknown {
  if (typeof val !== 'string') return val;
  try {
    return JSON.parse(val);
  } catch {
    return val;
  }
}
