/**
 * Economic Data Service — Express server on port 3006.
 *
 * Endpoints:
 *   GET /api/economic        — All indicators
 *   GET /api/economic/:type  — Specific indicator (dolar, merval, riesgo, reservas)
 *   GET /health              — Service health + last fetch times
 *
 * Scheduled fetchers run on intervals:
 *   - Dólar blue: every 15 min during market hours
 *   - MERVAL: every hour during market hours
 *   - Riesgo País: daily at market close
 *   - BCRA reserves: daily at market close
 */

import express from 'express';
import { getDb, getAllIndicators, getIndicator, upsertIndicator, closeDb, type EconomicRow } from './db.js';
import { scheduleFetch, minutes, hours } from './schedulers.js';
import { fetchDolarBlue } from './dolarScraper.js';
import { fetchMerval } from './mervalFetcher.js';
import { fetchRiesgoPais, fetchBcraReserves } from './riesgoFetcher.js';
import { recordSuccess, recordFailure, getStaleStatus } from './healthMonitor.js';

const PORT = parseInt(process.env.PORT ?? '3006', 10);

interface FetchState {
  [indicator: string]: {
    lastRun: string | null;
    lastSuccess: string | null;
    status: 'ok' | 'error';
    error: string | null;
  };
}

const fetchState: FetchState = {
  dolar_blue: { lastRun: null, lastSuccess: null, status: 'ok', error: null },
  merval: { lastRun: null, lastSuccess: null, status: 'ok', error: null },
  riesgo_pais: { lastRun: null, lastSuccess: null, status: 'ok', error: null },
  reservas_bcra: { lastRun: null, lastSuccess: null, status: 'ok', error: null },
};

// ─── Scheduled fetch wrappers ─────────────────────────────────────

async function fetchAndStoreDolar(): Promise<void> {
  fetchState.dolar_blue.lastRun = new Date().toISOString();
  try {
    const result = await fetchDolarBlue();
    upsertIndicator('dolar_blue', result.compra, result.source, result.partial, false, {
      venta: result.venta,
      partial: result.partial,
    });
    await recordSuccess('dolar_blue');
    fetchState.dolar_blue.lastSuccess = result.timestamp;
    fetchState.dolar_blue.status = 'ok';
    fetchState.dolar_blue.error = null;
    console.log(
      `[economic] Dólar blue stored: compra=${result.compra}, venta=${result.venta}, source=${result.source}`,
    );
  } catch (err) {
    const msg = (err as Error).message;
    fetchState.dolar_blue.status = 'error';
    fetchState.dolar_blue.error = msg;
    await recordFailure('dolar_blue');
    console.error(`[economic] Failed to fetch dólar blue: ${msg}`);
  }
}

async function fetchAndStoreMerval(): Promise<void> {
  fetchState.merval.lastRun = new Date().toISOString();
  try {
    const result = await fetchMerval();
    upsertIndicator('merval', result.value, result.source, false, false, {
      variation: result.variation,
    });
    await recordSuccess('merval');
    fetchState.merval.lastSuccess = result.timestamp;
    fetchState.merval.status = 'ok';
    fetchState.merval.error = null;
    console.log(`[economic] MERVAL stored: ${result.value}, source=${result.source}`);
  } catch (err) {
    const msg = (err as Error).message;
    fetchState.merval.status = 'error';
    fetchState.merval.error = msg;
    await recordFailure('merval');
    console.error(`[economic] Failed to fetch MERVAL: ${msg}`);
  }
}

async function fetchAndStoreRiesgo(): Promise<void> {
  fetchState.riesgo_pais.lastRun = new Date().toISOString();
  try {
    const result = await fetchRiesgoPais();
    upsertIndicator('riesgo_pais', result.value, result.source, false, false, {
      variation: result.variation,
    });
    await recordSuccess('riesgo_pais');
    fetchState.riesgo_pais.lastSuccess = result.timestamp;
    fetchState.riesgo_pais.status = 'ok';
    fetchState.riesgo_pais.error = null;
    console.log(`[economic] Riesgo país stored: ${result.value}, source=${result.source}`);
  } catch (err) {
    const msg = (err as Error).message;
    fetchState.riesgo_pais.status = 'error';
    fetchState.riesgo_pais.error = msg;
    await recordFailure('riesgo_pais');
    console.error(`[economic] Failed to fetch riesgo país: ${msg}`);
  }
}

async function fetchAndStoreReservas(): Promise<void> {
  fetchState.reservas_bcra.lastRun = new Date().toISOString();
  try {
    const result = await fetchBcraReserves();
    upsertIndicator('reservas_bcra', result.value, result.source, false, false);
    await recordSuccess('reservas_bcra');
    fetchState.reservas_bcra.lastSuccess = result.timestamp;
    fetchState.reservas_bcra.status = 'ok';
    fetchState.reservas_bcra.error = null;
    console.log(`[economic] BCRA reserves stored: ${result.value}, source=${result.source}`);
  } catch (err) {
    const msg = (err as Error).message;
    fetchState.reservas_bcra.status = 'error';
    fetchState.reservas_bcra.error = msg;
    await recordFailure('reservas_bcra');
    console.error(`[economic] Failed to fetch BCRA reserves: ${msg}`);
  }
}

// ─── REST API ─────────────────────────────────────────────────────

const app = express();
app.use(express.json());

/**
 * Convert a raw DB row to a clean JSON response.
 */
function rowToJson(row: EconomicRow) {
  const metadata = row.metadata ? safeParseJson(row.metadata) : null;
  return {
    type: row.type as string,
    value: row.value,
    previousValue: row.previous_value,
    source: row.source,
    timestamp: row.timestamp,
    stale: row.stale === 1,
    partial: row.partial === 1,
    metadata,
  };
}

function safeParseJson(val: string): unknown {
  try {
    return JSON.parse(val);
  } catch {
    return val;
  }
}

/**
 * GET /api/economic — Return all economic indicators with fetch state.
 */
app.get('/api/economic', (_req, res) => {
  try {
    const rows = getAllIndicators();
    const indicators = rows.map(rowToJson);

    // Attach fetch state to each indicator
    const enriched = indicators.map((ind) => ({
      ...ind,
      fetchStatus: fetchState[ind.type as keyof typeof fetchState] ?? null,
    }));

    res.json({
      indicators: enriched,
      staleStatus: getStaleStatus(),
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch economic data', details: String(err) });
  }
});

/**
 * GET /api/economic/:type — Return a specific indicator.
 */
app.get('/api/economic/:type', (req, res) => {
  try {
    const type = req.params.type;

    // Map shorthand names to DB types
    const typeMap: Record<string, string> = {
      dolar: 'dolar_blue',
      dolar_blue: 'dolar_blue',
      merval: 'merval',
      riesgo: 'riesgo_pais',
      riesgo_pais: 'riesgo_pais',
      reservas: 'reservas_bcra',
      reservas_bcra: 'reservas_bcra',
    };

    const dbType = typeMap[type.toLowerCase()];
    if (!dbType) {
      res.status(400).json({
        error: `Unknown indicator type: ${type}. Use: dolar, merval, riesgo, reservas`,
      });
      return;
    }

    const row = getIndicator(dbType);
    if (!row) {
      res.status(404).json({
        error: `No data for indicator: ${type}`,
        type: dbType,
      });
      return;
    }

    res.json({
      ...rowToJson(row),
      fetchStatus: fetchState[dbType as keyof typeof fetchState] ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch indicator', details: String(err) });
  }
});

/**
 * GET /health — Service health + last fetch times.
 */
app.get('/health', (_req, res) => {
  try {
    const db = getDb();
    const indicatorCount = (
      db.prepare('SELECT COUNT(*) as count FROM economic_data').get() as { count: number }
    ).count;

    res.json({
      status: 'ok',
      uptime: process.uptime(),
      port: PORT,
      indicatorCount,
      lastFetches: {
        dolarBlue: fetchState.dolar_blue,
        merval: fetchState.merval,
        riesgoPais: fetchState.riesgo_pais,
        reservasBcra: fetchState.reservas_bcra,
      },
      staleStatus: getStaleStatus(),
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Health check failed', details: String(err) });
  }
});

// ─── Start Schedulers ─────────────────────────────────────────────

// Ensure DB initialized
getDb();

console.log('[economic] Starting scheduled fetchers...');

const schedulers = [
  scheduleFetch({
    name: 'dolar-blue',
    intervalMs: minutes(15),
    fetchFn: fetchAndStoreDolar,
  }),
  scheduleFetch({
    name: 'merval',
    intervalMs: hours(1),
    fetchFn: fetchAndStoreMerval,
  }),
  scheduleFetch({
    name: 'riesgo-pais',
    intervalMs: hours(6), // Check every 6h; only runs during close window
    fetchFn: fetchAndStoreRiesgo,
    dailyAtClose: true,
  }),
  scheduleFetch({
    name: 'reservas-bcra',
    intervalMs: hours(6),
    fetchFn: fetchAndStoreReservas,
    dailyAtClose: true,
  }),
];

// ─── Start Express ────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  console.log(`[economic] REST API listening on http://localhost:${PORT}`);
  console.log(`[economic]   GET /api/economic        — all indicators`);
  console.log(`[economic]   GET /api/economic/:type   — specific indicator (dolar, merval, riesgo, reservas)`);
  console.log(`[economic]   GET /health               — service health`);
  console.log(`[economic] Schedulers:`);
  console.log(`[economic]   Dólar blue  — every 15 min (market hours)`);
  console.log(`[economic]   MERVAL      — every 1 hour (market hours)`);
  console.log(`[economic]   Riesgo País — daily at market close`);
  console.log(`[economic]   BCRA Reserv — daily at market close`);
});

// ─── Graceful shutdown ────────────────────────────────────────────

function shutdown(): void {
  console.log('[economic] Shutting down gracefully...');
  schedulers.forEach((s) => s.stop());
  server.close(() => {
    closeDb();
    console.log('[economic] Goodbye');
    process.exit(0);
  });
  // Force exit after 5s
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
