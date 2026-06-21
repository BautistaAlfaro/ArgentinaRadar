/**
 * AdminDashboard — Main admin page with tabs.
 *
 * Default tab now shows the new ControlCenter.
 * Old Overview content is available as a sub-tab.
 */

import { lazy, Suspense, useState } from 'react';
import { ControlCenter } from './ControlCenter';
import { useKPIs, useDailyStats, useSystemMetrics, useRevenue, usePipelineStats, useServiceHealth } from '../hooks/useAdminData';
import { ServiceCards } from '../components/admin/ServiceCards';
import { QualityMetrics } from '../components/admin/QualityMetrics';
import { LogViewer } from '../components/admin/LogViewer';

// Lazy-load admin components (kept for legacy overview tab)
const KPICard = lazy(() => import('../components/admin/KPICard').then(m => ({ default: m.KPICard })));
const PipelineView = lazy(() => import('../components/admin/PipelineView').then(m => ({ default: m.PipelineView })));
const CategoryChart = lazy(() => import('../components/admin/CategoryChart').then(m => ({ default: m.CategoryChart })));
const ActivityFeed = lazy(() => import('../components/admin/ActivityFeed').then(m => ({ default: m.ActivityFeed })));
const NewsProcessingChart = lazy(() => import('../components/admin/charts/NewsProcessingChart').then(m => ({ default: m.NewsProcessingChart })));
const RevenueChart = lazy(() => import('../components/admin/charts/RevenueChart').then(m => ({ default: m.RevenueChart })));
const SystemHealthChart = lazy(() => import('../components/admin/charts/SystemHealthChart').then(m => ({ default: m.SystemHealthChart })));
const EventDetectionChart = lazy(() => import('../components/admin/charts/EventDetectionChart').then(m => ({ default: m.EventDetectionChart })));
const UserActivityChart = lazy(() => import('../components/admin/charts/UserActivityChart').then(m => ({ default: m.UserActivityChart })));
const AICostChart = lazy(() => import('../components/admin/charts/AICostChart').then(m => ({ default: m.AICostChart })));
const SystemMetrics = lazy(() => import('../components/admin/SystemMetrics').then(m => ({ default: m.SystemMetrics })));
const InsecurityPanel = lazy(() => import('../components/admin/InsecurityPanel').then(m => ({ default: m.InsecurityPanel })));
const ProtestPanel = lazy(() => import('../components/admin/ProtestPanel').then(m => ({ default: m.ProtestPanel })));
const PoliticalRadar = lazy(() => import('../components/admin/PoliticalRadar').then(m => ({ default: m.PoliticalRadar })));
const MorningBriefing = lazy(() => import('../components/admin/MorningBriefing').then(m => ({ default: m.MorningBriefing })));
const ServiceControlPanel = lazy(() => import('../components/admin/ServiceControlPanel').then(m => ({ default: m.ServiceControlPanel })));
const SourceManager = lazy(() => import('../components/admin/SourceManager').then(m => ({ default: m.SourceManager })));
const TrendingTopics = lazy(() => import('../components/admin/TrendingTopics').then(m => ({ default: m.TrendingTopics })));

// ─── Suspense fallbacks ──────────────────────────────────────────
const EMPTY_ARRAY: [] = [];
const ZERO = 0;
function LoadingSkeleton({ className }: { className?: string }) {
  return <div className={`bg-surface-container-high/40 rounded-lg animate-pulse ${className ?? ''}`} />;
}

type Range = '7d' | '30d' | '90d';
type Tab = 'control-center' | 'overview' | 'briefing' | 'trending' | 'quality' | 'sources';

const RANGE_OPTIONS: { value: Range; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
];

const TABS: { value: Tab; label: string; icon: string }[] = [
  { value: 'control-center', label: 'Panel de Control', icon: 'terminal' },
  { value: 'overview', label: 'Overview', icon: 'monitoring' },
  { value: 'briefing', label: 'Morning Briefing', icon: 'sunny' },
  { value: 'trending', label: 'Trending', icon: 'trending_up' },
  { value: 'quality', label: 'Quality', icon: 'star' },
  { value: 'sources', label: 'Fuentes', icon: 'rss_feed' },
];

// Inline SVG icons (lucide-compatible style)
const Icons = {
  tweets: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 9.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 01.778-.332 48.294 48.294 0 005.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
    </svg>
  ),
  news: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6v-3z" />
    </svg>
  ),
  revenue: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
    </svg>
  ),
  users: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  ),
};

export function AdminDashboard() {
  const [range, setRange] = useState<Range>('30d');
  const [systemDimension, setSystemDimension] = useState<'cpu' | 'memory'>('cpu');
  const [activeTab, setActiveTab] = useState<Tab>('control-center');

  // Data fetching
  const { data: kpis, isLoading: kpisLoading } = useKPIs(range);
  const { data: dailyStats, isLoading: statsLoading } = useDailyStats(range);
  const { data: systemMetrics } = useSystemMetrics();
  const { data: revenue } = useRevenue();
  const { data: pipelineStats, isLoading: pipelineLoading } = usePipelineStats();
  const { data: serviceHealth, isLoading: healthLoading } = useServiceHealth();

  const isLoading = kpisLoading || statsLoading;

  // ─── Loading skeleton ─────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-6 space-y-6">
        <div className="h-8 w-48 bg-surface-container-high/40 rounded-lg animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-36 bg-surface-container-high/40 rounded-lg animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-80 bg-surface-container-high/40 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-base text-on-surface relative">
      <div className="scanline"></div>
      {/* ─── Header ─────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-surface-container/70 backdrop-blur-xl border-b border-white/10 shadow-lg shadow-primary/5">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <h1 className="font-headline-sm text-headline-sm font-bold text-primary tracking-tight uppercase font-space-grotesk">
              Admin Dashboard
            </h1>
            <p className="font-label-data text-label-data text-on-surface-variant mt-0.5 font-jetbrains-mono">
              {activeTab === 'control-center' && 'Control center con monitoreo en vivo, acciones y estadísticas'}
              {activeTab === 'overview' && 'System overview & performance metrics'}
              {activeTab === 'quality' && 'Article quality scoring & source ranking'}
              {activeTab === 'sources' && 'Manage RSS & scrape news sources'}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Tab navigation */}
            <div className="flex rounded border border-white/10 bg-surface-container-lowest/80 p-0.5">
              {TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setActiveTab(tab.value)}
                  className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded transition-all cursor-pointer flex items-center gap-1.5 font-inter ${
                    activeTab === tab.value
                      ? 'bg-primary text-on-primary shadow-sm'
                      : 'text-on-surface-variant hover:text-primary'
                  }`}
                  aria-label={`Tab: ${tab.label}`}
                >
                  <span className="material-symbols-outlined text-sm">{tab.icon}</span>
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>

            {/* Range selector (overview only) */}
            {activeTab === 'overview' && (
              <div className="flex rounded border border-white/10 bg-surface-container-lowest/80 p-0.5">
                {RANGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setRange(opt.value)}
                    className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded transition-all cursor-pointer font-inter ${
                      range === opt.value
                        ? 'bg-primary text-on-primary shadow-sm'
                        : 'text-on-surface-variant hover:text-primary'
                    }`}
                    aria-label={`Select range: ${opt.label}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {/* Refresh indicator */}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="p-2 text-on-surface-variant hover:text-primary transition-colors rounded hover:bg-white/5 cursor-pointer"
              title="Refresh data"
              aria-label="Refresh dashboard data"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* ─── Main Content ───────────────────────────────────────────── */}
      <div className="p-6 space-y-6">
        {activeTab === 'control-center' && (
          <ControlCenter />
        )}
        {activeTab === 'overview' && (
          <div>
              {/* ── KPI Cards ──────────────────────────────────────────── */}
            <Suspense fallback={
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <LoadingSkeleton key={i} className="h-36" />
                ))}
              </div>
            }>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <KPICard
                  icon={Icons.tweets}
                  value={kpis?.tweetsPublished?.total ?? ZERO}
                  label="Tweets Published"
                  trend={kpis?.tweetsPublished?.trend ?? ZERO}
                  sparkline={kpis?.tweetsPublished?.sparkline ?? EMPTY_ARRAY}
                  accent="blue"
                  format="compact"
                />
                <KPICard
                  icon={Icons.news}
                  value={kpis?.newsProcessed?.total ?? ZERO}
                  label="News Processed"
                  trend={kpis?.newsProcessed.trend ?? ZERO}
                  sparkline={kpis?.newsProcessed.sparkline ?? EMPTY_ARRAY}
                  accent="emerald"
                  format="compact"
                />
                <KPICard
                  icon={Icons.revenue}
                  value={kpis?.revenue?.usd ?? ZERO}
                  label="Revenue (USD)"
                  trend={kpis?.revenue.trend ?? ZERO}
                  sparkline={kpis?.revenue.sparkline ?? EMPTY_ARRAY}
                  accent="amber"
                  format="currency"
                />
                <KPICard
                  icon={Icons.users}
                  value={kpis?.activeUsers?.total ?? ZERO}
                  label="Active Users"
                  trend={kpis?.activeUsers.trend ?? ZERO}
                  sparkline={kpis?.activeUsers.sparkline ?? EMPTY_ARRAY}
                  accent="violet"
                />
              </div>
            </Suspense>

            {/* ── Pipeline Status ────────────────────────────────────── */}
            <PipelineView
              pipeline={pipelineStats?.pipeline ?? null}
              approvalQueue={pipelineStats?.approvalQueue ?? null}
              isLoading={pipelineLoading}
            />

            {/* ── Pipeline Grid: Category Breakdown + Service Health ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <CategoryChart
                categories={pipelineStats?.categories ?? null}
                isLoading={pipelineLoading}
              />
              <ServiceCards
                services={serviceHealth ?? null}
                isLoading={healthLoading}
              />
            </div>

            {/* ── Recent Activity ────────────────────────────────────── */}
            <ActivityFeed
              items={pipelineStats?.recent ?? null}
              isLoading={pipelineLoading}
            />

            {/* ── Charts Grid ────────────────────────────────────────── */}
            <Suspense fallback={<LoadingSkeleton className="h-80" />}>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <NewsProcessingChart data={dailyStats ?? EMPTY_ARRAY} />
                <RevenueChart data={revenue ?? EMPTY_ARRAY} />
              </div>
            </Suspense>

            <Suspense fallback={<LoadingSkeleton className="h-80" />}>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <SystemHealthChart
                  metrics={systemMetrics ?? EMPTY_ARRAY}
                  dimension={systemDimension}
                />
                <EventDetectionChart data={dailyStats ?? EMPTY_ARRAY} />
              </div>
            </Suspense>

            <Suspense fallback={<LoadingSkeleton className="h-80" />}>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <UserActivityChart data={dailyStats ?? EMPTY_ARRAY} />
                <AICostChart data={dailyStats ?? EMPTY_ARRAY} />
              </div>
            </Suspense>

            {/* ── Political Radar ──────────────────────────────────── */}
            <Suspense fallback={<LoadingSkeleton className="h-80" />}>
              <PoliticalRadar />
            </Suspense>

            {/* ── Insecurity Radar ──────────────────────────────────── */}
            <Suspense fallback={<LoadingSkeleton className="h-80" />}>
              <section className="glass-panel rounded-xl overflow-hidden active-glow">
                <div className="max-h-[500px] overflow-y-auto">
                  <InsecurityPanel />
                </div>
              </section>
            </Suspense>

            {/* ── Protest Radar ──────────────────────────────────────── */}
            <Suspense fallback={<LoadingSkeleton className="h-80" />}>
              <section className="glass-panel rounded-xl overflow-hidden active-glow">
                <div className="max-h-[500px] overflow-y-auto">
                  <ProtestPanel />
                </div>
              </section>
            </Suspense>

            {/* ── System Metrics ─────────────────────────────────────── */}
            <Suspense fallback={<LoadingSkeleton className="h-64" />}>
              <SystemMetrics metrics={systemMetrics ?? EMPTY_ARRAY} />
            </Suspense>
          </div>
          )}

          {activeTab === 'briefing' && (
            <div>
              <Suspense fallback={<LoadingSkeleton className="h-96" />}>
                <MorningBriefing />
              </Suspense>
            </div>
          )}

          {activeTab === 'trending' && (
            <div>
              <Suspense fallback={<LoadingSkeleton className="h-96" />}>
                <TrendingTopics />
              </Suspense>
            </div>
          )}

          {activeTab === 'quality' && (
            <div>
              <QualityMetrics />
            </div>
          )}

          {activeTab === 'sources' && (
            <div>
              <Suspense fallback={<LoadingSkeleton className="h-96" />}>
                <SourceManager />
              </Suspense>
            </div>
          )}

      </div>
    </div>
  );
}


