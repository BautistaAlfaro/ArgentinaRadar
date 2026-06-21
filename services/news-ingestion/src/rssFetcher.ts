import Parser from 'rss-parser';
import type { Source } from './config.js';
import { normalizeArticle } from './normalizer.js';
import { deduplicateAndStore } from './dedup.js';
import { fetchWithRetry } from './httpClient.js';
import { getDb } from './db.js';
import type { Category } from '../../../shared/types/index.js';

const FEED_TIMEOUT_MS = 30_000;

const parser = new Parser({
  timeout: FEED_TIMEOUT_MS,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'application/rss+xml, application/xml, text/xml, */*',
  },
});

/** Fetch all RSS sources and store normalized, deduplicated articles. */
export async function fetchAllRss(sources: Source[]): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;

  for (const source of sources) {
    try {
      const articles = await fetchRssSource(source);
      for (const article of articles) {
        deduplicateAndStore(article);
      }
      ok++;

      // Update source last_fetched_at
      getDb()
        .prepare('UPDATE sources SET last_fetched_at = datetime(?) WHERE name = ?')
        .run(new Date().toISOString(), source.name);
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[rssFetcher] Failed to fetch "${source.name}" (${source.url}): ${msg}`);
    }
  }

  return { ok, failed };
}

/** Fetch a single RSS source and return normalized articles. */
async function fetchRssSource(source: Source): Promise<ReturnType<typeof normalizeArticle>[]> {
  console.log(`[rssFetcher] Fetching "${source.name}" from ${source.url}...`);

  // Use our retry-enabled HTTP client to fetch the raw XML
  const result = await fetchWithRetry(source.url, source);

  if (!result.ok || !result.body) {
    throw new Error(result.error ?? `Empty response from ${source.url}`);
  }

  // Parse RSS XML
  const feed = await parser.parseString(result.body);

  if (!feed.items || feed.items.length === 0) {
    console.log(`[rssFetcher] No items found in "${source.name}" feed`);
    return [];
  }

  const articles = feed.items.map((item) => {
    const title = item.title ?? item.link ?? 'Untitled';
    const summary = item.contentSnippet ?? item.content ?? '';
    const url = item.link ?? '';
    const pubDate = item.pubDate ?? item.isoDate ?? item.date ?? null;

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
  });

  console.log(`[rssFetcher] Got ${articles.length} articles from "${source.name}"`);
  return articles;
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
