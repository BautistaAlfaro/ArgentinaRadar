/**
 * News Ingestion Pipeline — Main Entry
 *
 * Orchestrates RSS fetching + web scraping on a configurable interval.
 * Runs as a standalone worker. Also starts the REST API server for
 * querying stored articles.
 *
 * Usage:
 *   npm run start        # worker only
 *   npm run server       # worker + REST API on port 3001
 */

import { loadSources, getRssSources, getScrapeSources } from './config.js';
import { fetchAllRss } from './rssFetcher.js';
import { scrapeAllSources } from './scraper.js';
import { getDb } from './db.js';
import { startServer } from './server.js';

const INGESTION_INTERVAL_MS = parseInt(process.env.INGESTION_INTERVAL ?? '300000', 10); // 5 min

let ingestionCount = 0;
let lastRun: string | null = null;

/** Run a single ingestion cycle. */
async function runIngestion(): Promise<void> {
  console.log('\n═══════════════════════════════════════');
  console.log(`[ingestion] Cycle #${ingestionCount + 1} starting at ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════');

  const sources = loadSources();
  const rssSources = getRssSources(sources);
  const scrapeSources = getScrapeSources(sources);

  // Seed the sources table if not already populated
  seedSourcesIfNeeded(sources);

  console.log(`[ingestion] RSS sources: ${rssSources.length}, Scrape sources: ${scrapeSources.length}`);

  // Fetch RSS feeds
  const rssResult = await fetchAllRss(rssSources);
  console.log(`[ingestion] RSS: ${rssResult.ok} OK, ${rssResult.failed} failed`);

  // Scrape HTML sources
  let scrapeResult = { ok: 0, failed: 0 };
  if (scrapeSources.length > 0) {
    scrapeResult = await scrapeAllSources(scrapeSources);
    console.log(`[ingestion] Scrape: ${scrapeResult.ok} OK, ${scrapeResult.failed} failed`);
  }

  ingestionCount++;
  lastRun = new Date().toISOString();
  console.log(`[ingestion] Cycle #${ingestionCount} complete at ${lastRun}`);
}

/** Ensure sources exist in the DB for health tracking. */
function seedSourcesIfNeeded(sources: ReturnType<typeof loadSources>): void {
  const db = getDb();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO sources (name, type, url, category, rate_limit_ms, css_selectors)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const s of sources) {
    insert.run(
      s.name,
      s.type,
      s.url,
      s.category,
      s.rateLimitMs,
      s.cssSelectors ? JSON.stringify(s.cssSelectors) : null,
    );
  }
}

// ─── Start ───────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('[ingestion] News Ingestion Pipeline starting...');
  console.log(`[ingestion] Interval: ${INGESTION_INTERVAL_MS}ms`);

  // Start REST API server
  const server = startServer(() => ({
    lastRun,
    ingestionCount,
  }));

  // Run first ingestion immediately, then on interval
  await runIngestion();
  setInterval(runIngestion, INGESTION_INTERVAL_MS);

  // Graceful shutdown
  const shutdown = () => {
    console.log('[ingestion] Shutting down...');
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[ingestion] Fatal error:', err);
  process.exit(1);
});
