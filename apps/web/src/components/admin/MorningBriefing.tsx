/**
 * MorningBriefing — Today's executive digest panel for the admin dashboard.
 *
 * Displays:
 *  - Executive summary (from nightly digest)
 *  - Top 5 events with impact scores
 *  - Predictions for today
 *  - Patterns discovered last night
 *  - System health semaphore (green/yellow/red)
 *  - Stats: articles processed, events detected, tweets published
 *  - "Generated at 02:00 ART" timestamp
 *  - Auto-refresh when new digest available
 *
 * Fetches from:
 *  - GET /api/night-owl/briefing  (night-owl service, port 3011)
 *  - GET /api/admin/daily-stats   (admin backend, port 3012)
 */

import { useEffect, useState, useCallback } from 'react';
import { LazyMotion, domAnimation, m, AnimatePresence } from 'framer-motion';

// ── Types ──────────────────────────────────────────────────────────────

interface BriefingData {
  date: string;
  generatedAt: string | null;
  digest: {
    summary: string;
    topEvents: Array<{ id: string; title: string; impact: number; summary?: string; category?: string }>;
    topTrends: Array<{ name: string; type: string; growthRate: number; score: number }>;
    stats: { articlesIngested: number; eventsDetected: number; tweetsPublished: number };
    createdAt: string;
  } | null;
  predictions: Array<{
    entityName: string;
    confidence: number;
    reason: string;
  }> | null;
  patterns: Array<{
    type: string;
    entityName: string;
    description: string;
    confidence: number;
  }> | null;
  healthReport: {
    score: number;
    services: Array<{ name: string; status: string; uptime: number }>;
    budget: { percentageUsed: number };
  } | null;
  healthSemaphore: 'green' | 'yellow' | 'red';
  available: boolean;
}

interface DailyStatsData {
  stats: {
    articlesIngested: number;
    eventsDetected: number;
    tweetsPublished: number;
  };
}

// ── API URLs ───────────────────────────────────────────────────────────

const NIGHT_OWL_API = 'http://localhost:3011';
const ADMIN_API = 'http://localhost:3012';

// ── Helpers ────────────────────────────────────────────────────────────

function formatTimestamp(iso: string | null): string {
  if (!iso) return 'Not yet generated';
  const date = new Date(iso);
  return date.toLocaleString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
    timeZoneName: 'short',
  });
}

function formatDate(iso: string): string {
  const date = new Date(iso + 'T00:00:00');
  return date.toLocaleDateString('es-AR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

function impactStars(impact: number): string {
  const stars = Math.min(5, Math.ceil(impact / 20));
  return '★'.repeat(stars) + '☆'.repeat(5 - stars);
}

// ── Semaphore indicator ────────────────────────────────────────────────

const SEMAPHORE_COLORS = {
  green: { dot: 'bg-emerald-500', bg: 'bg-emerald-500/10', text: 'text-emerald-400', label: 'All Systems' },
  yellow: { dot: 'bg-amber-500', bg: 'bg-amber-500/10', text: 'text-amber-400', label: 'Degraded' },
  red: { dot: 'bg-red-500', bg: 'bg-red-500/10', text: 'text-red-400', label: 'Critical' },
} as const;

function Semaphore({ status }: { status: 'green' | 'yellow' | 'red' }) {
  const c = SEMAPHORE_COLORS[status];

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${c.bg}`}>
      <m.span
        animate={{ scale: [1, 1.3, 1] }}
        transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
        className={`w-2.5 h-2.5 rounded-full ${c.dot}`}
      />
      <span className={`text-xs font-semibold ${c.text}`}>{c.label}</span>
    </div>
  );
}

// ── Stat card ──────────────────────────────────────────────────────────

function StatCard({ label, value, accent }: { label: string; value: number | null; accent: string }) {
  return (
    <div className={`rounded-lg border border-slate-700/50 ${accent} p-3`}>
      <p className="text-xs text-slate-400 font-medium">{label}</p>
      <p className="text-xl font-bold text-white tabular-nums mt-1">
        {value != null ? value.toLocaleString() : '—'}
      </p>
    </div>
  );
}

// ── Skeleton loader ────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="space-y-4 p-6">
      <div className="h-6 w-48 bg-slate-800 rounded animate-pulse" />
      <div className="h-20 bg-slate-800 rounded-xl animate-pulse" />
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 bg-slate-800 rounded-lg animate-pulse" />
        ))}
      </div>
      <div className="h-40 bg-slate-800 rounded-xl animate-pulse" />
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────

export function MorningBriefing() {
  const [briefing, setBriefing] = useState<BriefingData | null>(null);
  const [dailyStats, setDailyStats] = useState<DailyStatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [briefingResp, statsResp] = await Promise.all([
        fetch(`${NIGHT_OWL_API}/api/night-owl/briefing`, { signal: AbortSignal.timeout(5000) }),
        fetch(`${ADMIN_API}/api/admin/daily-stats?range=1d`, { signal: AbortSignal.timeout(5000) }),
      ]);

      if (briefingResp.ok) {
        const data = await briefingResp.json() as BriefingData;
        setBriefing(data);
      }

      if (statsResp.ok) {
        const data = await statsResp.json() as DailyStatsData;
        setDailyStats(data);
      }

      setError(null);
    } catch (err) {
      setError('Could not load briefing data');
      console.warn('[MorningBriefing] Fetch failed:', (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();

    // Auto-refresh every 60 seconds
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // ── Loading state ──────────────────────────────────────────────────
  if (loading) {
    return (
      <LazyMotion features={domAnimation}>
        <m.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-slate-700/50 bg-slate-800/60 p-5"
        >
          <Skeleton />
        </m.div>
      </LazyMotion>
    );
  }

  // ── Error / unavailable state ──────────────────────────────────────
  if (error || (briefing && !briefing.available)) {
    return (
      <LazyMotion features={domAnimation}>
        <m.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-slate-700/50 bg-slate-800/60 p-8 text-center"
        >
          <div className="max-w-md mx-auto">
            <div className="text-4xl mb-4 text-slate-600">☀️</div>
            <h2 className="text-lg font-semibold text-slate-300 mb-2">
              Morning Briefing
            </h2>
            <p className="text-sm text-slate-500 mb-4">
              {error ?? 'No nightly report available yet. The first digest will be generated at 02:00 ART.'}
            </p>
            <button
              onClick={fetchData}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors cursor-pointer"
              aria-label="Retry briefing"
             type="button">
              Retry
            </button>
          </div>
        </m.div>
      </LazyMotion>
    );
  }

  // ── Main content ───────────────────────────────────────────────────
  const healthSemaphore = briefing?.healthSemaphore ?? 'green';
  const stats = dailyStats?.stats ??
    briefing?.digest?.stats ??
    { articlesIngested: 0, eventsDetected: 0, tweetsPublished: 0 };

  return (
    <LazyMotion features={domAnimation}>
    <m.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="rounded-xl border border-slate-700/50 bg-slate-800/60 p-5"
    >
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-white tracking-tight">
              ☀️ Morning Briefing
            </h2>
            <Semaphore status={healthSemaphore} />
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {briefing?.date ? formatDate(briefing.date) : ''}
            {briefing?.generatedAt
              ? ` · Generated at ${formatTimestamp(briefing.generatedAt)}`
              : ' · Pending nightly run'}
          </p>
        </div>

        <button
          onClick={fetchData}
          className="p-2 text-slate-500 hover:text-slate-300 transition-colors rounded-lg hover:bg-slate-700/60 cursor-pointer"
          title="Refresh"
          aria-label="Refresh briefing data"
         type="button">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* ── Stats bar ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <StatCard label="Articles Processed" value={stats.articlesIngested} accent="bg-blue-500/5" />
        <StatCard label="Events Detected" value={stats.eventsDetected} accent="bg-violet-500/5" />
        <StatCard label="Tweets Published" value={stats.tweetsPublished} accent="bg-emerald-500/5" />
      </div>

      <AnimatePresence mode="wait">
        <m.div
          key={briefing?.generatedAt ?? 'empty'}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="space-y-5"
        >
          {/* ── Executive Summary ───────────────────────────────────── */}
          {briefing?.digest?.summary && (
            <section>
              <h3 className="text-sm font-semibold text-slate-300 mb-2">
                📋 Executive Summary
              </h3>
              <div className="rounded-lg bg-slate-700/30 p-4 border border-slate-600/30">
                <p className="text-sm text-slate-300 leading-relaxed">
                  {briefing.digest.summary}
                </p>
              </div>
            </section>
          )}

          {/* ── Top 5 Events ────────────────────────────────────────── */}
          {briefing?.digest?.topEvents && briefing.digest.topEvents.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-slate-300 mb-2">
                🔥 Top Events
              </h3>
              <div className="space-y-2">
                {briefing.digest.topEvents.slice(0, 5).map((event, i) => (
                  <m.div
                    key={event.id ?? i}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="flex items-start gap-3 px-3 py-2.5 rounded-lg bg-slate-700/20 border border-slate-700/30"
                  >
                    <span className="text-xs font-bold text-slate-500 w-5 mt-0.5">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-slate-200 truncate">
                          {event.title}
                        </p>
                        {event.category && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400 uppercase">
                            {event.category}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-amber-400">
                          {impactStars(event.impact)}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          Impact: {event.impact}
                        </span>
                      </div>
                    </div>
                  </m.div>
                ))}
              </div>
            </section>
          )}

          {/* ── Predictions ─────────────────────────────────────────── */}
          {briefing?.predictions && briefing.predictions.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-slate-300 mb-2">
                🔮 Today's Predictions
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {briefing.predictions.slice(0, 6).map((pred, i) => (
                  <m.div
                    key={pred.entityName ?? i}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.05 }}
                    className="px-3 py-2.5 rounded-lg bg-slate-700/20 border border-slate-700/30"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium text-slate-200 truncate">
                        {pred.entityName}
                      </p>
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
                        pred.confidence >= 0.7
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : pred.confidence >= 0.4
                            ? 'bg-amber-500/10 text-amber-400'
                            : 'bg-slate-500/10 text-slate-400'
                      }`}>
                        {(pred.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500 leading-relaxed line-clamp-2">
                      {pred.reason}
                    </p>
                  </m.div>
                ))}
              </div>
            </section>
          )}

          {/* ── Patterns ────────────────────────────────────────────── */}
          {briefing?.patterns && briefing.patterns.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-slate-300 mb-2">
                📊 Patterns Discovered
              </h3>
              <div className="space-y-1.5">
                {briefing.patterns.slice(0, 5).map((pat, i) => (
                  <div
                    key={`${pat.entityName}-${i}`}
                    className="flex items-start gap-2 px-3 py-2 rounded-lg bg-slate-700/15"
                  >
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded mt-0.5 ${
                      pat.type === 'weekly' ? 'bg-blue-500/10 text-blue-400' :
                      pat.type === 'contextual' ? 'bg-purple-500/10 text-purple-400' :
                      'bg-amber-500/10 text-amber-400'
                    }`}>
                      {pat.type}
                    </span>
                    <p className="text-xs text-slate-400 flex-1">
                      {pat.description}
                    </p>
                    <span className="text-[10px] text-slate-500">
                      {(pat.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Health Report ───────────────────────────────────────── */}
          {briefing?.healthReport && (
            <section>
              <h3 className="text-sm font-semibold text-slate-300 mb-2">
                🏥 System Health
              </h3>
              <div className="rounded-lg bg-slate-700/20 p-3 border border-slate-700/30">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-400">Health Score</span>
                  <span className={`text-sm font-bold ${
                    briefing.healthReport.score >= 80 ? 'text-emerald-400' :
                    briefing.healthReport.score >= 60 ? 'text-amber-400' :
                    'text-red-400'
                  }`}>
                    {briefing.healthReport.score}/100
                  </span>
                </div>
                {briefing.healthReport.services && (
                  <div className="flex flex-wrap gap-1.5">
                    {briefing.healthReport.services.slice(0, 12).map((svc) => (
                      <span
                        key={svc.name}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium ${
                          svc.status === 'ok'
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : svc.status === 'degraded'
                              ? 'bg-amber-500/10 text-amber-400'
                              : 'bg-red-500/10 text-red-400'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          svc.status === 'ok' ? 'bg-emerald-500' :
                          svc.status === 'degraded' ? 'bg-amber-500' : 'bg-red-500'
                        }`} />
                        {svc.name}
                      </span>
                    ))}
                  </div>
                )}
                {briefing.healthReport.budget && (
                  <div className="mt-2 pt-2 border-t border-slate-700/30">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-500">AI Budget Used</span>
                      <span className={`text-[10px] font-medium ${
                        briefing.healthReport.budget.percentageUsed > 90
                          ? 'text-red-400'
                          : briefing.healthReport.budget.percentageUsed > 75
                            ? 'text-amber-400'
                            : 'text-emerald-400'
                      }`}>
                        {briefing.healthReport.budget.percentageUsed.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ── Footer note ─────────────────────────────────────────── */}
          <div className="text-[10px] text-slate-600 text-center pt-2 border-t border-slate-700/30">
            Auto-refreshes every 60s · Data from nightly jobs (01:00–05:30 ART)
          </div>
        </m.div>
      </AnimatePresence>
    </m.div>
    </LazyMotion>
  );
}

