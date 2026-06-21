/**
 * MERVAL index fetcher.
 *
 * Primary: BYMA API
 * Fallback: Rava Bursátil (scrape) + Infobae economía
 *
 * The MERVAL is Argentina's main stock market index. This fetcher
 * attempts multiple sources and returns the first successful value.
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
 * Fetch MERVAL from BYMA API.
 */
async function fetchBymaApi(): Promise<MervalResult | null> {
  try {
    // BYMA public API endpoint for index data
    const { data } = await axios.get('https://open.byma.com.ar/api/indices/1', {
      timeout: REQUEST_TIMEOUT,
      headers: {
        Accept: 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    });

    // BYMA API response patterns:
    // { id: 1, simbolo: "MERVAL", ultimoOperado: 1234567.89, variacion: -0.5, ... }
    // or { data: { ... } }
    const raw = data.data ?? data;
    const value = raw.ultimoOperado ?? raw.ultimo ?? raw.valor ?? raw.price ?? raw.value;
    const variation = raw.variacion ?? raw.variacionPorcentual ?? raw.changePercent ?? raw.variacionPorcentualAcumulada ?? null;

    if (typeof value === 'number' && value > 100_000 && value < 10_000_000) {
      console.log(`[mervalFetcher] BYMA: MERVAL=${value}, variation=${variation}`);
      return {
        value: Math.round(value * 100) / 100,
        variation: variation != null ? Math.round(variation * 100) / 100 : null,
        source: 'BYMA',
        timestamp: new Date().toISOString(),
      };
    }

    console.warn('[mervalFetcher] BYMA: unexpected response shape');
    return null;
  } catch (err) {
    console.warn('[mervalFetcher] BYMA API failed:', (err as Error).message);
    return null;
  }
}

/**
 * Scrape MERVAL from Rava Bursátil.
 */
async function scrapeRava(): Promise<MervalResult | null> {
  try {
    const { data: html } = await axios.get('https://www.rava.com/indices', {
      timeout: REQUEST_TIMEOUT,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html',
      },
    });

    const $ = cheerio.load(html);
    let value: number | null = null;
    let variation: number | null = null;

    // Look for MERVAL in tables, cards, or data cells
    $('*').each((_i, el) => {
      const text = $(el).text().trim();
      if (text.toLowerCase().includes('merval') || text.includes('MERVAL')) {
        const parent = $(el).closest('tr, div, section, li');
        const allText = parent.text();
        // Extract large numbers (MERVAL is typically 1M+)
        const nums = [...allText.matchAll(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/g)]
          .map((m) => parseFloat(m[1].replace(/\./g, '').replace(',', '.')))
          .filter((n) => !isNaN(n) && n > 100_000 && n < 10_000_000);
        if (nums.length > 0) {
          value = value ?? nums[0];
        }
        // Extract variation: percentage like +0.5% or -1.2%
        const varMatch = allText.match(/([+-]?\d{1,2}[.,]\d{1,2})%/);
        if (varMatch) {
          variation = variation ?? parseFloat(varMatch[1].replace(',', '.'));
        }
      }
    });

    if (value === null) {
      // Try to find the MERVAL row in a table
      const rows = $('tr').filter((_i, el) =>
        $(el).text().toLowerCase().includes('merval'),
      );
      if (rows.length > 0) {
        const cells = rows.first().find('td, th');
        cells.each((_i, cell) => {
          const txt = $(cell).text().trim();
          const num = parseFloat(txt.replace(/[^0-9,.-]/g, '').replace(',', '.'));
          if (!isNaN(num) && num > 100_000 && num < 10_000_000) {
            value = value ?? num;
          }
        });
      }
    }

    if (value !== null) {
      console.log(`[mervalFetcher] Rava: MERVAL=${value}, variation=${variation}`);
      return {
        value: Math.round(value * 100) / 100,
        variation: variation != null ? Math.round(variation * 100) / 100 : null,
        source: 'Rava Bursátil',
        timestamp: new Date().toISOString(),
      };
    }

    console.warn('[mervalFetcher] Rava: could not parse MERVAL');
    return null;
  } catch (err) {
    console.warn('[mervalFetcher] Rava scrape failed:', (err as Error).message);
    return null;
  }
}

/**
 * Attempt to scrape MERVAL from Infobae economía section.
 */
async function scrapeInfobae(): Promise<MervalResult | null> {
  try {
    const { data: html } = await axios.get('https://www.infobae.com/economia/', {
      timeout: REQUEST_TIMEOUT,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html',
      },
    });

    const $ = cheerio.load(html);
    const bodyText = $('body').text();
    const mervalMatch = bodyText.match(/MERVAL[:\s]*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/i);
    if (!mervalMatch) return null;

    const value = parseFloat(mervalMatch[1].replace(/\./g, '').replace(',', '.'));
    if (isNaN(value) || value < 100_000 || value > 10_000_000) return null;

    const varMatch = bodyText.match(/variación[:\s]*([+-]?\d{1,2}[.,]\d{1,2})%/i);
    const variation = varMatch ? parseFloat(varMatch[1].replace(',', '.')) : null;

    return {
      value: Math.round(value * 100) / 100,
      variation,
      source: 'Infobae',
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.warn('[mervalFetcher] Infobae scrape failed:', (err as Error).message);
    return null;
  }
}

/**
 * Fetch the MERVAL index, trying multiple sources in order.
 * Primary → Fallback A → Fallback B
 */
export async function fetchMerval(): Promise<MervalResult> {
  // Try BYMA first
  let result = await fetchBymaApi();
  if (result) return result;

  // Fallback: Rava
  result = await scrapeRava();
  if (result) return result;

  // Last resort: Infobae
  result = await scrapeInfobae();
  if (result) return result;

  throw new Error('All MERVAL sources failed');
}
