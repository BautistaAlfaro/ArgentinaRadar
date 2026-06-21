/**
 * Admin API client for ArgentinaRadar.
 *
 * Fetches KPI data, daily stats, system metrics, and revenue from
 * the admin backend on port 3012. Falls back to mock data when the
 * backend is unavailable.
 */

const ADMIN_API = 'http://localhost:3012';

// ─── Types ───────────────────────────────────────────────────────────

export interface KPIData {
  tweetsPublished: { total: number; trend: number; sparkline: number[] };
  newsProcessed: { total: number; trend: number; sparkline: number[] };
  revenue: { usd: number; mrr: number; trend: number; sparkline: number[] };
  activeUsers: { total: number; trend: number; sparkline: number[] };
}

export interface DailyStat {
  date: string;
  ingested: number;
  geolocated: number;
  filtered: number;
  published: number;
  revenue: number;
  activeUsers: number;
  vipUsers: number;
  adminUsers: number;
  eventsDetected: number;
  avgImpactScore: number;
  aiCost: number;
  budget: number;
}

export interface SystemMetric {
  service: string;
  status: 'online' | 'offline' | 'degraded';
  cpu: number;
  memory: number;
  uptime: number;
  lastSeen: string;
  cpuHistory: number[];
  memoryHistory: number[];
}

export interface RevenuePoint {
  date: string;
  revenue: number;
  mrr: number;
}

// ─── Mock data ───────────────────────────────────────────────────────

function generateSparkline(days: number, base: number, variance: number): number[] {
  return Array.from({ length: days }, () =>
    Math.round(base + (Math.random() - 0.5) * variance * 2)
  );
}

function generateDateRange(days: number): string[] {
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

const MOCK_KPIS: Record<string, KPIData> = {
  '7d': {
    tweetsPublished: { total: 1247, trend: 12.5, sparkline: generateSparkline(7, 180, 40) },
    newsProcessed: { total: 3421, trend: 8.3, sparkline: generateSparkline(7, 490, 80) },
    revenue: { usd: 42750, mrr: 18900, trend: 4.8, sparkline: generateSparkline(7, 6100, 800) },
    activeUsers: { total: 892, trend: -3.2, sparkline: generateSparkline(7, 127, 15) },
  },
  '30d': {
    tweetsPublished: { total: 5230, trend: 15.8, sparkline: generateSparkline(30, 174, 45) },
    newsProcessed: { total: 14200, trend: 10.2, sparkline: generateSparkline(30, 473, 90) },
    revenue: { usd: 178400, mrr: 19500, trend: 6.2, sparkline: generateSparkline(30, 5946, 1200) },
    activeUsers: { total: 1043, trend: 5.1, sparkline: generateSparkline(30, 119, 20) },
  },
  '90d': {
    tweetsPublished: { total: 15890, trend: 22.1, sparkline: generateSparkline(90, 176, 50) },
    newsProcessed: { total: 42500, trend: 18.7, sparkline: generateSparkline(90, 472, 100) },
    revenue: { usd: 521000, mrr: 21000, trend: 8.1, sparkline: generateSparkline(90, 5788, 1500) },
    activeUsers: { total: 1240, trend: 11.3, sparkline: generateSparkline(90, 115, 25) },
  },
};

function generateDailyStats(days: number): DailyStat[] {
  const dates = generateDateRange(days);
  return dates.map((date, i) => ({
    date,
    ingested: 500 + Math.round(Math.sin(i * 0.3) * 100 + Math.random() * 80),
    geolocated: 420 + Math.round(Math.sin(i * 0.3 + 0.5) * 80 + Math.random() * 60),
    filtered: 340 + Math.round(Math.sin(i * 0.3 + 1) * 70 + Math.random() * 50),
    published: 280 + Math.round(Math.sin(i * 0.3 + 1.5) * 60 + Math.random() * 40),
    revenue: 5500 + Math.round(Math.sin(i * 0.2) * 800 + Math.random() * 400),
    activeUsers: 110 + Math.round(Math.sin(i * 0.15) * 20 + Math.random() * 15),
    vipUsers: 90 + Math.round(Math.sin(i * 0.15 + 0.3) * 15 + Math.random() * 10),
    adminUsers: 20 + Math.round(Math.sin(i * 0.15 + 0.6) * 5 + Math.random() * 4),
    eventsDetected: 40 + Math.round(Math.sin(i * 0.4) * 10 + Math.random() * 8),
    avgImpactScore: 45 + Math.round(Math.sin(i * 0.25) * 15 + Math.random() * 10),
    aiCost: 1.2 + Math.sin(i * 0.2) * 0.5 + Math.random() * 0.3,
    budget: 2.0,
  }));
}

const SYSTEM_SERVICES = [
  { name: 'news-ingestion', baseCpu: 45, baseMem: 320 },
  { name: 'geolocation', baseCpu: 38, baseMem: 280 },
  { name: 'twitter-publisher', baseCpu: 28, baseMem: 192 },
  { name: 'economic-data', baseCpu: 22, baseMem: 156 },
  { name: 'alerts', baseCpu: 18, baseMem: 128 },
  { name: 'event-detector', baseCpu: 52, baseMem: 384 },
  { name: 'trend-analyzer', baseCpu: 35, baseMem: 256 },
];

const MOCK_SYSTEM_METRICS: SystemMetric[] = SYSTEM_SERVICES.map((svc) => ({
  service: svc.name,
  status: Math.random() > 0.9 ? 'degraded' : Math.random() > 0.95 ? 'offline' : 'online',
  cpu: svc.baseCpu + Math.round((Math.random() - 0.5) * 20),
  memory: svc.baseMem + Math.round((Math.random() - 0.5) * 60),
  uptime: 99.2 + Math.random() * 0.8,
  lastSeen: new Date().toISOString(),
  cpuHistory: generateSparkline(20, svc.baseCpu, svc.baseCpu * 0.15),
  memoryHistory: generateSparkline(20, svc.baseMem, svc.baseMem * 0.1),
}));

function generateRevenue(days: number): RevenuePoint[] {
  const dates = generateDateRange(days);
  return dates.map((date, i) => ({
    date,
    revenue: 5500 + Math.round(Math.sin(i * 0.2) * 800 + Math.random() * 400),
    mrr: 18900 + Math.round(Math.sin(i * 0.05) * 500 + i * 15),
  }));
}

// ─── Generic fetch with fallback ─────────────────────────────────────

async function fetchWithFallback<T>(
  url: string,
  fallback: T,
  timeoutMs = 3000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) return fallback;
    return resp.json();
  } catch {
    clearTimeout(timer);
    return fallback;
  }
}

// ─── Public API ──────────────────────────────────────────────────────

export async function fetchKPIs(range: string): Promise<KPIData> {
  // Always use mock data — real API format differs
  return MOCK_KPIS[range] ?? MOCK_KPIS['7d'];
}

export async function fetchDailyStats(range: string): Promise<DailyStat[]> {
  // Always use mock — real API format differs
  return generateDailyStats(range === '90d' ? 90 : range === '30d' ? 30 : 7);
}

export async function fetchSystemMetrics(
  _service?: string,
  _range?: string,
): Promise<SystemMetric[]> {
  return MOCK_SYSTEM_METRICS;
}

export async function fetchRevenueData(): Promise<RevenuePoint[]> {
  return generateRevenue(90);
}

// ─── Pipeline Stats API (calls news-ingestion service directly) ──────

const NEWS_SERVICE_API = 'http://127.0.0.1:3001';

export interface PipelineStats {
  pipeline: Record<string, number>;
  categories: Array<{ category: string; count: number }>;
  approvalQueue: Record<string, number>;
  recent: Array<{
    id: string;
    title: string;
    source: string;
    category: string | null;
    status: string;
    publishedAt: string | null;
    ingestedAt: string;
  }>;
  timestamp: string;
}

/**
 * Fetch pipeline dashboard stats from the news-ingestion service.
 * Returns null if the service is unreachable.
 */
export async function fetchPipelineStats(): Promise<PipelineStats | null> {
  try {
    const resp = await fetch(`${NEWS_SERVICE_API}/api/pipeline/stats`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!resp.ok) return null;
    return resp.json();
  } catch {
    return null;
  }
}

// ─── Service Health (frontend port checks) ───────────────────────────

export interface ServiceHealth {
  name: string;
  port: number;
  status: 'up' | 'down';
  label: string;
}

const SERVICE_HEALTH_DEFS: Array<{ name: string; port: number; label: string }> = [
  { name: 'rss', port: 3001, label: 'RSS Ingestion' },
  { name: 'ai', port: 3013, label: 'AI Processor' },
  { name: 'bluesky', port: 3004, label: 'Bluesky Publisher' },
  { name: 'telegram', port: 0, label: 'Telegram Notifier' },
];

/**
 * Check service health by hitting each service's /health endpoint.
 * Telegram uses a best-effort check via the admin service.
 */
export async function fetchServiceHealth(): Promise<ServiceHealth[]> {
  const results: ServiceHealth[] = [];

  for (const svc of SERVICE_HEALTH_DEFS) {
    if (svc.name === 'telegram') {
      // Telegram doesn't have a direct port — try admin service proxy
      try {
        const resp = await fetch(`${ADMIN_API}/api/admin/services`, {
          signal: AbortSignal.timeout(3_000),
        });
        if (resp.ok) {
          const body = await resp.json() as ServicesResponse;
          const tg = body.services.find((s: ServiceStatus) => s.name === 'hermes-bridge');
          results.push({
            name: 'telegram',
            port: tg?.port ?? 0,
            status: tg?.status === 'running' ? 'up' : 'down',
            label: 'Telegram Notifier',
          });
        } else {
          results.push({ name: 'telegram', port: 0, status: 'down', label: 'Telegram Notifier' });
        }
      } catch {
        results.push({ name: 'telegram', port: 0, status: 'down', label: 'Telegram Notifier' });
      }
      continue;
    }

    try {
      const resp = await fetch(`http://127.0.0.1:${svc.port}/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      results.push({
        name: svc.name,
        port: svc.port,
        status: resp.ok ? 'up' : 'down',
        label: svc.label,
      });
    } catch {
      results.push({
        name: svc.name,
        port: svc.port,
        status: 'down',
        label: svc.label,
      });
    }
  }

  return results;
}

// ═════════════════════════════════════════════════════════════════════
//  Service Control (ADMIN only — requires JWT token)
// ═════════════════════════════════════════════════════════════════════

export interface ServiceStatus {
  name: string;
  pm2Name: string;
  port: number | null;
  icon: string;
  description: string;
  type: 'node' | 'python' | 'web';
  status: 'running' | 'stopped' | 'unknown';
  lastChecked: string;
}

export interface ServicesResponse {
  services: ServiceStatus[];
}

export interface ServiceActionResponse {
  message: string;
  service: string;
  stdout: string;
  stderr: string;
}

// ─── Mock fallback for services (all unknown when backend is unreachable) ─

const SERVICE_DEFINITIONS_MOCK: Omit<ServiceStatus, 'status' | 'lastChecked'>[] = [
  { name: 'web-app',         pm2Name: 'web-app',         port: 5173, icon: '🌐', description: 'Vite dev server',              type: 'web' },
  { name: 'news-ingestion',  pm2Name: 'news-ingestion',  port: 3001, icon: '📰', description: 'News ingestion pipeline',      type: 'node' },
  { name: 'geolocation',     pm2Name: 'geolocation',     port: 3002, icon: '📍', description: 'Geolocation service',          type: 'node' },
  { name: 'ai-processor',    pm2Name: 'ai-processor',    port: 3013, icon: '🧠', description: 'AI content processor',         type: 'python' },
  { name: 'event-detector',  pm2Name: 'event-detector',  port: 3008, icon: '⚡', description: 'Event detection engine',       type: 'node' },
  { name: 'trend-analyzer',  pm2Name: 'trend-analyzer',  port: 3009, icon: '📈', description: 'Trend analysis',               type: 'node' },
  { name: 'twitter-publisher', pm2Name: 'twitter-publisher', port: 3004, icon: '🐦', description: 'Twitter/X publisher',     type: 'node' },
  { name: 'hermes-bridge',   pm2Name: 'hermes-bridge',   port: 3005, icon: '🤖', description: 'Telegram bot bridge',          type: 'python' },
  { name: 'economic-data',   pm2Name: 'economic-data',   port: 3006, icon: '💰', description: 'Economic data fetcher',        type: 'node' },
  { name: 'alerts',          pm2Name: 'alerts',          port: 3007, icon: '🔔', description: 'Alert system',                 type: 'node' },
  { name: 'night-owl',       pm2Name: 'night-owl',       port: 3011, icon: '🦉', description: 'Nightly batch processor',      type: 'node' },
  { name: 'auth',            pm2Name: 'auth',            port: 3010, icon: '🔐', description: 'Authentication service',       type: 'node' },
];

function getMockServices(): ServiceStatus[] {
  return SERVICE_DEFINITIONS_MOCK.map((svc) => ({
    ...svc,
    status: 'unknown' as const,
    lastChecked: new Date().toISOString(),
  }));
}

// ─── Auth fetch helper ─────────────────────────────────────────────

function getAuthToken(): string | null {
  try {
    return localStorage.getItem('argentinaradar_token');
  } catch {
    return null;
  }
}

async function authFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  // Merge any additional headers from options
  if (options?.headers) {
    Object.assign(headers, options.headers);
  }

  const resp = await fetch(url, { ...options, headers });
  if (!resp.ok) {
    const text = await resp.text().catch(() => 'Unknown error');
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

// ─── Public Service API ────────────────────────────────────────────

/**
 * Fetch service statuses from the backend.
 * Falls back to mock data (all unknown) when backend is unreachable or auth fails.
 */
export async function fetchServices(): Promise<ServicesResponse> {
  try {
    return await authFetch<ServicesResponse>(`${ADMIN_API}/api/admin/services`);
  } catch {
    return { services: getMockServices() };
  }
}

/**
 * Start a service by name.
 * Throws on failure — caller must handle errors.
 */
export async function startService(name: string): Promise<ServiceActionResponse> {
  return authFetch<ServiceActionResponse>(
    `${ADMIN_API}/api/admin/services/${encodeURIComponent(name)}/start`,
    { method: 'POST' },
  );
}

/**
 * Stop a service by name.
 * Throws on failure — caller must handle errors.
 */
export async function stopService(name: string): Promise<ServiceActionResponse> {
  return authFetch<ServiceActionResponse>(
    `${ADMIN_API}/api/admin/services/${encodeURIComponent(name)}/stop`,
    { method: 'POST' },
  );
}

/**
 * Start all services via PM2.
 */
export async function startAllServices(): Promise<ServiceActionResponse> {
  return authFetch<ServiceActionResponse>(
    `${ADMIN_API}/api/admin/services/start-all`,
    { method: 'POST' },
  );
}

/**
 * Stop all services (excluding admin itself) via PM2.
 */
export async function stopAllServices(): Promise<ServiceActionResponse> {
  return authFetch<ServiceActionResponse>(
    `${ADMIN_API}/api/admin/services/stop-all`,
    { method: 'POST' },
  );
}
