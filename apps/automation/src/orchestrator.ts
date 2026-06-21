#!/usr/bin/env node

/**
 * ArgentinaRadar — Pipeline Orchestrator
 *
 * Starts ALL services in the correct dependency order, performing health
 * checks between each startup. Services are started as child processes
 * and tracked for lifecycle management.
 *
 * Order:
 *   1. news-ingestion  (3001) — RSS fetching + scraping
 *   2. geolocation     (3002) — location extraction
 *   3. ai-processor    (3013) — NER + embeddings + filtering
 *   4. event-detector  (3008) — event clustering
 *   5. twitter-publisher (3004) — Bluesky + Twitter publishing
 *   6. hermes-bridge   (3005) — Telegram bot + approval workflow
 *   7. alerts          (3007) — weather, earthquakes, fires, flights
 *   8. economic-data   (3006) — dólar blue, MERVAL, riesgo país
 *
 * Usage:
 *   npx tsx src/orchestrator.ts
 *   npx tsx src/orchestrator.ts --parallel   # start all at once
 *
 * Environment:
 *   SKIP_HEALTH_CHECKS=1   — bypass health checks (fast startup)
 *   PROJECT_ROOT           — override project root (default: auto-detect)
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Project root
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ServiceDef {
  name: string;
  port: number;
  /** Shell command to start the service (relative to the service dir). */
  cwd: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface ServiceState {
  def: ServiceDef;
  process: ChildProcess | null;
  started: boolean;
  healthy: boolean;
}

// ---------------------------------------------------------------------------
// Service definitions
// ---------------------------------------------------------------------------

const SERVICES: ServiceDef[] = [
  {
    name: 'news-ingestion',
    port: 3001,
    cwd: resolve(PROJECT_ROOT, 'services/news-ingestion'),
    command: 'npx',
    args: ['tsx', 'src/index.ts'],
  },
  {
    name: 'geolocation',
    port: 3002,
    cwd: resolve(PROJECT_ROOT, 'services/geolocation'),
    command: 'npx',
    args: ['tsx', 'src/server.ts'],
  },
  {
    name: 'ai-processor',
    port: 3013,
    cwd: resolve(PROJECT_ROOT, 'services/ai-processor'),
    command: 'python',
    args: ['-m', 'uvicorn', 'src.server:app', '--host', '0.0.0.0', '--port', '3013'],
    env: { PORT: '3013' },
  },
  {
    name: 'event-detector',
    port: 3008,
    cwd: resolve(PROJECT_ROOT, 'services/event-detector'),
    command: 'npx',
    args: ['tsx', 'src/server.ts'],
  },
  {
    name: 'twitter-publisher',
    port: 3004,
    cwd: resolve(PROJECT_ROOT, 'services/twitter-publisher'),
    command: 'npx',
    args: ['tsx', 'src/index.ts'],
  },
  {
    name: 'hermes-bridge',
    port: 3005,
    cwd: resolve(PROJECT_ROOT, 'services/hermes-bridge'),
    command: 'python',
    args: ['-m', 'uvicorn', 'src.server:app', '--host', '0.0.0.0', '--port', '3005'],
    env: { PORT: '3005' },
  },
  {
    name: 'alerts',
    port: 3007,
    cwd: resolve(PROJECT_ROOT, 'services/alerts'),
    command: 'npx',
    args: ['tsx', 'src/server.ts'],
  },
  {
    name: 'economic-data',
    port: 3006,
    cwd: resolve(PROJECT_ROOT, 'services/economic-data'),
    command: 'npx',
    args: ['tsx', 'src/server.ts'],
  },
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const states = new Map<string, ServiceState>();
const runningProcesses: ChildProcess[] = [];
let shuttingDown = false;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Print a bordered section header. */
function logSection(title: string): void {
  const line = '═'.repeat(Math.max(40, title.length + 4));
  console.log(`\n${line}`);
  console.log(`  ${title}`);
  console.log(`${line}\n`);
}

/** Format elapsed time. */
function elapsed(start: number): string {
  const secs = ((Date.now() - start) / 1000).toFixed(1);
  return `${secs}s`;
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

async function checkHealth(port: number, retries: number, name: string): Promise<boolean> {
  const url = `http://127.0.0.1:${port}/health`;
  const timeoutMs = 5_000;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (resp.ok) {
        let body: unknown;
        try {
          body = await resp.json() as Record<string, unknown>;
        } catch {
          // non-JSON response is still OK if status is 2xx
        }
        const status = body && typeof body === 'object' && 'status' in (body as Record<string, unknown>)
          ? (body as Record<string, unknown>).status
          : 'ok';

        console.log(`  ✓ ${name} health check passed (attempt ${attempt}) — status=${status}`);
        return true;
      }

      console.warn(`  ⚠ ${name} returned HTTP ${resp.status} (attempt ${attempt}/${retries})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < retries) {
        console.warn(`  ⏳ ${name} not ready yet (attempt ${attempt}/${retries}): ${msg}`);
      } else {
        console.error(`  ✗ ${name} health check FAILED after ${retries} attempts: ${msg}`);
      }
    }

    if (attempt < retries) {
      await sleep(3_000);
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Start a single service
// ---------------------------------------------------------------------------

async function startService(def: ServiceDef): Promise<boolean> {
  const state: ServiceState = { def, process: null, started: false, healthy: false };
  states.set(def.name, state);

  console.log(`\n▶ Starting ${def.name} on port ${def.port}...`);

  return new Promise<boolean>((resolvePromise) => {
    const env: Record<string, string | undefined> = {
      ...process.env as Record<string, string>,
      PORT: String(def.port),
      ...def.env,
    };

    const child = spawn(def.command, def.args, {
      cwd: def.cwd,
      env: env as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    state.process = child;
    runningProcesses.push(child);

    child.stdout?.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n').filter(Boolean)) {
        console.log(`  [${def.name}] ${line}`);
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n').filter(Boolean)) {
        // Python uvicorn logs to stderr
        console.log(`  [${def.name}] ${line}`);
      }
    });

    child.on('error', (err) => {
      console.error(`  ✗ [${def.name}] Process error: ${err.message}`);
      state.started = false;
      resolvePromise(false);
    });

    child.on('exit', (code) => {
      if (!shuttingDown) {
        console.warn(`  ⚠ [${def.name}] Exited with code ${code}`);
      }
      state.started = false;
      state.healthy = false;
      const idx = runningProcesses.indexOf(child);
      if (idx >= 0) runningProcesses.splice(idx, 1);
    });

    // Give the service a moment to start before health check
    setTimeout(async () => {
      state.started = true;

      if (process.env.SKIP_HEALTH_CHECKS === '1') {
        console.log(`  → ${def.name} started (health checks skipped)`);
        state.healthy = true;
        resolvePromise(true);
        return;
      }

      const healthy = await checkHealth(def.port, 3, def.name);
      state.healthy = healthy;

      if (!healthy) {
        console.warn(`  ⚠ ${def.name} is running but health check failed — continuing anyway`);
        // We don't fail the pipeline; the service may still be initializing
      }

      resolvePromise(true);
    }, 3_000);
  });
}

// ---------------------------------------------------------------------------
// Stop all services
// ---------------------------------------------------------------------------

function stopAll(): void {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log('\n═══════════════════════════════════════');
  console.log('  Shutting down all services...');
  console.log('═══════════════════════════════════════');

  // Reverse order for shutdown
  for (const child of [...runningProcesses].reverse()) {
    try {
      child.kill('SIGTERM');
    } catch {
      // process may already be dead
    }
  }

  // Force kill after 5 seconds
  setTimeout(() => {
    for (const child of runningProcesses) {
      if (!child.killed) {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }
    }
    process.exit(0);
  }, 5_000);
}

// ---------------------------------------------------------------------------
// Print service table
// ---------------------------------------------------------------------------

function printStatusTable(startTime: number): void {
  const total = SERVICES.length;
  const healthy = Array.from(states.values()).filter((s) => s.healthy).length;
  const running = Array.from(states.values()).filter((s) => s.started).length;

  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  ArgentinaRadar — Pipeline Status');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total time: ${elapsed(startTime)}`);
  console.log(`  Services:   ${healthy}/${total} healthy, ${running}/${total} running`);
  console.log('');

  for (const def of SERVICES) {
    const state = states.get(def.name);
    const status = state?.healthy ? '✓ up' : state?.started ? '⚠ starting' : '✗ down';
    const proc = state?.process;
    const pid = proc && !proc.killed ? proc.pid : '-';
    console.log(`  ${status.padEnd(12)} ${def.name.padEnd(22)} port ${String(def.port).padEnd(5)} pid ${pid}`);
  }

  console.log('');
  console.log('  Frontend: http://localhost:5173');
  console.log('  Admin:    http://localhost:5173/admin');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const startTime = Date.now();
  const args = process.argv.slice(2);
  const parallelMode = args.includes('--parallel');

  console.log('');
  console.log('███████████████████████████████████████████████████████████████');
  console.log('  ArgentinaRadar — Pipeline Orchestrator');
  console.log('███████████████████████████████████████████████████████████████');
  console.log(`  Project root: ${PROJECT_ROOT}`);
  console.log(`  Mode:         ${parallelMode ? 'PARALLEL' : 'SEQUENTIAL'}`);
  console.log(`  Services:     ${SERVICES.length}`);
  console.log('███████████████████████████████████████████████████████████████\n');

  // ── Register shutdown handlers ──────────────────────────────────
  process.on('SIGINT', stopAll);
  process.on('SIGTERM', stopAll);
  process.on('uncaughtException', (err) => {
    console.error('[orchestrator] Uncaught exception:', err);
    stopAll();
  });

  if (parallelMode) {
    // ── PARALLEL mode: start everything at once ───────────────────
    logSection('Starting all services in parallel');

    const promises = SERVICES.map((def) => startService(def));
    await Promise.all(promises);

    // Wait a bit for everything to settle
    await sleep(2_000);

    printStatusTable(startTime);
    console.log('  ✓ All services started in parallel mode');
    console.log('  Press Ctrl+C to stop all services\n');
  } else {
    // ── SEQUENTIAL mode: one by one with health checks ───────────
    logSection('Starting services sequentially');

    for (const def of SERVICES) {
      const t0 = Date.now();
      const ok = await startService(def);

      if (ok) {
        console.log(`  ✓ ${def.name} ready in ${elapsed(t0)}`);
      } else {
        console.warn(`  ⚠ ${def.name} may not be fully ready (${elapsed(t0)})`);
      }
    }

    printStatusTable(startTime);
    console.log('  ✓ Pipeline is running');
    console.log('  Press Ctrl+C to stop all services\n');
  }

  // ── Keep alive — wait forever ──────────────────────────────────
  await new Promise<void>((_) => {
    // The process stays alive via the running child processes.
    // We just hang here until SIGINT/SIGTERM.
  });
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error('[orchestrator] Fatal error:', err);
  stopAll();
  process.exit(1);
});
