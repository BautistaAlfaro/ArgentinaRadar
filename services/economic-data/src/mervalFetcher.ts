/**
 * MERVAL index fetcher.
 *
 * Primary: Yahoo Finance API (free, no API key)
 * Fallback: Cronista Mercados page scrape
 *
 * The MERVAL is Argentina's main stock market index. This fetcher
 * attempts multiple sources and returns the first successful value.
 *
 * WHY YAHOO FINANCE:
 *   - Free, no API key required
 *   - Reliable, low latency
 *   - Official ^MERV symbol for Buenos Aires exchange
 *   - Returns structured JSON with price, previous close, day range
 *
 * WHY NOT BYMA API:
 *   - The old BYMA open API endpoint was deprecated/changed
 *   - Yahoo Finance sources from the same underlying data
 */

import axios from 'axios';
import * as cheerio from 'cheerio';

const REQUEST_TIMEOUT = 10_000;

export interface MervalResult {
  /** MERVAL index value */
  value: number;
  /** Variation percentage vs previous close */
  variation: number | null;
  /** Source description */
  source: string;
  /** Timestamp of fetch */
  timestamp: string;
}

/**
 * Fetch MERVAL from Yahoo Finance public API (no auth needed).
 *
 * Yahoo Finance endpoint for ^MERV (Buenos Aires exchange):
 *   GET /v8/finance/chart/%5EMERV?range=1d&interval=1d
 *
 * Response shape:
 * {
 *   chart: {
 *     result: [{
 *       meta: {
 *         regularMarketPrice: 3291321.5,
 *         chartPreviousClose: 3333406.8,
 *         ...
 *       },
 *       timestamp: [...],
 *       indicators: { quote: [...], adjclose: [...] }
 *     }]
 *   }
 * }
 */
async function fetchYahooFinance(): Promise<MervalResult | null> {
  try {
    const url =
      'https://query1.finance.yahoo.com/v8/finance/chart/%5EMERV?range=1d&interval=1d';

    const { data } = await axios.get(url, {
      timeout: REQUEST_TIMEOUT,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
    });

    const result = data?.chart?.result?.[0];
    if (!result?.meta) {
      console.warn('[mervalFetcher] Yahoo Finance: unexpected response shape');
      return null;
    }

    const meta = result.meta;
    const value: number | undefined = meta.regularMarketPrice;
    const previousClose: number | undefined = meta.chartPreviousClose;

    if (typeof value !== 'number' || value <= 0) {
      console.warn('[mervalFetcher] Yahoo Finance: invalid or missing price');
      return null;
    }

    // Calculate variation percentage from previous close
    let variation: number | null = null;
    if (typeof previousClose === 'number' && previousClose > 0) {
      variation = ((value - previousClose) / previousClose) * 100;
    }

    // Sanity check: MERVAL is typically 1M–4M range
    if (value < 100_000 || value > 10_000_000) {
      console.warn(
        `[mervalFetcher] Yahoo Finance: value ${value} outside expected range`,
      );
      return null;
    }

    console.log(
      `[mervalFetcher] Yahoo Finance: MERVAL=${value}, prevClose=${previousClose}, variation=${variation?.toFixed(2)}%`,
    );

    return {
      value: Math.round(value * 100) / 100,
      variation: variation != null ? Math.round(variation * 100) / 100 : null,
      source: 'Yahoo Finance',
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.warn(
      '[mervalFetcher] Yahoo Finance failed:',
      (err as Error).message,
    );
    return null;
  }
}

/**
 * Scrape MERVAL from Cronista Mercados en vivo page.
 * Used as a fallback if Yahoo Finance is unavailable.
 */
async function scrapeCronista(): Promise<MervalResult | null> {
  try {
    const { data: html } = await axios.get(
      'https://www.cronista.com/Mercados-en-vivo/',
      {
        timeout: REQUEST_TIMEOUT,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html',
        },
      },
    );

    const $ = cheerio.load(html);
    const bodyText = $('body').text();

    // Look for MERVAL/S&P MERVAL value in the page text
    // Cronista displays MERVAL as a large number with dots as thousand separators
    const mervalMatch = bodyText.match(
      /(?:MERVAL|S&P\s*MERVAL)[^0-9]*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/i,
    );
    if (!mervalMatch) {
      console.warn('[mervalFetcher] Cronista: could not find MERVAL in page');
      return null;
    }

    const valueStr = mervalMatch[1].replace(/\./g, '').replace(',', '.');
    const value = parseFloat(valueStr);
    if (isNaN(value) || value < 100_000 || value > 10_000_000) {
      console.warn(
        `[mervalFetcher] Cronista: parsed value ${value} out of range`,
      );
      return null;
    }

    // Try to extract variation (Cronista typically shows % change near the value)
    const varMatch = bodyText.match(
      /(?:MERVAL|S&P\s*MERVAL).*?([+-]?\d{1,2}[.,]\d{1,2})%/i,
    );
    const variation = varMatch
      ? parseFloat(varMatch[1].replace(',', '.'))
      : null;

    console.log(
      `[mervalFetcher] Cronista: MERVAL=${value}, variation=${variation}`,
    );

    return {
      value: Math.round(value * 100) / 100,
      variation: variation != null ? Math.round(variation * 100) / 100 : null,
      source: 'Cronista',
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.warn(
      '[mervalFetcher] Cronista scrape failed:',
      (err as Error).message,
    );
    return null;
  }
}

/**
 * Fetch the MERVAL index, trying multiple sources in order.
 * Primary → Fallback
 */
export async function fetchMerval(): Promise<MervalResult> {
  // Primary: Yahoo Finance (free, reliable, structured API)
  let result = await fetchYahooFinance();
  if (result) return result;

  // Fallback: Cronista Mercados scrape
  result = await scrapeCronista();
  if (result) return result;

  throw new Error('All MERVAL sources failed');
}
