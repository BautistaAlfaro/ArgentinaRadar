import puppeteer from 'puppeteer';
import type { Browser } from 'puppeteer';
import type { Source, CssSelectors } from './config.js';
import { normalizeArticle } from './normalizer.js';
import { deduplicateAndStore } from './dedup.js';
import { RateLimiter } from './rateLimiter.js';
import { getDb } from './db.js';
import type { Category } from '../../../shared/types/index.js';

const rateLimiter = new RateLimiter();

/**
 * Scrape all configured scrape sources. Each source uses its own CSS
 * selectors (from sources.json) to extract article data from the HTML.
 */
export async function scrapeAllSources(sources: Source[]): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    for (const source of sources) {
      try {
        const articles = await scrapeSource(browser, source);
        for (const article of articles) {
          deduplicateAndStore(article);
        }
        ok++;

        getDb()
          .prepare('UPDATE sources SET last_fetched_at = datetime(?) WHERE name = ?')
          .run(new Date().toISOString(), source.name);
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[scraper] Failed to scrape "${source.name}" (${source.url}): ${msg}`);
      }
    }
  } finally {
    await browser.close();
  }

  return { ok, failed };
}

/** Scrape a single source using Puppeteer. */
async function scrapeSource(
  browser: Browser,
  source: Source,
): Promise<ReturnType<typeof normalizeArticle>[]> {
  if (!source.cssSelectors) {
    throw new Error(`No CSS selectors configured for "${source.name}"`);
  }

  const selectors = source.cssSelectors;
  console.log(`[scraper] Scraping "${source.name}" from ${source.url}...`);

  // Apply per-source rate limiting
  await rateLimiter.wait(source.url, source.rateLimitMs);

  const page = await browser.newPage();

  try {
    // Set a reasonable viewport and user agent
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );

    await page.goto(source.url, { waitUntil: 'networkidle2', timeout: 30_000 });

    // Extract articles using the configured CSS selectors
    const articles = await page.$$eval(
      selectors.article,
      (articleEls: Element[], sel: CssSelectors) => {
        return articleEls.slice(0, 20).map((el: Element) => {
          const titleEl = el.querySelector(sel.title);
          const summaryEl = el.querySelector(sel.summary);
          const linkEl = el.querySelector(sel.link);
          const timeEl = el.querySelector(sel.timestamp);

          const title = titleEl?.textContent?.trim() ?? 'Untitled';
          const summary = summaryEl?.textContent?.trim() ?? '';
          const url = (linkEl as HTMLAnchorElement | null)?.href ?? '';
          const timestamp = timeEl?.getAttribute('datetime') ?? timeEl?.textContent?.trim() ?? null;

          return { title, summary, url, timestamp };
        });
      },
      selectors,
    );

    rateLimiter.markRun(source.url);

    const normalized = articles.map((a: { title: string; summary: string; url: string; timestamp: string | null }) =>
      normalizeArticle({
        title: a.title,
        summary: a.summary,
        source: source.name,
        url: a.url,
        category: source.category,
        publishedAt: a.timestamp ?? undefined,
      }),
    );

    console.log(`[scraper] Got ${normalized.length} articles from "${source.name}"`);
    return normalized;
  } finally {
    await page.close();
  }
}
