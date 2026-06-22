/**
 * ControlCenter — Premium Admin Dashboard
 *
 * Fixed two-column layout that fits within the viewport at 100% zoom.
 * Left:  Mini stats → Pipeline → Charts (compact) → Activity
 * Right: Services (compact pill grid) → Approval Queue → Logs
 *
 * Both columns scroll independently; outer container is viewport-bound.
 */

import { lazy, Suspense, useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LazyMotion, domAnimation, m as motion } from 'framer-motion';
import { PipelineView } from '../components/admin/PipelineView';
import { API } from '@shared/apiConfig';
import { useServices } from '../hooks/useAdminData';
import { startService, stopService, startAllServices, stopAllServices } from '../services/adminApi';

// ── Lazy chunks ─────────────────────────────────────────────────────

const NewsProcessingChart = lazy(() =>
  import('../components/admin/charts/NewsProcessingChart').then((m) => ({ default: m.NewsProcessingChart })),
);
const EventDetectionChart = lazy(() =>
  import('../components/admin/charts/EventDetectionChart').then((m) => ({ default: m.EventDetectionChart })),
);
const ActivityFeed = lazy(() =>
  import('../components/admin/ActivityFeed').then((m) => ({ default: m.ActivityFeed })),
);
const ApprovalQueue = lazy(() =>
  import('../components/admin/ApprovalQueue').then((m) => ({ default: m.ApprovalQueue })),
);
const LogViewer = lazy(() =>
  import('../components/admin/LogViewer').then((m) => ({ default: m.LogViewer })),
);

// ── Types ────────────────────────────────────────────────────────────

interface DailyStat {
  date: string;
  ingested: number; geolocated: number; filtered: number; published: number;
  revenue: number; activeUsers: number; vipUsers: number; adminUsers: number;
  eventsDetected: number; avgImpactScore: number; aiCost: number; budget: number;
}

interface PipelineStats {
  pipeline: Record<string, number>;
  categories: Array<{ category: string; count: number }>;
  approvalQueue: Record<string, number>;
  recent: Array<{ id: string; title: string; source: string; category: string | null; status: string; publishedAt: string | null; ingestedAt: string }>;
  timestamp: string;
}

// ── API ──────────────────────────────────────────────────────────────

const ADMIN_API = API.admin;
const NEWS_API  = API.news;

function generateMockDailyStats(days: number): DailyStat[] {
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates.map((date, i) => ({
    date,
    ingested:       500 + Math.round(Math.sin(i * 0.3) * 100 + Math.random() * 80),
    geolocated:     420 + Math.round(Math.sin(i * 0.3 + 0.5) * 80 + Math.random() * 60),
    filtered:       340 + Math.round(Math.sin(i * 0.3 + 1) * 70 + Math.random() * 50),
    published:      280 + Math.round(Math.sin(i * 0.3 + 1.5) * 60 + Math.random() * 40),
    revenue:       5500 + Math.round(Math.sin(i * 0.2) * 800 + Math.random() * 400),
    activeUsers:    110 + Math.round(Math.sin(i * 0.15) * 20 + Math.random() * 15),
    vipUsers:        90 + Math.round(Math.sin(i * 0.15 + 0.3) * 15 + Math.random() * 10),
    adminUsers:      20 + Math.round(Math.sin(i * 0.15 + 0.6) * 5 + Math.random() * 4),
    eventsDetected:  40 + Math.round(Math.sin(i * 0.4) * 10 + Math.random() * 8),
    avgImpactScore:  45 + Math.round(Math.sin(i * 0.25) * 15 + Math.random() * 10),
    aiCost:         1.2 + Math.sin(i * 0.2) * 0.5 + Math.random() * 0.3,
    budget: 2.0,
  }));
}

async function fetchDailyStats(): Promise<DailyStat[]> {
  try {
    const r = await fetch(`${ADMIN_API}/api/admin/daily-stats?range=7d`, { signal: AbortSignal.timeout(5_000) });
    if (r.ok) return r.json();
  } catch { /* mock fallback */ }
  return generateMockDailyStats(7);
}

async function fetchPipelineStats(): Promise<PipelineStats | null> {
  try {
    const r = await fetch(`${NEWS_API}/api/pipeline/stats`, { signal: AbortSignal.timeout(5_000) });
    if (r.ok) return r.json();
  } catch { /* offline */ }
  return null;
}

// ── Helpers ──────────────────────────────────────────────────────────

function Skel({ h }: { h: string }) {
  return <div className={`bg-surface-container-high/40 rounded animate-pulse ${h}`} />;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold text-primary tracking-widest uppercase font-label-caps mb-2">
      {children}
    </p>
  );
}

// ── Compact Service Icons ─────────────────────────────────────────────

const SVC_ICONS: Record<string, string> = {
  'web-app': 'public', 'news-ingestion': 'rss_feed', 'geolocation': 'location_on',
  'ai-processor': 'psychology', 'event-detector': 'bolt', 'trend-analyzer': 'trending_up',
  'twitter-publisher': 'send', 'hermes-bridge': 'smart_toy', 'economic-data': 'payments',
  'alerts': 'notifications', 'night-owl': 'bedtime', 'auth': 'lock',
};

function svcLabel(name: string) {
  return name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Compact Service Grid ──────────────────────────────────────────────

function CompactServices() {
  const { data, isLoading } = useServices();
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const toggle = useCallback(async (name: string, status: string) => {
    setBusy((b) => ({ ...b, [name]: true }));
    try {
      status === 'running' ? await stopService(name) : await startService(name);
    } finally {
      setBusy((b) => ({ ...b, [name]: false }));
    }
  }, []);

  const [bulkBusy, setBulkBusy] = useState(false);

  const startAll = useCallback(async () => {
    setBulkBusy(true);
    try { await startAllServices(); } finally { setBulkBusy(false); }
  }, []);

  const stopAll = useCallback(async () => {
    setBulkBusy(true);
    try { await stopAllServices(); } finally { setBulkBusy(false); }
  }, []);

  const services = data?.services ?? [];
  const running  = services.filter((s) => s.status === 'running').length;

  if (isLoading && services.length === 0) {
    return <div className="grid grid-cols-3 gap-1.5">{Array.from({ length: 9 }).map((_, i) => <Skel key={i} h="h-8" />)}</div>;
  }

  return (
    <div className="space-y-2">
      {/* Bulk bar */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-on-surface-variant font-jetbrains-mono">
          {running}/{services.length} running
        </span>
        <div className="flex gap-1.5">
          <button
            type="button" disabled={bulkBusy} onClick={stopAll}
            className="px-2 py-0.5 text-[10px] font-medium rounded bg-red-800/60 text-red-300 hover:bg-red-700/70 disabled:opacity-40 transition-colors cursor-pointer"
          >
            Stop All
          </button>
          <button
            type="button" disabled={bulkBusy} onClick={startAll}
            className="px-2 py-0.5 text-[10px] font-medium rounded bg-emerald-800/60 text-emerald-300 hover:bg-emerald-700/70 disabled:opacity-40 transition-colors cursor-pointer"
          >
            Start All
          </button>
        </div>
      </div>

      {/* Service pill grid — 3 columns */}
      <div className="grid grid-cols-3 gap-1.5">
        {services.map((svc) => {
          const isRunning = svc.status === 'running';
          const isBusy    = busy[svc.name] ?? false;
          return (
            <button
              key={svc.name}
              type="button"
              disabled={isBusy}
              onClick={() => toggle(svc.name, svc.status)}
              title={svc.name}
              className={`
                flex items-center gap-1.5 px-2 py-1.5 rounded border text-left
                transition-all duration-150 cursor-pointer
                ${isRunning
                  ? 'border-emerald-500/30 bg-emerald-900/15 hover:bg-emerald-900/25'
                  : 'border-slate-700/40 bg-slate-800/40 hover:bg-slate-700/40'
                }
                ${isBusy ? 'opacity-50 cursor-not-allowed' : ''}
              `}
              aria-label={`${isRunning ? 'Stop' : 'Start'} ${svc.name}`}
            >
              {/* LED */}
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                isRunning ? 'bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.6)]' : 'bg-red-500'
              }`} />
              {/* Icon */}
              <span className="material-symbols-outlined text-[13px] text-on-surface-variant shrink-0">
                {SVC_ICONS[svc.name] ?? 'settings'}
              </span>
              {/* Name */}
              <span className="text-[10px] font-medium text-on-surface truncate font-jetbrains-mono">
                {svcLabel(svc.name)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Mini Pipeline Stats ───────────────────────────────────────────────

function MiniPipeStats({ pipeline, sources }: { pipeline: Record<string, number>; sources?: number }) {
  const cards = [
    { label: 'Ingestión', icon: 'download',       value: `${pipeline.ingested ?? 0}`,        sub: `${sources ?? 16} fuentes`,   color: 'text-secondary' },
    { label: 'AI',        icon: 'psychology',      value: 'qwen2.5',                          sub: `${pipeline.filtered ?? 0} proc.`, color: 'text-primary' },
    { label: 'Pendientes',icon: 'pending_actions', value: `${pipeline.pending_approval ?? 0}`,sub: 'en cola',                    color: 'text-tertiary' },
    { label: 'Publicados',icon: 'check_circle',    value: `${pipeline.published ?? 0}`,       sub: 'hoy',                        color: 'text-secondary' },
  ];

  return (
    <div className="grid grid-cols-4 gap-2">
      {cards.map((c, i) => (
        <motion.div
          key={c.label}
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
          className="glass-panel active-glow rounded border px-2.5 py-2"
        >
          <div className="flex items-center gap-1.5 mb-1">
            <span className={`material-symbols-outlined text-[15px] ${c.color}`}>{c.icon}</span>
            <span className="text-[9px] font-bold text-on-surface-variant uppercase tracking-wider">{c.label}</span>
          </div>
          <p className={`text-sm font-bold tabular-nums font-label-data ${c.color}`}>{c.value}</p>
          <p className="text-[9px] text-on-surface-variant/60 font-label-data">{c.sub}</p>
        </motion.div>
      ))}
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────

export function ControlCenter() {
  const { data: dailyStats, isLoading: statsLoading } = useQuery<DailyStat[]>({
    queryKey: ['control-center', 'daily-stats'],
    queryFn: fetchDailyStats,
    refetchInterval: 30_000, staleTime: 10_000,
  });

  const { data: pipelineStats } = useQuery<PipelineStats | null>({
    queryKey: ['control-center', 'pipeline-stats'],
    queryFn: fetchPipelineStats,
    refetchInterval: 10_000, staleTime: 5_000,
  });

  const dailyData = Array.isArray(dailyStats) ? dailyStats : [];
  const pipeData      = pipelineStats?.pipeline ?? {};
  const recentActivity= pipelineStats?.recent ?? null;

  return (
    <LazyMotion features={domAnimation}>
      {/* Full viewport — no scroll */}
      <div className="relative text-on-surface" style={{ height: 'calc(100vh - 7rem)' }}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 h-full relative z-10">

        {/* ── LEFT COLUMN ─────────────────────────────────── */}
        <div className="overflow-hidden pr-3 lg:border-r lg:border-white/10 space-y-2 pb-2">

          {/* Telegram Bot Hint — compact */}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded px-2 py-1.5 flex items-center gap-1.5 text-[10px]">
            <span className="material-symbols-outlined text-blue-400 text-sm">info</span>
            <span className="text-blue-300">Telegram: <span className="text-white font-mono">/panel</span> <span className="text-white font-mono">/breaking</span> <span className="text-white font-mono">/search</span> <span className="text-white font-mono">/briefing</span> <span className="text-white font-mono">/alert</span></span>
          </div>

          {/* Pipeline flow — minimal */}
          <PipelineView
            pipeline={pipeData}
            approvalQueue={pipelineStats?.approvalQueue ?? {}}
            isLoading={statsLoading}
          />

          {/* Charts — compact, same size */}
          <Suspense fallback={<div className="grid grid-cols-2 gap-2"><Skel h="h-28" /><Skel h="h-28" /></div>}>
            <div className="grid grid-cols-2 gap-2">
              <div className="min-h-[110px]"><NewsProcessingChart data={dailyData} /></div>
              <div className="min-h-[110px]"><EventDetectionChart data={dailyData} /></div>
            </div>
          </Suspense>

          {/* Recent Activity — compact */}
          <div>
            <SectionLabel>Actividad Reciente</SectionLabel>
            <div className="max-h-32 overflow-y-auto text-[10px]">
              <Suspense fallback={<Skel h="h-20" />}>
                <ActivityFeed items={recentActivity as any} isLoading={false} />
              </Suspense>
            </div>
          </div>
        </div>

        {/* ── RIGHT COLUMN ────────────────────────────────── */}
        <div className="overflow-hidden pl-3 space-y-1.5 pb-2 flex flex-col" style={{ height: 'calc(100vh - 7rem)' }}>

          {/* Services — ultra compact */}
          <div className="shrink-0">
            <CompactServices />
          </div>

          {/* Approval Queue — expandable, slim */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <Suspense fallback={<Skel h="h-24" />}>
              <ApprovalQueue />
            </Suspense>
          </div>

          {/* Logs — fixed 5 lines at bottom */}
          <div className="shrink-0 border-t border-white/10 pt-1.5 max-h-[120px] overflow-y-auto">
            <div className="text-[10px]">
              <Suspense fallback={<Skel h="h-10" />}>
                <LogViewer limit={5} compact />
              </Suspense>
            </div>
          </div>

        </div>
        </div>
      </div>
    </LazyMotion>
  );
}
