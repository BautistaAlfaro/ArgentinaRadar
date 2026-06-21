import type { Source } from './config.js';
import { getDb } from './db.js';
import { recordFailure } from './healthMonitor.js';

const RETRY_DELAYS_MS = [1_000, 5_000, 25_000];

export interface HttpClientResult {
  ok: boolean;
  status: number;
  body: string | null;
  error: string | null;
}

/**
 * Fetch a URL with retry logic. On HTTP 429 / 5xx, retries up to 3 times
 * with exponential backoff delays (1s / 5s / 25s). After all retries fail,
 * the source is marked as 'degraded' in the DB via healthMonitor.
 * Non-retryable errors (4xx except 429) fail immediately.
 */
export async function fetchWithRetry(
  url: string,
  source: Source,
  options?: { timeout?: number },
): Promise<HttpClientResult> {
  const timeout = options?.timeout ?? 30_000;
  let lastError: string | null = null;
  let lastStatus = 0;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      lastStatus = response.status;

      if (response.ok) {
        const body = await response.text();
        return { ok: true, status: response.status, body, error: null };
      }

      // Only retry on 429 (rate limit) and 5xx (server errors)
      if (response.status !== 429 && (response.status < 500 || response.status >= 600)) {
        const body = attempt < 1 ? await response.text().catch(() => '') : null;
        return {
          ok: false,
          status: response.status,
          body,
          error: `HTTP ${response.status} for ${url}`,
        };
      }

      // Retryable error — log and wait
      lastError = `HTTP ${response.status} for ${url} (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length + 1})`;
      console.warn(`[httpClient] Retrying: ${lastError}`);

      if (attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = `${msg} (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length + 1})`;
      console.warn(`[httpClient] Retrying: ${lastError}`);

      if (attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  // All attempts failed — record failure via health monitor
  recordFailure(source.name, lastError ?? 'Max retries exceeded');
  return { ok: false, status: lastStatus, body: null, error: lastError };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
