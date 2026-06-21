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
  return fetchWithFallback(
    `${ADMIN_API}/api/admin/kpis?range=${range}`,
    MOCK_KPIS[range] ?? MOCK_KPIS['7d'],
  );
}

export async function fetchDailyStats(range: string): Promise<DailyStat[]> {
  const fallback = generateDailyStats(range === '90d' ? 90 : range === '30d' ? 30 : 7);
  return fetchWithFallback(
    `${ADMIN_API}/api/admin/stats?range=${range}`,
    fallback,
  );
}

export async function fetchSystemMetrics(
  service?: string,
  range?: string,
): Promise<SystemMetric[]> {
  const params = new URLSearchParams();
  if (service) params.set('service', service);
  if (range) params.set('range', range);
  const qs = params.toString() ? `?${params.toString()}` : '';
  return fetchWithFallback(
    `${ADMIN_API}/api/admin/system${qs}`,
    MOCK_SYSTEM_METRICS,
  );
}

export async function fetchRevenueData(): Promise<RevenuePoint[]> {
  const fallback = generateRevenue(90);
  return fetchWithFallback(
    `${ADMIN_API}/api/admin/revenue`,
    fallback,
  );
}
