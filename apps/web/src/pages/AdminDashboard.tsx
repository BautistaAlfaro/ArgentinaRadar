/**
 * AdminDashboard — Main admin page with KPIs, charts, and system metrics.
 *
 * Layout:
 * - Header with title + range selector (7d / 30d / 90d)
 * - 4 KPI cards in a responsive grid
 * - 2×2 chart grid (NewsProcessing, Revenue, SystemHealth, EventDetection)
 * - Bottom row: UserActivity + AICost
 * - SystemMetrics sidebar / footer panel
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useKPIs, useDailyStats, useSystemMetrics, useRevenue } from '../hooks/useAdminData';
import { KPICard } from '../components/admin/KPICard';
import { NewsProcessingChart } from '../components/admin/charts/NewsProcessingChart';
import { RevenueChart } from '../components/admin/charts/RevenueChart';
import { SystemHealthChart } from '../components/admin/charts/SystemHealthChart';
import { EventDetectionChart } from '../components/admin/charts/EventDetectionChart';
import { UserActivityChart } from '../components/admin/charts/UserActivityChart';
import { AICostChart } from '../components/admin/charts/AICostChart';
import { SystemMetrics } from '../components/admin/SystemMetrics';
import { InsecurityPanel } from '../components/admin/InsecurityPanel';
import { ProtestPanel } from '../components/admin/ProtestPanel';
import { MorningBriefing } from '../components/admin/MorningBriefing';

type Range = '7d' | '30d' | '90d';
type Tab = 'overview' | 'briefing';

const RANGE_OPTIONS: { value: Range; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
];

const TABS: { value: Tab; label: string; icon: string }[] = [
  { value: 'overview', label: 'Overview', icon: '📊' },
  { value: 'briefing', label: 'Morning Briefing', icon: '☀️' },
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
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  // Data fetching
  const { data: kpis, isLoading: kpisLoading } = useKPIs(range);
  const { data: dailyStats, isLoading: statsLoading } = useDailyStats(range);
  const { data: systemMetrics } = useSystemMetrics();
  const { data: revenue } = useRevenue();

  const isLoading = kpisLoading || statsLoading;

  // ─── Loading skeleton ─────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 p-6 space-y-6">
        <div className="h-8 w-48 bg-slate-800 rounded-lg animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-36 bg-slate-800 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-80 bg-slate-800 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900">
      {/* ─── Header ─────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-slate-900/80 backdrop-blur-md border-b border-slate-800/50">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">
              Admin Dashboard
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {activeTab === 'overview'
                ? 'System overview &amp; performance metrics'
                : 'Nightly digest &amp; today\'s predictions'}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Tab navigation */}
            <div className="flex rounded-lg border border-slate-700/50 bg-slate-800/60 p-0.5">
              {TABS.map((tab) => (
                <button
                  key={tab.value}
                  onClick={() => setActiveTab(tab.value)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
                    activeTab === tab.value
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.icon} {tab.label}
                </button>
              ))}
            </div>

            {/* Range selector (overview only) */}
            {activeTab === 'overview' && (
              <div className="flex rounded-lg border border-slate-700/50 bg-slate-800/60 p-0.5">
                {RANGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setRange(opt.value)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
                      range === opt.value
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {/* Refresh indicator */}
            <button
              onClick={() => window.location.reload()}
              className="p-2 text-slate-500 hover:text-slate-300 transition-colors rounded-lg hover:bg-slate-800/60 cursor-pointer"
              title="Refresh data"
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
        <AnimatePresence mode="wait">
          {activeTab === 'overview' ? (
            <motion.div
              key={range}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
            >
              {/* ── KPI Cards ──────────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard
                icon={Icons.tweets}
                value={kpis?.tweetsPublished.total ?? 0}
                label="Tweets Published"
                trend={kpis?.tweetsPublished.trend ?? 0}
                sparkline={kpis?.tweetsPublished.sparkline ?? []}
                accent="blue"
                format="compact"
              />
              <KPICard
                icon={Icons.news}
                value={kpis?.newsProcessed.total ?? 0}
                label="News Processed"
                trend={kpis?.newsProcessed.trend ?? 0}
                sparkline={kpis?.newsProcessed.sparkline ?? []}
                accent="emerald"
                format="compact"
              />
              <KPICard
                icon={Icons.revenue}
                value={kpis?.revenue.usd ?? 0}
                label="Revenue (USD)"
                trend={kpis?.revenue.trend ?? 0}
                sparkline={kpis?.revenue.sparkline ?? []}
                accent="amber"
                format="currency"
              />
              <KPICard
                icon={Icons.users}
                value={kpis?.activeUsers.total ?? 0}
                label="Active Users"
                trend={kpis?.activeUsers.trend ?? 0}
                sparkline={kpis?.activeUsers.sparkline ?? []}
                accent="violet"
              />
            </div>

            {/* ── Charts Grid ────────────────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <NewsProcessingChart data={dailyStats ?? []} />
              <RevenueChart data={revenue ?? []} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <SystemHealthChart
                metrics={systemMetrics ?? []}
                dimension={systemDimension}
              />
              <EventDetectionChart data={dailyStats ?? []} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <UserActivityChart data={dailyStats ?? []} />
              <AICostChart data={dailyStats ?? []} />
            </div>

            {/* ── Political Radar ──────────────────────────────────── */}
            <PoliticalRadar />

            {/* ── Insecurity Radar ──────────────────────────────────── */}
            <section className="bg-slate-800/40 rounded-xl border border-slate-700/50 overflow-hidden">
              <div className="max-h-[500px] overflow-y-auto">
                <InsecurityPanel />
              </div>
            </section>

            {/* ── Protest Radar ──────────────────────────────────────── */}
            <section className="bg-slate-800/40 rounded-xl border border-slate-700/50 overflow-hidden">
              <div className="max-h-[500px] overflow-y-auto">
                <ProtestPanel />
              </div>
            </section>

            {/* ── System Metrics ─────────────────────────────────────── */}
            <SystemMetrics metrics={systemMetrics ?? []} />
          </motion.div>
          ) : (
            <motion.div
              key="briefing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
            >
              <MorningBriefing />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
