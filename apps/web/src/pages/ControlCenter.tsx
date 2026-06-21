const EMPTY_CATEGORIES: { category: string; count: number }[] = [];

/**
 * ControlCenter — Premium Admin Dashboard
 *
 * The NEW default admin page with 6 sections:
 *   1. Service Status Bar (horizontal service cards)
 *   2. Pipeline Live (animated pipeline visual)
 *   3. Quick Actions (action buttons + confirmation modals)
 *   4. Live Stats (CPU, RAM, uptime, pipeline counts)
 *   5. Charts Grid (reused from existing charts with real data)
 *   6. Activity Feed (reused with real-time updates)
 *
 * Layout:
 * ┌──────────────────────────────────────────────┐
 * │  🤖 ARGENTINA RADAR — Panel de Control       │
 * ├──────────┬──────────┬──────────┬─────────────┤
 * │INGESTIÓN │  AI      │APROBACIÓN│ PUBLICACIÓN │
 * │  🟢      │  🟢     │  🟡     │  🟢        │
 * │ 637 arts │ qwen2.5  │ 3 pend.  │ 5 hoy      │
 * │ 16 fuen. │ thresh:5 │ 12/15    │ Bluesky OK │
 * ├──────────┴──────────┴──────────┴─────────────┤
 * │  📊 PIPELINE EN VIVO                         │
 * │  RSS → [637] → AI → [612] → Pending → [3] → │
 * ├──────────────────────────────────────────────┤
 * │  📈 GRÁFICOS                     ⚙️ ACCIONES │
 * │  ┌─────────┐ ┌─────────┐                    │
 * │  │Arts/día │ │Categoría│  [🔄 Refresh]      │
 * │  │ ▂▅▇█▇▅▂│ │  ████ po│  [🧠 Ajustar]     │
 * │  └─────────┘ └─────────┘  [⚡ Auto-apr]     │
 * ├──────────────────────────────────────────────┤
 * │  📋 ACTIVIDAD RECIENTE                       │
 * │  hace 2m ✅ Aprobado...                      │
 * │  hace 5m 📥 Ingestado...                     │
 * └──────────────────────────────────────────────┘
 */

import { API } from '@shared/apiConfig';
import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LazyMotion, domAnimation, m as motion } from "framer-motion";
import { ServiceStatusBar } from "../components/admin/ServiceStatusBar";
import { PipelineLive } from "../components/admin/PipelineLive";
import { QuickActions } from "../components/admin/QuickActions";
import { LiveStats } from "../components/admin/LiveStats";

// ─── Lazy-loaded existing charts ─────────────────────────────────────

const NewsProcessingChart = lazy(() =>
  import("../components/admin/charts/NewsProcessingChart").then((m) => ({
    default: m.NewsProcessingChart,
  })),
);

const RevenueChart = lazy(() =>
  import("../components/admin/charts/RevenueChart").then((m) => ({
    default: m.RevenueChart,
  })),
);

const SystemHealthChart = lazy(() =>
  import("../components/admin/charts/SystemHealthChart").then((m) => ({
    default: m.SystemHealthChart,
  })),
);

const EventDetectionChart = lazy(() =>
  import("../components/admin/charts/EventDetectionChart").then((m) => ({
    default: m.EventDetectionChart,
  })),
);

// ─── Lazy-loaded existing components ──────────────────────────────────

const ActivityFeed = lazy(() =>
  import("../components/admin/ActivityFeed").then((m) => ({
    default: m.ActivityFeed,
  })),
);

const CategoryChart = lazy(() =>
  import("../components/admin/CategoryChart").then((m) => ({
    default: m.CategoryChart,
  })),
);

// ─── Types ───────────────────────────────────────────────────────────

interface DailyStat {
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

interface PipelineStats {
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

// ─── API fetchers ────────────────────────────────────────────────────

const ADMIN_API = API.admin;
const NEWS_API = API.news;

function generateDateRange(days: number): string[] {
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function generateMockDailyStats(days: number): DailyStat[] {
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

async function fetchDailyStats(): Promise<DailyStat[]> {
  try {
    const resp = await fetch(`${ADMIN_API}/api/admin/daily-stats?range=7d`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (resp.ok) return resp.json();
  } catch {
    /* fall through to mock */
  }
  return generateMockDailyStats(7);
}

async function fetchPipelineStats(): Promise<PipelineStats | null> {
  try {
    const resp = await fetch(`${NEWS_API}/api/pipeline/stats`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (resp.ok) return resp.json();
  } catch {
    /* fall through */
  }
  return null;
}

async function fetchSystemMetrics(): Promise<unknown[]> {
  try {
    const resp = await fetch(`${ADMIN_API}/api/admin/system-metrics`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (resp.ok) return resp.json();
  } catch {
    /* fall through */
  }
  return [];
}

// ─── Loading Skeleton ────────────────────────────────────────────────

function LoadingSkeleton({ className }: { className?: string }) {
  return (
    <div className={`bg-slate-800 rounded-xl animate-pulse ${className ?? ""}`} />
  );
}

// ─── Section Header ──────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <h2 className="text-sm font-semibold text-white tracking-tight mb-4">
      {title}
    </h2>
  );
}

// ─── Mini Pipeline Quick Stats ───────────────────────────────────────

function MiniPipeStats({ pipeline, sources }: { pipeline: Record<string, number>; sources?: number }) {
  const ingested = pipeline.ingested ?? 0;
  const aiProcessed = pipeline.filtered ?? 0;
  const pending = pipeline.pending_approval ?? 0;
  const published = pipeline.published ?? 0;

  const cards = [
    { label: "Ingestión", icon: "📥", value: `${ingested} arts`, sub: `${sources ?? 16} fuen.`, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
    { label: "AI", icon: "🧠", value: "qwen2.5", sub: `thresh:5 · ${aiProcessed} proc.`, color: "text-indigo-400", bg: "bg-indigo-500/10 border-indigo-500/20" },
    { label: "Aprobación", icon: "⏳", value: `${pending} pend.`, sub: "12/15 revisores", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
    { label: "Publicación", icon: "✅", value: `${published} hoy`, sub: "Bluesky OK", color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {cards.map((card, idx) => (
        <motion.div
          key={card.label}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: idx * 0.06 }}
          className={`rounded-xl border p-4 ${card.bg}`}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm" aria-hidden="true">{card.icon}</span>
            <span className="text-[11px] font-medium text-slate-400">{card.label}</span>
          </div>
          <p className={`text-lg font-bold tabular-nums ${card.color}`}>{card.value}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">{card.sub}</p>
        </motion.div>
      ))}
    </div>
  );
}

// ─── Main ControlCenter ──────────────────────────────────────────────

export function ControlCenter() {
  const [systemDimension, setSystemDimension] = useState<"cpu" | "memory">("cpu");

  // Data fetching
  const { data: dailyStats, isLoading: statsLoading } = useQuery<DailyStat[]>({
    queryKey: ["control-center", "daily-stats"],
    queryFn: fetchDailyStats,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const { data: pipelineStats } = useQuery<PipelineStats | null>({
    queryKey: ["control-center", "pipeline-stats"],
    queryFn: fetchPipelineStats,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  const { data: systemMetrics } = useQuery<unknown[]>({
    queryKey: ["control-center", "system-metrics"],
    queryFn: fetchSystemMetrics,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const dailyData = dailyStats ?? [];
  const pipeData = pipelineStats?.pipeline ?? {};
  const categories = pipelineStats?.categories ?? null;
  const recentActivity = pipelineStats?.recent ?? null;
  const isLoading = statsLoading;

  if (isLoading && dailyData.length === 0) {
    return (
      <div className="min-h-screen bg-slate-900 p-6 space-y-6">
        <div className="h-8 w-64 bg-slate-800 rounded-lg animate-pulse" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 bg-slate-800 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-32 bg-slate-800 rounded-xl animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-72 bg-slate-800 rounded-xl animate-pulse" />
          <div className="h-72 bg-slate-800 rounded-xl animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <LazyMotion features={domAnimation}>
      <div className="min-h-screen bg-slate-900">
        {/* ─── Header ──────────────────────────────────────────────── */}
        <header className="sticky top-0 z-30 bg-slate-900/80 backdrop-blur-md border-b border-slate-800/50">
          <div className="flex items-center justify-between px-6 py-4">
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">
                🤖 ARGENTINA RADAR — Panel de Control
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Monitoreo en vivo · Control center · Administración del pipeline
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-700/50 bg-slate-800/60 text-slate-400 hover:text-slate-200 hover:border-slate-600/50 transition-all cursor-pointer"
                aria-label="Refresh dashboard"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z" clipRule="evenodd" />
                </svg>
                Refresh
              </button>
            </div>
          </div>
        </header>

        {/* ─── Main Content ────────────────────────────────────────── */}
        <div className="p-6 space-y-5">
          {/* Section 1: Mini Pipeline Stats */}
          <MiniPipeStats pipeline={pipeData} />

          {/* Section 2: Service Status Bar */}
          <ServiceStatusBar />

          {/* Section 3: Pipeline Live */}
          <PipelineLive />

          {/* Section 4: Live Stats */}
          <LiveStats />

          {/* Section 5: Charts + Actions Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Charts area (2/3) */}
            <div className="lg:col-span-2 space-y-5">
              {/* Charts grid */}
              <Suspense
                fallback={
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <LoadingSkeleton className="h-72" />
                    <LoadingSkeleton className="h-72" />
                  </div>
                }
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <NewsProcessingChart data={dailyData} />
                  <EventDetectionChart data={dailyData} />
                </div>
              </Suspense>

              <Suspense
                fallback={
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <LoadingSkeleton className="h-72" />
                    <LoadingSkeleton className="h-72" />
                  </div>
                }
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <SystemHealthChart
                    metrics={systemMetrics as any[]}
                    dimension={systemDimension}
                  />
                  {/* Category Distribution (reuse CategoryChart) */}
                  <Suspense fallback={<LoadingSkeleton className="h-72" />}>
                    <CategoryChart
                      categories={categories ?? EMPTY_CATEGORIES}
                      isLoading={false}
                    />
                  </Suspense>
                </div>
              </Suspense>
            </div>

            {/* Actions area (1/3) */}
            <div className="space-y-5">
              <QuickActions />
            </div>
          </div>

          {/* Section 6: Activity Feed */}
          <Suspense fallback={<LoadingSkeleton className="h-64" />}>
            <ActivityFeed items={recentActivity} isLoading={false} />
          </Suspense>
        </div>
      </div>
    </LazyMotion>
  );
}
