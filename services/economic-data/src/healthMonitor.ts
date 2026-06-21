/**
 * Stale data alerting for economic indicators.
 *
 * Tracks consecutive fetch failures per indicator type.
 * After 3 consecutive failures:
 *   - Marks the indicator as `stale` in the DB
 *   - Sends an alert via the Hermes bridge (POST /api/alerts)
 *
 * On a successful fetch, clears the stale flag.
 */

import { markStale, getIndicator } from './db.js';

interface FailureCounter {
  [indicatorType: string]: number;
}

const failureCounts: FailureCounter = {};

/** Hermes bridge URL — configurable via env */
const HERMES_ALERT_URL =
  process.env.HERMES_ALERT_URL ?? 'http://localhost:3005/api/alerts';

const MAX_FAILURES = 3;

/**
 * Record a failed fetch attempt for an indicator type.
 * If failures reach MAX_FAILURES, marks indicator as stale and sends alert.
 */
export async function recordFailure(type: string): Promise<void> {
  const current = (failureCounts[type] ?? 0) + 1;
  failureCounts[type] = current;

  console.log(`[healthMonitor] ${type}: failure ${current}/${MAX_FAILURES}`);

  if (current >= MAX_FAILURES) {
    console.error(`[healthMonitor] ${type}: marking as STALE after ${current} failures`);
    markStale(type, true);

    await sendAlert({
      level: 'warning',
      title: `⚠️ ${formatIndicatorName(type)} — Datos desactualizados`,
      message: `${formatIndicatorName(type)} no se actualiza tras ${current} intentos fallidos.`,
      indicator: type,
      failures: current,
    });
  }
}

/**
 * Record a successful fetch for an indicator type.
 * Resets the failure counter and clears the stale flag if previously stale.
 */
export async function recordSuccess(type: string): Promise<void> {
  failureCounts[type] = 0;

  const indicator = getIndicator(type);
  if (indicator && indicator.stale) {
    console.log(`[healthMonitor] ${type}: recovery — clearing stale flag`);
    markStale(type, false);

    await sendAlert({
      level: 'info',
      title: `✅ ${formatIndicatorName(type)} — Recuperado`,
      message: `${formatIndicatorName(type)} se actualizó correctamente después de estar desactualizado.`,
      indicator: type,
      failures: 0,
    });
  }
}

/**
 * Get the current failure count for an indicator type.
 */
export function getFailureCount(type: string): number {
  return failureCounts[type] ?? 0;
}

/**
 * Get the stale status of all known indicators.
 */
export function getStaleStatus(): Array<{ type: string; stale: boolean; failures: number }> {
  const types = ['dolar_blue', 'merval', 'riesgo_pais', 'reservas_bcra'];
  return types.map((type) => ({
    type,
    stale: getIndicator(type)?.stale === 1,
    failures: failureCounts[type] ?? 0,
  }));
}

// ─── Hermes alert bridge ─────────────────────────────────────────

interface AlertPayload {
  level: 'info' | 'warning' | 'error';
  title: string;
  message: string;
  indicator: string;
  failures: number;
}

async function sendAlert(payload: AlertPayload): Promise<void> {
  try {
    // Dynamic import to avoid requiring axios in the health monitor if not needed
    const { default: axios } = await import('axios');
    await axios.post(HERMES_ALERT_URL, payload, {
      timeout: 5_000,
      headers: { 'Content-Type': 'application/json' },
    });
    console.log(`[healthMonitor] Alert sent to Hermes: ${payload.title}`);
  } catch (err) {
    // If Hermes is not available, just log — don't cascade errors
    console.warn(`[healthMonitor] Failed to send alert to Hermes (${HERMES_ALERT_URL}):`, (err as Error).message);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

function formatIndicatorName(type: string): string {
  const names: Record<string, string> = {
    dolar_blue: 'Dólar Blue',
    merval: 'MERVAL',
    riesgo_pais: 'Riesgo País',
    reservas_bcra: 'Reservas BCRA',
  };
  return names[type] ?? type;
}
