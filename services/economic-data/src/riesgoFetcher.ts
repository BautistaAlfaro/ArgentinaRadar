/**
 * Riesgo País + BCRA reserves fetcher.
 *
 * Riesgo País (sovereign risk spread in basis points):
 *   - Primary: Ámbito mercados API (free, no key)
 *   - Fallback: Infobae economía scrape
 *
 * BCRA reserves:
 *   - Primary: BCRA official API (free, public)
 *   - Fallback: Ámbito article scrape
 *
 * WHY THESE SOURCES:
 *   - Riesgo País: Ámbito's mercados.ambito.com is a clean, stable JSON API
 *   - BCRA reserves: The official BCRA API returns all principal variables
 *     including reserves (series ID 246). The old BCRA v2 REST API (410 Gone)
 *     and the static HTML page (data loaded via JS) were both unreliable.
 */

import axios from 'axios';
import * as cheerio from 'cheerio';

const REQUEST_TIMEOUT = 10_000;

export interface RiesgoPaisResult {
  /** Riesgo país in basis points */
  value: number;
  /** Variation vs previous close */
  variation: number | null;
  source: string;
  timestamp: string;
}

export interface BcraReservesResult {
  /** BCRA reserves in USD millions */
  value: number;
  source: string;
  timestamp: string;
}

// ─── Riesgo País ─────────────────────────────────────────────────

/**
 * Fetch riesgo país from Ámbito mercados API.
 *
 * Endpoint: GET https://mercados.ambito.com/riesgopais/variacion
 * Response: { ultimo: "429", fecha: "19-06-2026", variacion: "0,00%", ... }
 */
async function fetchAmbitoRiesgo(): Promise<RiesgoPaisResult | null> {
  try {
    const { data } = await axios.get(
      'https://mercados.ambito.com/riesgopais/variacion',
      {
        timeout: REQUEST_TIMEOUT,
        headers: {
          Accept: 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
      },
    );

    // Response: { ultimo: "429", fecha: "19-06-2026", variacion: "0,00%", class-variacion: "equal" }
    const valueStr: string | undefined = data.ultimo;
    const variationStr: string | undefined = data.variacion;

    if (!valueStr) {
      console.warn('[riesgoFetcher] Ámbito: missing "ultimo" field');
      return null;
    }

    const value = parseFloat(valueStr.replace(',', '.'));
    if (isNaN(value) || value < 100 || value > 100_000) {
      console.warn(
        `[riesgoFetcher] Ámbito: parsed value ${value} out of range`,
      );
      return null;
    }

    let variation: number | null = null;
    if (variationStr) {
      const parsed = parseFloat(variationStr.replace(',', '').replace('%', ''));
      if (!isNaN(parsed)) {
        variation = parsed;
      }
    }

    console.log(
      `[riesgoFetcher] Ámbito: Riesgo País=${value}, variation=${variation}`,
    );

    return {
      value: Math.round(value * 100) / 100,
      variation: variation != null ? Math.round(variation * 100) / 100 : null,
      source: 'Ámbito',
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.warn(
      '[riesgoFetcher] Ámbito riesgo país failed:',
      (err as Error).message,
    );
    return null;
  }
}

/**
 * Scrape riesgo país from Infobae economía (includes risk spread data).
 */
async function scrapeInfobaeRiesgo(): Promise<RiesgoPaisResult | null> {
  try {
    const { data: html } = await axios.get(
      'https://www.infobae.com/economia/',
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

    // Look for riesgo país value (typically 1000–3000 bps)
    const rpMatch = bodyText.match(
      /riesgo país[:\s]*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/i,
    );
    if (!rpMatch) return null;

    const value = parseFloat(
      rpMatch[1].replace(/\./g, '').replace(',', '.'),
    );
    if (isNaN(value) || value < 100 || value > 100_000) return null;

    const varMatch = bodyText.match(
      /variación[:\s]*([+-]?\d{1,3}[.,]?\d{0,2})/i,
    );
    const variation = varMatch
      ? parseFloat(varMatch[1].replace(',', '.'))
      : null;

    return {
      value: Math.round(value * 100) / 100,
      variation,
      source: 'Infobae',
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.warn(
      '[riesgoFetcher] Infobae riesgo país scrape failed:',
      (err as Error).message,
    );
    return null;
  }
}

/**
 * Fetch riesgo país from primary → fallback sources.
 */
export async function fetchRiesgoPais(): Promise<RiesgoPaisResult> {
  let result = await fetchAmbitoRiesgo();
  if (result) return result;

  result = await scrapeInfobaeRiesgo();
  if (result) return result;

  throw new Error('All riesgo país sources failed');
}

// ─── BCRA Reserves ───────────────────────────────────────────────

/**
 * Fetch BCRA reserves from the BCRA official public API.
 *
 * Endpoint: GET https://www.bcra.gob.ar/api/endpoints/principales-variables-ultimas.php
 *
 * This is the same API the BCRA website frontend uses to populate
 * the "Principales Variables" table. Series ID 246 = International Reserves.
 *
 * Response shape:
 * {
 *   success: true,
 *   series: {
 *     "246": { fecha: "2026-06-17", valor: 47503000 },
 *     ...
 *   }
 * }
 *
 * The raw value is in USD (47,503,000 for reserves). The label on the
 * BCRA site says "en millones de dólares", meaning 47,503,000 is read
 * as $47,503 million USD ($47.5B). We store the value divided by 1000
 * so it represents "millones de USD" as a sensible number (~47,503).
 */
async function fetchBcraApi(): Promise<BcraReservesResult | null> {
  try {
    const { data } = await axios.get(
      'https://www.bcra.gob.ar/api/endpoints/principales-variables-ultimas.php',
      {
        timeout: REQUEST_TIMEOUT,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'application/json',
        },
      },
    );

    if (!data?.success || !data?.series?.['246']) {
      console.warn(
        '[riesgoFetcher] BCRA API: unexpected response shape or missing series 246',
      );
      return null;
    }

    const rawValue: number = data.series['246'].valor;
    const fecha: string = data.series['246'].fecha;

    // The raw value is in USD (e.g., 47503000 = $47,503,000,000).
    // We divide by 1,000 to represent "millones de USD" (~47,503).
    // This makes the number human-readable at the application layer.
    const value = rawValue / 1000;

    if (isNaN(value) || value < 10_000 || value > 100_000) {
      console.warn(
        `[riesgoFetcher] BCRA API: parsed value ${value} out of expected range`,
      );
      return null;
    }

    console.log(
      `[riesgoFetcher] BCRA API: Reserves=${value}M USD (raw=${rawValue}), date=${fecha}`,
    );

    return {
      value: Math.round(value * 100) / 100,
      source: 'BCRA',
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.warn(
      '[riesgoFetcher] BCRA API failed:',
      (err as Error).message,
    );
    return null;
  }
}

/**
 * Scrape BCRA reserves from Ámbito news article.
 * Looks for mentions of BCRA reserve figures in recent articles.
 */
async function scrapeAmbitoReservas(): Promise<BcraReservesResult | null> {
  try {
    const { data: html } = await axios.get('https://www.ambito.com/economia/', {
      timeout: REQUEST_TIMEOUT,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html',
      },
    });

    const $ = cheerio.load(html);
    const bodyText = $('body').text();

    // Look for "reservas" + large number patterns
    // "reservas del BCRA se ubican en USD 47.500 millones"
    // "reservas internacionales alcanzan los USD 47.503 millones"
    const reserveMatch = bodyText.match(
      /reservas[^.]*?USD\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*(?:millones|M)/i,
    );
    if (!reserveMatch) {
      // Try simpler numeric pattern near "reservas" keyword
      const match = bodyText.match(
        /reservas[^0-9]*(\d{1,3}(?:\.\d{3}){2}(?:,\d{2})?)/i,
      );
      if (!match) return null;

      const value = parseFloat(
        match[1].replace(/\./g, '').replace(',', '.'),
      );
      if (isNaN(value) || value < 10_000 || value > 100_000) return null;

      return {
        value: Math.round(value * 100) / 100,
        source: 'Ámbito',
        timestamp: new Date().toISOString(),
      };
    }

    const value = parseFloat(
      reserveMatch[1].replace(/\./g, '').replace(',', '.'),
    );
    if (isNaN(value) || value < 10_000 || value > 100_000) return null;

    console.log(`[riesgoFetcher] Ámbito scraped: Reserves=${value}M USD`);

    return {
      value: Math.round(value * 100) / 100,
      source: 'Ámbito',
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.warn(
      '[riesgoFetcher] Ámbito reserves scrape failed:',
      (err as Error).message,
    );
    return null;
  }
}

/**
 * Fetch BCRA international reserves.
 * Primary → Fallback
 */
export async function fetchBcraReserves(): Promise<BcraReservesResult> {
  // Primary: BCRA official API (returns all principal variables)
  let result = await fetchBcraApi();
  if (result) return result;

  // Fallback: scrape Ámbito for reserves figure
  result = await scrapeAmbitoReservas();
  if (result) return result;

  throw new Error('All BCRA reserves sources failed');
}
