/**
 * News Ingestion Pipeline — Main Entry
 *
 * Orchestrates RSS fetching + web scraping on a configurable interval.
 * Uses createLoop() from shared/utils/shutdown for safe scheduling.
 * Also starts the REST API server for querying stored articles.
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
import { tryRecoverDisabledSources, getSourceHealth, AUTO_RECOVERY_INTERVAL_MS } from './healthMonitor.js';
import { createLoop } from '../../../shared/utils/shutdown.js';

// Pipeline plugins — loaded to ensure side-effect initialisation
import './aiClient.js';
import './queue.js';

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

  // Fetch RSS feeds (parallelized internally)
  const rssResult = await fetchAllRss(rssSources);
  console.log(`[ingestion] RSS: ${rssResult.ok} OK, ${rssResult.failed} failed`);

  // Scrape HTML sources (parallelized internally)
  let scrapeResult = { ok: 0, failed: 0 };
  if (scrapeSources.length > 0) {
    scrapeResult = await scrapeAllSources(scrapeSources);
    console.log(`[ingestion] Scrape: ${scrapeResult.ok} OK, ${scrapeResult.failed} failed`);
  }

  ingestionCount++;
  lastRun = new Date().toISOString();

  const totalOk = rssResult.ok + scrapeResult.ok;
  const totalFailed = rssResult.failed + scrapeResult.failed;
  console.log(`[ingestion] ✅ Fetched articles from ${totalOk} sources (${totalFailed} failed) — cycle #${ingestionCount} complete`);
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

/** Log current source health status. */
function logSourceHealth(): void {
  try {
    const health = getSourceHealth();
    const healthy = health.filter((h) => h.status === 'healthy').length;
    const degraded = health.filter((h) => h.status === 'degraded').length;
    const disabled = health.filter((h) => h.status === 'disabled').length;
    if (disabled > 0 || degraded > 0) {
      console.log(`[health] Sources: ${healthy} healthy, ${degraded} degraded, ${disabled} disabled`);
      for (const s of health) {
        if (s.status !== 'healthy') {
          console.log(`[health]   ${s.name}: ${s.status} (${s.consecutive_failures} failures)${s.last_error ? ` — ${s.last_error.slice(0, 100)}` : ''}`);
        }
      }
    }
  } catch {
    // DB may not be ready yet
  }
}

// ─── Start ───────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('[ingestion] 🚀 News Ingestion Pipeline starting...');
  console.log(`[ingestion] Interval: ${INGESTION_INTERVAL_MS}ms (${INGESTION_INTERVAL_MS / 1000}s)`);

  // Start REST API server
  const server = startServer(() => ({
    lastRun,
    ingestionCount,
  }));

  // Use createLoop() for safe scheduling (auto-cleanup on SIGINT/SIGTERM)
  const loop = createLoop('news-ingestion', async () => {
    await runIngestion();
    logSourceHealth();

    // Try to recover disabled sources (once per hour, handled by interval check inside)
    const sources = loadSources();
    tryRecoverDisabledSources(sources);
  }, INGESTION_INTERVAL_MS);

  loop.start(); // runs immediately, then every 5min

  // Also schedule source recovery check on a longer interval
  const recoveryInterval = setInterval(() => {
    try {
      const sources = loadSources();
      const recovered = tryRecoverDisabledSources(sources);
      if (recovered.length > 0) {
        console.log(`[ingestion] 🔄 Recovery check: ${recovered.length} source(s) queued for retry`);
      }
    } catch {
      // ignore during startup
    }
  }, AUTO_RECOVERY_INTERVAL_MS);
  recoveryInterval.unref();

  // Graceful shutdown is handled by createLoop() / shutdown.ts
}

main().catch((err) => {
  console.error('[ingestion] 💥 Fatal error:', err);
  process.exit(1);
});
