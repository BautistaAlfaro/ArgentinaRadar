/**
 * Riesgo País + BCRA reserves fetcher.
 *
 * Riesgo País (sovereign risk spread in basis points):
 *   - Primary: Ámbito API
 *   - Fallback: Reuters scrape
 *
 * BCRA reserves:
 *   - Primary: BCRA API (BCRA estadísticas)
 *   - Fallback: Ámbito
 *
 * Both are refreshed daily at market close.
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
 * Fetch riesgo país from Ámbito API.
 */
async function fetchAmbitoRiesgo(): Promise<RiesgoPaisResult | null> {
  try {
    const { data } = await axios.get('https://api.ambito.com/dolar/riesgo-pais', {
      timeout: REQUEST_TIMEOUT,
      headers: {
        Accept: 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    });

    let value: number | null = null;
    let variation: number | null = null;

    const raw = data.data ?? data;
    if (raw.valor !== undefined || raw.value !== undefined) {
      value = raw.valor ?? raw.value;
      variation = raw.variacion ?? raw.variacionPorcentual ?? raw.change ?? null;
    } else if (raw.riesgoPais !== undefined || raw['riesgo-pais'] !== undefined) {
      const rp = raw.riesgoPais ?? raw['riesgo-pais'];
      value = rp.valor ?? rp.value ?? rp;
      variation = rp.variacion ?? rp.variacionPorcentual ?? null;
    }

    if (typeof value === 'number' && value > 0 && value < 100_000) {
      return {
        value: Math.round(value * 100) / 100,
        variation: variation != null ? Math.round(variation * 100) / 100 : null,
        source: 'Ámbito',
        timestamp: new Date().toISOString(),
      };
    }

    return null;
  } catch (err) {
    console.warn('[riesgoFetcher] Ámbito riesgo país failed:', (err as Error).message);
    return null;
  }
}

/**
 * Scrape riesgo país from Infobae economía (includes risk spread data).
 */
async function scrapeInfobaeRiesgo(): Promise<RiesgoPaisResult | null> {
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

    // Look for riesgo país value (typically 1000–3000 bps)
    const rpMatch = bodyText.match(/riesgo país[:\s]*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/i);
    if (!rpMatch) return null;

    const value = parseFloat(rpMatch[1].replace(/\./g, '').replace(',', '.'));
    if (isNaN(value) || value < 100 || value > 100_000) return null;

    const varMatch = bodyText.match(/variación[:\s]*([+-]?\d{1,3}[.,]?\d{0,2})/i);
    const variation = varMatch ? parseFloat(varMatch[1].replace(',', '.')) : null;

    return {
      value: Math.round(value * 100) / 100,
      variation,
      source: 'Infobae',
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.warn('[riesgoFetcher] Infobae riesgo país scrape failed:', (err as Error).message);
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
 * Fetch BCRA reserves from BCRA statistics API.
 */
async function fetchBcraApi(): Promise<BcraReservesResult | null> {
  try {
    // BCRA public estadísticas API
    const { data } = await axios.get(
      'https://www.bcra.gob.ar/PublicacionesEstadisticas/Reservas_internacionales.asp',
      {
        timeout: REQUEST_TIMEOUT,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html',
        },
      },
    );

    const $ = cheerio.load(data);
    const bodyText = $('body').text();

    // BCRA reserves in USD millions — typically $20,000M – $50,000M range
    const reserveMatch = bodyText.match(/(\d{2,3}(?:\.\d{3})*(?:,\d{2})?)\s*(?:millones|MM)/i);
    if (!reserveMatch) {
      // Try simpler number extraction
      const nums = [...bodyText.matchAll(/(\d{2,3}(?:\.\d{3}){2}(?:,\d{2})?)/g)]
        .map((m) => parseFloat(m[1].replace(/\./g, '').replace(',', '.')))
        .filter((n) => n > 10_000 && n < 100_000);
      if (nums.length > 0) {
        return {
          value: Math.round(nums[0] * 100) / 100,
          source: 'BCRA',
          timestamp: new Date().toISOString(),
        };
      }
      return null;
    }

    const value = parseFloat(reserveMatch[1].replace(/\./g, '').replace(',', '.'));
    if (isNaN(value) || value < 10_000 || value > 100_000) return null;

    return {
      value: Math.round(value * 100) / 100,
      source: 'BCRA',
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.warn('[riesgoFetcher] BCRA API failed:', (err as Error).message);
    return null;
  }
}

/**
 * Fetch BCRA reserves from Ámbito.
 */
async function fetchAmbitoReservas(): Promise<BcraReservesResult | null> {
  try {
    const { data } = await axios.get('https://api.ambito.com/reservas-bcra', {
      timeout: REQUEST_TIMEOUT,
      headers: {
        Accept: 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    });

    let value: number | null = null;
    const raw = data.data ?? data;

    if (raw.valor !== undefined || raw.value !== undefined) {
      value = raw.valor ?? raw.value;
    } else if (raw.totales) {
      // Historical series
      const last = Array.isArray(raw.totales) ? raw.totales[raw.totales.length - 1] : null;
      value = last?.valor ?? last?.value ?? null;
    }

    if (typeof value === 'number' && value > 10_000 && value < 100_000) {
      return {
        value: Math.round(value * 100) / 100,
        source: 'Ámbito',
        timestamp: new Date().toISOString(),
      };
    }

    return null;
  } catch (err) {
    console.warn('[riesgoFetcher] Ámbito reservas failed:', (err as Error).message);
    return null;
  }
}

/**
 * Fetch BCRA international reserves.
 */
export async function fetchBcraReserves(): Promise<BcraReservesResult> {
  let result = await fetchBcraApi();
  if (result) return result;

  result = await fetchAmbitoReservas();
  if (result) return result;

  throw new Error('All BCRA reserves sources failed');
}
