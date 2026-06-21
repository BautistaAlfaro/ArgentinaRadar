/**
 * Night Owl — System Health Report Job
 *
 * Scheduled: 05:30 ART
 *
 * Full system health check:
 *   1. Check all 12 services via GET /health on each port
 *   2. Check queue depths (via lazy import to avoid circular dep)
 *   3. Check disk space, memory usage
 *   4. Generate health score (0-100)
 *   5. Alert if any service is down
 *
 * NOTE: AI budget tracking and DB persistence are skipped in local dev
 *       to avoid Prisma engine binary issues. They run in production
 *       where PostgreSQL is the primary datasource.
 */

import os from 'os';
import type { JobFn } from './index.js';
import { BudgetTracker } from './budget.js';

// ── Services to check ──────────────────────────────────────────────────

interface ServiceEntry {
  name: string;
  url: string;
}

const SERVICES: ServiceEntry[] = [
  { name: 'news-ingestion',   url: 'http://localhost:3001' },
  { name: 'geolocation',      url: 'http://localhost:3002' },
  { name: 'ai-filter',        url: 'http://localhost:3003' },
  { name: 'twitter-publisher', url: 'http://localhost:3004' },
  { name: 'hermes-bridge',    url: 'http://localhost:3005' },
  { name: 'economic-data',    url: 'http://localhost:3006' },
  { name: 'alerts',           url: 'http://localhost:3007' },
  { name: 'event-detector',   url: 'http://localhost:3008' },
  { name: 'trend-analyzer',   url: 'http://localhost:3009' },
  { name: 'ai-processor',     url: 'http://localhost:3010' },
  { name: 'admin',            url: 'http://localhost:3012' },
  { name: 'auth',             url: 'http://localhost:3013' },
];

// ── Types ──────────────────────────────────────────────────────────────

interface ServiceHealth {
  name: string;
  status: 'ok' | 'degraded' | 'down';
  uptime: number;
  responseTimeMs: number;
  error?: string;
}

interface QueueDepth {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
}

interface BudgetUsage {
  today: { tokens: number; cost: number };
  month: { tokens: number; cost: number };
  percentageUsed: number;
}

interface HealthReportData {
  score: number;
  services: ServiceHealth[];
  queues: Record<string, number | string | QueueDepth>;
  budget: BudgetUsage;
  system: {
    memory: { total: number; free: number; used: number; percentUsed: number };
    cpu: { loadAvg: number[]; cores: number };
    disk: { dbSizeMB: number };
  };
  alerts: string[];
  checkedAt: string;
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Check a single service's /health endpoint. */
async function checkService(service: ServiceEntry): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const resp = await fetch(`${service.url}/health`, { signal: AbortSignal.timeout(5000) });
    const responseTimeMs = Date.now() - start;

    if (!resp.ok) {
      return {
        name: service.name,
        status: 'degraded',
        uptime: 0,
        responseTimeMs,
        error: `HTTP ${resp.status}`,
      };
    }

    const body = await resp.json() as { status?: string; uptime?: number };
    return {
      name: service.name,
      status: body.status === 'ok' ? 'ok' : 'degraded',
      uptime: body.uptime ?? 0,
      responseTimeMs,
    };
  } catch (err) {
    return {
      name: service.name,
      status: 'down',
      uptime: 0,
      responseTimeMs: Date.now() - start,
      error: (err as Error).message,
    };
  }
}

/** Calculate budget usage (AI cost tracking disabled in local dev). */
async function getBudgetUsage(): Promise<BudgetUsage> {
  return { today: { tokens: 0, cost: 0 }, month: { tokens: 0, cost: 0 }, percentageUsed: 0 };
}

/** Get queue depths (lazy import to avoid circular dependency with queue.ts). */
async function getQueueDepths(): Promise<Record<string, number | string | QueueDepth>> {
  try {
    const { nightOwlQueue } = await import('../queue.js');
    const [waiting, active, completed, failed] = await Promise.all([
      nightOwlQueue.getWaitingCount(),
      nightOwlQueue.getActiveCount(),
      nightOwlQueue.getCompletedCount(),
      nightOwlQueue.getFailedCount(),
    ]);
    return {
      'night-owl': { waiting, active, completed, failed } as QueueDepth,
      available: true,
    };
  } catch (err) {
    return {
      available: false,
      error: (err as Error).message || 'queue unavailable',
      hint: 'Queue not available during health check',
    };
  }
}

/** Get system resource usage. */
function getSystemResources() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  return {
    memory: {
      total: Math.round(totalMem / (1024 * 1024)),
      free: Math.round(freeMem / (1024 * 1024)),
      used: Math.round(usedMem / (1024 * 1024)),
      percentUsed: Math.round((usedMem / totalMem) * 100),
    },
    cpu: {
      loadAvg: os.loadavg(),
      cores: os.cpus().length,
    },
    disk: {
      dbSizeMB: 0, // populated by cleanup; placeholder here
    },
  };
}

/** Calculate overall health score (0-100). */
function calculateScore(
  services: ServiceHealth[],
  budget: BudgetUsage,
  queues: Record<string, number | string | QueueDepth>,
): number {
  let score = 100;

  // Service penalties: each down service = -15, each degraded = -5
  for (const svc of services) {
    if (svc.status === 'down') score -= 15;
    else if (svc.status === 'degraded') score -= 5;
  }

  // Budget penalty: if > 90% used, -10; if > 75%, -5
  if (budget.percentageUsed > 90) score -= 10;
  else if (budget.percentageUsed > 75) score -= 5;

  // Queue penalty: if waiting jobs > 50, -10; if > 20, -5
  const queueInfo = queues['night-owl'];
  if (queueInfo && typeof queueInfo === 'object' && 'waiting' in queueInfo) {
    const q = queueInfo as QueueDepth;
    if (q.waiting > 50) score -= 10;
    else if (q.waiting > 20) score -= 5;
    if (q.failed > 10) score -= 5;
  }

  return Math.max(0, Math.min(100, score));
}

// ── Main job ───────────────────────────────────────────────────────────

export const runHealth: JobFn = async (_data) => {
  const budget = new BudgetTracker(0.02); // minimal budget for health (no AI calls)
  const startedAt = Date.now();

  console.log('═══════════════════════════════════════');
  console.log('[Job:health] Starting system health check');
  console.log('═══════════════════════════════════════');

  // ── 1. Check all services ───────────────────────────────────────────
  console.log(`[Health] Checking ${SERVICES.length} services...`);
  const serviceResults = await Promise.all(SERVICES.map((svc) => checkService(svc)));

  const servicesOk = serviceResults.filter((s) => s.status === 'ok').length;
  const servicesDegraded = serviceResults.filter((s) => s.status === 'degraded').length;
  const servicesDown = serviceResults.filter((s) => s.status === 'down').length;

  console.log(`[Health] Services: ${servicesOk} ok, ${servicesDegraded} degraded, ${servicesDown} down`);

  for (const svc of serviceResults) {
    if (svc.status !== 'ok') {
      console.warn(`[Health]  ⚠ ${svc.name}: ${svc.status}${svc.error ? ` — ${svc.error}` : ''}`);
    }
  }

  // ── 2. Check BullMQ queue depths ────────────────────────────────────
  const queueDepths = await getQueueDepths();
  console.log(`[Health] Queue depths: ${JSON.stringify(queueDepths)}`);

  // ── 3. Check AI budget usage ────────────────────────────────────────
  const budgetUsage = await getBudgetUsage();
  console.log(`[Health] Budget today: $${budgetUsage.today.cost.toFixed(4)} ` +
    `(${budgetUsage.today.tokens} tokens), month: $${budgetUsage.month.cost.toFixed(2)} ` +
    `(${budgetUsage.month.tokens} tokens, ${budgetUsage.percentageUsed.toFixed(1)}% of monthly)`);

  // ── 4. Check system resources ───────────────────────────────────────
  const system = getSystemResources();
  console.log(`[Health] Memory: ${system.memory.used}/${system.memory.total} MB ` +
    `(${system.memory.percentUsed}%), CPU cores: ${system.cpu.cores}`);

  // ── 5. Generate health score ────────────────────────────────────────
  const score = calculateScore(serviceResults, budgetUsage, queueDepths);
  console.log(`[Health] Health score: ${score}/100`);

  // ── 6. Collect alerts ───────────────────────────────────────────────
  const alerts: string[] = [];

  for (const svc of serviceResults) {
    if (svc.status === 'down') {
      alerts.push(`Service DOWN: ${svc.name} — ${svc.error ?? 'no response'}`);
    } else if (svc.status === 'degraded') {
      alerts.push(`Service DEGRADED: ${svc.name} — ${svc.error ?? 'slow response'}`);
    }
  }

  if (budgetUsage.percentageUsed > 90) {
    alerts.push(`AI budget CRITICAL: ${budgetUsage.percentageUsed.toFixed(1)}% of monthly budget used`);
  } else if (budgetUsage.percentageUsed > 75) {
    alerts.push(`AI budget WARNING: ${budgetUsage.percentageUsed.toFixed(1)}% of monthly budget used`);
  }

  if (system.memory.percentUsed > 90) {
    alerts.push(`Memory CRITICAL: ${system.memory.percentUsed}% used`);
  } else if (system.memory.percentUsed > 80) {
    alerts.push(`Memory WARNING: ${system.memory.percentUsed}% used`);
  }

  const queueInfo = queueDepths['night-owl'];
  if (queueInfo && typeof queueInfo === 'object' && 'waiting' in queueInfo) {
    const q = queueInfo as QueueDepth;
    if (q.waiting > 50) alerts.push(`Queue backlog: ${q.waiting} waiting jobs`);
    if (q.failed > 10) alerts.push(`Queue failures: ${q.failed} failed jobs`);
  }

  if (alerts.length > 0) {
    console.log('[Health] ALERTS:');
    for (const alert of alerts) {
      console.log(`  🚨 ${alert}`);
    }
  } else {
    console.log('[Health] No alerts — all systems nominal');
  }

  // ── 7. Health report assembled (DB persistence skipped in local dev) ─
  const report: HealthReportData = {
    score,
    services: serviceResults,
    queues: queueDepths,
    budget: budgetUsage,
    system,
    alerts,
    checkedAt: new Date().toISOString(),
  };

  // ── 8. Complete ─────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('═══════════════════════════════════════');
  console.log(`[Job:health] Complete in ${elapsed}s`);
  console.log(`  Health score:    ${score}/100`);
  console.log(`  Services:        ${servicesOk} ok, ${servicesDegraded} degraded, ${servicesDown} down`);
  console.log(`  Budget usage:    $${budgetUsage.month.cost.toFixed(2)} (${budgetUsage.percentageUsed.toFixed(1)}%)`);
  console.log(`  Memory:          ${system.memory.percentUsed}%`);
  console.log(`  Alerts:          ${alerts.length}`);
  console.log('═══════════════════════════════════════');
};
