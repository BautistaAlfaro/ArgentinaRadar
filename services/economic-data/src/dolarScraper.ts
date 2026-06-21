/**
 * Dólar blue scraper.
 *
 * Primary: DolarAPI (free, no scraping needed)
 * Fallback: DolarHoy.com (HTML scrape) + Ámbito API
 *
 * Averages rates from multiple sources. If one source fails, uses the
 * other and flags the result as `partial`.
 */

import axios from 'axios';
import * as cheerio from 'cheerio';

const REQUEST_TIMEOUT = 10_000; // 10 seconds

export interface DolarBlueResult {
  /** Compra (buy) rate in ARS */
  compra: number;
  /** Venta (sell) rate in ARS */
  venta: number;
  /** Source description */
  source: string;
  /** Whether one or more sources failed */
  partial: boolean;
  /** Timestamp of fetch */
  timestamp: string;
}

/**
 * Fetch dólar blue from DolarAPI (free, stable JSON API).
 * Returns null if the request fails.
 */
async function fetchDolarAPI(): Promise<{ compra: number; venta: number } | null> {
  try {
    const { data } = await axios.get('https://dolarapi.com/v1/dolares/blue', {
      timeout: REQUEST_TIMEOUT,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
    });

    // DolarAPI returns: { moneda, casa, nombre, compra, venta, fechaActualizacion }
    if (data && typeof data.compra === 'number' && typeof data.venta === 'number') {
      console.log(`[dolarScraper] DolarAPI: compra=${data.compra}, venta=${data.venta}`);
      return { compra: data.compra, venta: data.venta };
    }

    console.warn('[dolarScraper] DolarAPI: unexpected response shape');
    return null;
  } catch (err) {
    console.warn('[dolarScraper] DolarAPI failed:', (err as Error).message);
    return null;
  }
}

/**
 * Scrape dólar blue from DolarHoy.com.
 * Returns null if the request or parse fails.
 */
async function scrapeDolarHoy(): Promise<{ compra: number; venta: number } | null> {
  try {
    const { data: html } = await axios.get('https://dolarhoy.com/', {
      timeout: REQUEST_TIMEOUT,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
      },
    });

    const $ = cheerio.load(html);

    // DolarHoy typically uses elements like:
    // .compra .val or similar pattern for the blue rate section
    // We search broadly for "blue" related text and extract nearby values
    let compra: number | null = null;
    let venta: number | null = null;

    // Try common DolarHoy HTML patterns for blue rate
    // Pattern 1: sections with data atributtes or specific classes
    $('*').each((_i, el) => {
      const text = $(el).text().trim().toLowerCase();
      if (text.includes('blue')) {
        // Look for sibling or parent containers with price values
        const parent = $(el).closest('div, section, tr');
        const allText = parent.text();
        const matches = allText.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/g);
        if (matches && matches.length >= 2) {
          const parsed = matches.map((m) => parseFloat(m.replace(/\./g, '').replace(',', '.')));
          const valid = parsed.filter((n) => !isNaN(n) && n > 100 && n < 10000);
          if (valid.length >= 2) {
            // Usually compra is lower than venta
            valid.sort((a, b) => a - b);
            compra = compra ?? valid[0];
            venta = venta ?? valid[valid.length - 1];
          }
        }
      }
    });

    // Pattern 2: direct class-based selectors common in Argentine rate sites
    if (compra === null) {
      $('.compra, .buy, .blue-compra, .blue_compra, [class*="compra"]').each((_i, el) => {
        const txt = $(el).text().trim();
        const val = parseFloat(txt.replace(/[^0-9,]/g, '').replace(',', '.'));
        if (!isNaN(val) && val > 100 && val < 10000) {
          compra = compra ?? val;
        }
      });
    }

    if (venta === null) {
      $('.venta, .sell, .blue-venta, .blue_venta, [class*="venta"]').each((_i, el) => {
        const txt = $(el).text().trim();
        const val = parseFloat(txt.replace(/[^0-9,]/g, '').replace(',', '.'));
        if (!isNaN(val) && val > 100 && val < 10000) {
          venta = venta ?? val;
        }
      });
    }

    if (compra !== null && venta !== null) {
      console.log(`[dolarScraper] DolarHoy: compra=${compra}, venta=${venta}`);
      return { compra, venta };
    }

    console.warn('[dolarScraper] DolarHoy: could not parse rates from HTML');
    return null;
  } catch (err) {
    console.warn('[dolarScraper] DolarHoy scrape failed:', (err as Error).message);
    return null;
  }
}

/**
 * Fetch dólar blue from Ámbito API.
 * Returns null if the request or parse fails.
 */
async function fetchAmbitoApi(): Promise<{ compra: number; venta: number } | null> {
  try {
    // Ámbito has a JSON endpoint for dólar blue
    const { data } = await axios.get('https://api.ambito.com/dolar/blue', {
      timeout: REQUEST_TIMEOUT,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
    });

    // Ámbito API returns various structures; try common patterns
    let compra: number | null = null;
    let venta: number | null = null;

    // Pattern: { compra: 1234, venta: 1240 }
    if (typeof data.compra === 'number' && typeof data.venta === 'number') {
      compra = data.compra;
      venta = data.venta;
    } else if (data.blue && typeof data.blue.compra === 'number' && typeof data.blue.venta === 'number') {
      compra = data.blue.compra;
      venta = data.blue.venta;
    } else if (Array.isArray(data)) {
      // Array of rates
      const blue = data.find((d: { nombre?: string; codigo?: string }) =>
        d.nombre?.toLowerCase().includes('blue') || d.codigo === 'blue',
      );
      if (blue && blue.compra && blue.venta) {
        compra = blue.compra;
        venta = blue.venta;
      }
    }

    // Attempt parsing from nested structures
    if (compra === null) {
      const flat = JSON.stringify(data);
      const nums = [...flat.matchAll(/(\d{3,4}(?:[.,]\d{1,2})?)/g)].map((m) =>
        parseFloat(m[1].replace(',', '.')),
      );
      const valid = nums.filter((n) => n > 100 && n < 10000);
      if (valid.length >= 2) {
        valid.sort((a, b) => a - b);
        compra = compra ?? valid[0];
        venta = venta ?? valid[valid.length - 1];
      }
    }

    if (compra !== null && venta !== null) {
      console.log(`[dolarScraper] Ámbito: compra=${compra}, venta=${venta}`);
      return { compra, venta };
    }

    console.warn('[dolarScraper] Ámbito: unexpected response shape');
    return null;
  } catch (err) {
    console.warn('[dolarScraper] Ámbito API failed:', (err as Error).message);
    return null;
  }
}

/**
 * Fetch dólar blue from all available sources, averaging results.
 * Uses DolarAPI as primary (most stable), DolarHoy and Ámbito as fallbacks.
 */
export async function fetchDolarBlue(): Promise<DolarBlueResult> {
  const timestamp = new Date().toISOString();
  const sources: Array<{ name: string; compra: number; venta: number }> = [];

  // Try primary source (DolarAPI - free, stable)
  const dolarAPI = await fetchDolarAPI();
  if (dolarAPI) {
    sources.push({ name: 'DolarAPI', ...dolarAPI });
  }

  // Try fallback sources
  const dolarHoy = await scrapeDolarHoy();
  if (dolarHoy) {
    sources.push({ name: 'DolarHoy', ...dolarHoy });
  }

  const ambito = await fetchAmbitoApi();
  if (ambito) {
    sources.push({ name: 'Ámbito', ...ambito });
  }

  if (sources.length === 0) {
    throw new Error('All dólar blue sources failed');
  }

  // Average all available sources
  const compraAvg =
    sources.reduce((sum, s) => sum + s.compra, 0) / sources.length;
  const ventaAvg =
    sources.reduce((sum, s) => sum + s.venta, 0) / sources.length;

  const sourceNames = sources.map((s) => s.name).join(' + ');
  const partial = sources.length < 2;

  console.log(
    `[dolarScraper] Result: compra=${compraAvg.toFixed(2)}, venta=${ventaAvg.toFixed(2)}, ` +
      `sources=${sourceNames}${partial ? ' (partial)' : ''}`,
  );

  return {
    compra: Math.round(compraAvg * 100) / 100,
    venta: Math.round(ventaAvg * 100) / 100,
    source: sourceNames,
    partial,
    timestamp,
  };
}
