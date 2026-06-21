/**
 * Graceful Shutdown Manager — prevents infinite loops and hanging services.
 * 
 * Usage:
 *   import { onShutdown, createLoop, cleanup } from './shutdown.js';
 *   const { start, stop } = createLoop('autoPublish', runJob, 300000);
 *   start(); // runs immediately, then every 5min
 *   // SIGINT/SIGTERM automatically calls stop() and exits
 */

const CLEANUP_FNS: Array<() => void> = [];
let SHUTDOWN = false;
const MAX_LOOP_MS = 30 * 60 * 1000; // 30 min max per service
const SHUTDOWN_TIMEOUT = 5000;       // force exit after 5s if cleanup stalls

export function isShuttingDown(): boolean {
  return SHUTDOWN;
}

export function onShutdown(fn: () => void): void {
  CLEANUP_FNS.push(fn);
}

export function cleanup(): void {
  SHUTDOWN = true;
  for (const fn of CLEANUP_FNS) {
    try { fn(); } catch (e) { /* swallow — cleanup must not fail */ }
  }
}

// ─── Safe interval loop ────────────────────────────────────────────────
export interface LoopController {
  start: () => void;
  stop: () => void;
  runOnce: () => Promise<void>;
}

export function createLoop(
  name: string,
  fn: () => Promise<void>,
  intervalMs: number,
  options?: { runImmediately?: boolean; maxRuns?: number },
): LoopController {
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let runs = 0;
  const maxRuns = options?.maxRuns ?? Infinity;
  const startedAt = Date.now();

  async function runOnce(): Promise<void> {
    if (SHUTDOWN) return;
    if (running) return;
    if (runs >= maxRuns) {
      console.log(`[${name}] Max runs (${maxRuns}) reached — stopping`);
      stop();
      return;
    }
    if (Date.now() - startedAt > MAX_LOOP_MS) {
      console.log(`[${name}] Max runtime (${MAX_LOOP_MS}ms) exceeded — stopping`);
      stop();
      return;
    }
    running = true;
    try {
      await fn();
      runs++;
    } catch (err) {
      console.error(`[${name}] Error:`, (err as Error).message);
    } finally {
      running = false;
    }
  }

  function start(): void {
    if (SHUTDOWN) return;
    if (timer) return; // already started
    console.log(`[${name}] Loop started (interval: ${intervalMs}ms)`);
    if (options?.runImmediately !== false) {
      runOnce();
    }
    timer = setInterval(() => {
      if (SHUTDOWN) { stop(); return; }
      runOnce();
    }, intervalMs);
    timer.unref(); // don't prevent process exit
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
      console.log(`[${name}] Loop stopped after ${runs} runs`);
    }
  }

  onShutdown(stop);
  return { start, stop, runOnce };
}

// ─── Register process handlers ────────────────────────────────────────
function gracefulExit(signal: string): void {
  console.log(`\n[shutdown] Received ${signal} — cleaning up...`);
  cleanup();
  setTimeout(() => {
    console.log('[shutdown] Force exit after timeout');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT).unref();
  process.exit(0);
}

process.on('SIGINT', () => gracefulExit('SIGINT'));
process.on('SIGTERM', () => gracefulExit('SIGTERM'));
process.on('uncaughtException', (err) => {
  console.error('[shutdown] Uncaught exception:', err.message);
  cleanup();
  process.exit(1);
});
