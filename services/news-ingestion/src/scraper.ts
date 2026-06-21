/**
 * HTML Scraper — lightweight Cheerio-based scraping.
 *
 * Replaces Puppeteer for all non-JS-rendered sites.
 * Falls back to Puppeteer only when a source explicitly requires it
 * (use Puppeteer for sources with `"jsRendered": true`).
 *
 * Benefits over Puppeteer:
 *   - ~50MB RAM vs 500MB+
 *   - <1s per page vs 5-10s
 *   - No browser binary dependency
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import type { Source, CssSelectors } from './config.js';
import { normalizeArticle } from './normalizer.js';
import { deduplicateAndStore } from './dedup.js';
import { RateLimiter } from './rateLimiter.js';
import { getDb } from './db.js';
import { recordSuccess, recordFailure } from './healthMonitor.js';
import type { Category } from '../../../shared/types/index.js';

const rateLimiter = new RateLimiter();
const HTTP_TIMEOUT_MS = 30_000;

/**
 * Scrape all configured scrape sources using Cheerio.
 * Each source uses its own CSS selectors (from sources.json).
 */
export async function scrapeAllSources(sources: Source[]): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;

  // Scrape all sources in parallel
  const results = await Promise.allSettled(
    sources.map((source) => scrapeSourceCheerio(source)),
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const source = sources[i];

    if (result.status === 'fulfilled' && result.value.length > 0) {
      for (const article of result.value) {
        deduplicateAndStore(article);
      }
      ok++;

      getDb()
        .prepare('UPDATE sources SET last_fetched_at = datetime(?) WHERE name = ?')
        .run(new Date().toISOString(), source.name);

      recordSuccess(source.name);
    } else {
      failed++;
      const errorMsg = result.status === 'rejected'
        ? (result.reason instanceof Error ? result.reason.message : String(result.reason))
        : 'No articles found';
      console.error(`[scraper] Failed to scrape "${source.name}": ${errorMsg}`);
      recordFailure(source.name, errorMsg);
    }
  }

  return { ok, failed };
}

/**
 * Scrape a single source using Cheerio (lightweight, no browser).
 * Extracts articles from HTML using the configured CSS selectors.
 */
async function scrapeSourceCheerio(source: Source): Promise<ReturnType<typeof normalizeArticle>[]> {
  if (!source.cssSelectors) {
    throw new Error(`No CSS selectors configured for "${source.name}"`);
  }

  const selectors = source.cssSelectors;
  console.log(`[scraper] Scraping "${source.name}" from ${source.url}...`);

  // Apply per-source rate limiting
  await rateLimiter.wait(source.url, source.rateLimitMs);

  try {
    // Fetch the HTML
    const response = await axios.get(source.url, {
      timeout: HTTP_TIMEOUT_MS,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
      },
    });

    rateLimiter.markRun(source.url);

    const html = response.data as string;
    const $ = cheerio.load(html);
    const articles: Array<{ title: string; summary: string; url: string; timestamp: string | null }> = [];

    // For c5n: articles are wrapped in <a> tags, the article is inside the link
    // For a24: articles have a.news-link wrapping the content
    // For generic: look for article elements with selectors

    // Try parent-wrapped link pattern first (c5n style: <a href="..."><article>...</article></a>)
    const wrappedLinks = $(`a:has(${selectors.article})`).toArray();
    if (wrappedLinks.length > 0) {
      for (const linkEl of wrappedLinks) {
        const href = $(linkEl).attr('href') ?? '';
        const articleEl = $(linkEl).find(selectors.article).first();
        if (articleEl.length === 0) continue;

        const title = articleEl.find(selectors.title).first().text().trim() || 'Untitled';
        const summary = articleEl.find(selectors.summary).first().text().trim() || '';
        const url = href.startsWith('http') ? href : `https://${new URL(source.url).hostname}${href.startsWith('/') ? '' : '/'}${href}`;
        const timestamp = articleEl.find(selectors.timestamp).first().attr('datetime') ?? articleEl.find(selectors.timestamp).first().text().trim() ?? null;

        articles.push({ title, summary, url, timestamp });
      }
    }

    // Then: find article elements directly and look for links inside
    const articleEls = $(selectors.article).toArray();
    const seenUrls = new Set(articles.map(a => a.url));

    for (const el of articleEls) {
      const $el = $(el);

      // Extract link — try the configured selector first, then find any anchor in the article
      let url = '';
      if (selectors.link) {
        const linkEl = $el.find(selectors.link).first();
        url = linkEl.attr('href') ?? '';
        // For a.news-link, the article is INSIDE the link, so the href is on the link itself
        if (!url) {
          url = linkEl.parent().attr('href') ?? linkEl.closest('a').attr('href') ?? '';
        }
      }
      if (!url) {
        url = $el.find('a[href]').first().attr('href') ?? '';
      }
      if (!url) {
        url = $el.closest('a[href]').attr('href') ?? '';
      }

      if (!url) continue; // Skip articles without links

      // Resolve relative URLs
      if (!url.startsWith('http')) {
        try {
          url = new URL(url, source.url).href;
        } catch {
          continue;
        }
      }

      if (seenUrls.has(url)) continue;
      seenUrls.add(url);

      const title = $el.find(selectors.title).first().text().trim() || 'Untitled';
      const summary = $el.find(selectors.summary).first().text().trim() || '';
      const timestamp = $el.find(selectors.timestamp).first().attr('datetime') ?? $el.find(selectors.timestamp).first().text().trim() ?? null;

      articles.push({ title, summary, url, timestamp });
    }

    // Deduplicate by URL
    const unique = new Map<string, typeof articles[0]>();
    for (const a of articles) {
      if (a.url && !unique.has(a.url)) {
        unique.set(a.url, a);
      }
    }

    const normalized = Array.from(unique.values())
      .slice(0, 30) // Max 30 articles per source
      .map((a) =>
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Fetch failed for "${source.name}": ${msg}`);
  }
}
