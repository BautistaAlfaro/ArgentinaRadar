import Parser from 'rss-parser';
import type { Source } from './config.js';
import { normalizeArticle } from './normalizer.js';
import { deduplicateAndStore } from './dedup.js';
import { fetchWithRetry } from './httpClient.js';
import { getDb } from './db.js';
import { recordSuccess, recordFailure } from './healthMonitor.js';
import type { Category } from '../../../shared/types/index.js';

const FEED_TIMEOUT_MS = 15_000; // 15s per feed (was 30s, now parallel)

const parser = new Parser({
  timeout: FEED_TIMEOUT_MS,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'application/rss+xml, application/xml, text/xml, */*',
  },
});

/**
 * Fetch all RSS sources in parallel and store normalized, deduplicated articles.
 * Uses URL-hash dedup to skip articles already in the DB.
 */
export async function fetchAllRss(sources: Source[]): Promise<{ ok: number; failed: number }> {
  if (sources.length === 0) return { ok: 0, failed: 0 };

  console.log(`[rssFetcher] Fetching ${sources.length} RSS feeds in parallel...`);

  // Build a set of known article URL hashes for quick dedup check
  const knownUrlHashes = buildKnownUrlHashSet();

  // Fetch ALL feeds in PARALLEL — this saves 20+ seconds vs sequential
  const results = await Promise.allSettled(
    sources.map((source) => fetchSingleRssSource(source, knownUrlHashes)),
  );

  let ok = 0;
  let failed = 0;
  let totalArticles = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const source = sources[i];

    if (result.status === 'fulfilled') {
      const articles = result.value;
      let stored = 0;

      for (const article of articles) {
        const key = article.url.toLowerCase().trim();
        if (knownUrlHashes.has(key)) {
          continue; // Skip articles already in DB
        }
        deduplicateAndStore(article);
        knownUrlHashes.add(key);
        stored++;
      }

      totalArticles += articles.length;
      ok++;

      // Update source last_fetched_at
      getDb()
        .prepare('UPDATE sources SET last_fetched_at = datetime(?) WHERE name = ?')
        .run(new Date().toISOString(), source.name);

      recordSuccess(source.name);
    } else {
      failed++;
      const errorMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.error(`[rssFetcher] ❌ Failed to fetch "${source.name}": ${errorMsg}`);
      recordFailure(source.name, errorMsg);
    }
  }

  console.log(`[rssFetcher] Fetched ${totalArticles} articles from ${ok} sources (${failed} failed, ${knownUrlHashes.size} known URLs)`);
  return { ok, failed };
}

/**
 * Fetch a single RSS feed and return normalized articles.
 * Implements in-memory dedup via URL hash set.
 */
async function fetchSingleRssSource(
  source: Source,
  knownUrlHashes: Set<string>,
): Promise<ReturnType<typeof normalizeArticle>[]> {
  console.log(`[rssFetcher] Fetching "${source.name}" from ${source.url}...`);

  // Use retry-enabled HTTP client to fetch raw XML
  const result = await fetchWithRetry(source.url, source, { timeout: FEED_TIMEOUT_MS });

  if (!result.ok || !result.body) {
    throw new Error(result.error ?? `Empty response from ${source.url}`);
  }

  // Parse RSS XML
  const feed = await parser.parseString(result.body);

  if (!feed.items || feed.items.length === 0) {
    console.log(`[rssFetcher] No items in "${source.name}" feed`);
    return [];
  }

  const articles = feed.items
    .map((item) => {
      const title = item.title ?? item.link ?? 'Untitled';
      const summary = item.contentSnippet ?? item.content ?? '';
      const url = item.link ?? '';
      const pubDate = item.pubDate ?? item.isoDate ?? item.date ?? null;

      // Skip if URL already known (cross-source dedup)
      if (knownUrlHashes.has(url.toLowerCase().trim())) {
        return null;
      }

      // Attempt to determine category from feed categories
      const category = mapCategory(item.categories?.[0] ?? '');

      return normalizeArticle({
        title,
        summary,
        source: source.name,
        url,
        category,
        publishedAt: pubDate ?? undefined,
      });
    })
    .filter((a): a is ReturnType<typeof normalizeArticle> => a !== null);

  console.log(`[rssFetcher] Got ${articles.length} articles from "${source.name}"`);
  return articles;
}

/** Build a Set of known article URL hashes from the DB for quick dedup. */
function buildKnownUrlHashSet(): Set<string> {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT url FROM news_items').all() as Array<{ url: string }>;
    const set = new Set<string>();
    for (const row of rows) {
      set.add(row.url.toLowerCase().trim());
    }
    console.log(`[rssFetcher] Loaded ${set.size} known article URLs for dedup`);
    return set;
  } catch {
    return new Set();
  }
}

/** Map an RSS category string to our normalized categories. */
function mapCategory(raw: string): Category {
  const lower = raw.toLowerCase();
  if (/pol[ií]tica/i.test(lower) || /gobierno/i.test(lower)) return 'politica';
  if (/econom/i.test(lower) || /finanzas/i.test(lower) || /negocios/i.test(lower)) return 'economia';
  if (/sociedad/i.test(lower) || /actualidad/i.test(lower)) return 'sociedad';
  if (/deportes/i.test(lower) || /f[túu]tbol/i.test(lower)) return 'deportes';
  return 'sociedad'; // default
}
