/**
 * QualityMetrics — Dashboard component for article quality tracking.
 *
 * Displays:
 *   - Summary cards (avg quality, engagement, relevance)
 *   - Quality distribution (high / medium / low)
 *   - Average quality scores over time (last 30 days)
 *   - Top 10 highest quality articles
 *   - Source quality ranking
 *
 * Data is fetched from the news-ingestion service's /api/quality/stats endpoint.
 */

import { useEffect, useState } from 'react';
import { LazyMotion, domAnimation, m as motion } from 'framer-motion';

// ─── Types ───────────────────────────────────────────────────────────

interface QualityStats {
  avgScores: Array<{
    day: string;
    avg_quality: number;
    avg_engagement: number;
    avg_relevance: number;
    article_count: number;
  }>;
  topArticles: Array<{
    id: string;
    title: string;
    source: string;
    category: string | null;
    quality_score: number;
    engagement_score: number;
    relevance_score: number;
    ingested_at: string;
  }>;
  sourceRanking: Array<{
    source: string;
    avg_quality: number;
    avg_engagement: number;
    avg_relevance: number;
    article_count: number;
  }>;
  summary: {
    avg_quality: number;
    avg_engagement: number;
    avg_relevance: number;
    scored_articles: number;
    high_quality: number;
    medium_quality: number;
    low_quality: number;
  };
}

const NEWS_SERVICE_API = 'http://127.0.0.1:3001';
const POLL_INTERVAL = 30_000; // 30 seconds

// ─── Helpers ─────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 70) return 'text-emerald-400';
  if (score >= 40) return 'text-amber-400';
  return 'text-red-400';
}

function scoreBadge(score: number): string {
  if (score >= 70) return 'bg-emerald-500/20 text-emerald-300';
  if (score >= 40) return 'bg-amber-500/20 text-amber-300';
  return 'bg-red-500/20 text-red-300';
}

function scoreBg(score: number): string {
  if (score >= 70) return 'bg-emerald-500/10';
  if (score >= 40) return 'bg-amber-500/10';
  return 'bg-red-500/10';
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-AR', {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

// ─── Mini bar chart ─────────────────────────────────────────────────

function MiniBar({ value, max = 100, color = 'emerald' }: { value: number; max?: number; color?: string }) {
  const pct = Math.min((value / max) * 100, 100);
  const barColor = color === 'emerald' ? 'bg-emerald-500' : color === 'amber' ? 'bg-amber-500' : 'bg-blue-500';
  return (
    <div className="w-full h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className={`h-full rounded-full ${barColor}`}
      />
    </div>
  );
}

// ─── Loading skeleton ────────────────────────────────────────────────

function LoadingSkeleton({ className }: { className?: string }) {
  return <div className={`bg-slate-800 rounded-xl animate-pulse ${className ?? ''}`} />;
}

// ─── Main Component ──────────────────────────────────────────────────

export function QualityMetrics() {
  const [data, setData] = useState<QualityStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function fetchData() {
      try {
        const resp = await fetch(`${NEWS_SERVICE_API}/api/quality/stats`, {
          signal: AbortSignal.timeout(5_000),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json() as QualityStats;
        if (mounted) {
          setData(json);
          setLoading(false);
          setError(null);
        }
      } catch (e) {
        if (mounted) {
          setError((e as Error).message);
          setLoading(false);
        }
      }
    }

    fetchData();
    const interval = setInterval(fetchData, POLL_INTERVAL);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // ── Loading state ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <LoadingSkeleton key={i} className="h-28" />
          ))}
        </div>
        <LoadingSkeleton className="h-48" />
        <LoadingSkeleton className="h-64" />
      </div>
    );
  }

  // ── Error state ──────────────────────────────────────────────────
  if (error || !data) {
    return (
      <section className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-5">
        <h3 className="text-sm font-semibold text-slate-400 mb-3">Quality Metrics</h3>
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-amber-400">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          <span>Quality metrics service unavailable. {error ? `(${error})` : ''}</span>
        </div>
      </section>
    );
  }

  const { summary, avgScores, topArticles, sourceRanking } = data;

  return (
    <LazyMotion features={domAnimation}>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-6"
      >
        {/* ── Summary Cards ────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Avg Quality */}
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4">
            <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">Avg Quality</p>
            <p className={`text-2xl font-bold tabular-nums ${scoreColor(summary.avg_quality)}`}>
              {summary.avg_quality.toFixed(1)}
            </p>
            <MiniBar value={summary.avg_quality} color="emerald" />
            <p className="text-[10px] text-slate-600 mt-1">/ 100</p>
          </div>

          {/* Avg Engagement */}
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4">
            <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">Avg Engagement</p>
            <p className={`text-2xl font-bold tabular-nums ${scoreColor(summary.avg_engagement)}`}>
              {summary.avg_engagement.toFixed(1)}
            </p>
            <MiniBar value={summary.avg_engagement} color="amber" />
            <p className="text-[10px] text-slate-600 mt-1">/ 100</p>
          </div>

          {/* Avg Relevance */}
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4">
            <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">Avg Relevance</p>
            <p className={`text-2xl font-bold tabular-nums ${scoreColor(summary.avg_relevance)}`}>
              {summary.avg_relevance.toFixed(1)}
            </p>
            <MiniBar value={summary.avg_relevance} color="blue" />
            <p className="text-[10px] text-slate-600 mt-1">/ 10</p>
          </div>

          {/* Distribution */}
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4">
            <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">Distribution</p>
            <div className="flex items-center gap-3 mt-1">
              <div className="flex-1">
                <div className="flex h-2 rounded-full overflow-hidden bg-slate-700/50">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${summary.scored_articles > 0 ? (summary.high_quality / summary.scored_articles) * 100 : 0}%` }}
                    className="bg-emerald-500 h-full"
                  />
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${summary.scored_articles > 0 ? (summary.medium_quality / summary.scored_articles) * 100 : 0}%` }}
                    className="bg-amber-500 h-full"
                  />
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${summary.scored_articles > 0 ? (summary.low_quality / summary.scored_articles) * 100 : 0}%` }}
                    className="bg-red-500 h-full"
                  />
                </div>
                <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                  <span>High: {summary.high_quality}</span>
                  <span>Med: {summary.medium_quality}</span>
                  <span>Low: {summary.low_quality}</span>
                </div>
              </div>
            </div>
            <p className="text-[10px] text-slate-600 mt-2">{summary.scored_articles} scored articles</p>
          </div>
        </div>

        {/* ── Average Scores Over Time ────────────────────────────── */}
        <section className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-5">
          <h3 className="text-sm font-semibold text-white tracking-tight mb-4">
            Average Quality Over Time (Last 30 Days)
          </h3>
          {avgScores.length === 0 ? (
            <p className="text-xs text-slate-500">No data yet. Articles need to be processed first.</p>
          ) : (
            <div className="space-y-2">
              {avgScores.slice().reverse().map((day) => (
                <div key={day.day} className="flex items-center gap-3 text-xs">
                  <span className="w-20 text-slate-500 shrink-0 font-mono">
                    {formatDate(day.day)}
                  </span>
                  <div className="flex-1 flex items-center gap-4">
                    <div className="flex-1">
                      <div className="flex justify-between text-[10px] mb-0.5">
                        <span className="text-slate-400">Quality</span>
                        <span className={scoreColor(day.avg_quality)}>{day.avg_quality.toFixed(1)}</span>
                      </div>
                      <MiniBar value={day.avg_quality} color="emerald" />
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between text-[10px] mb-0.5">
                        <span className="text-slate-400">Engagement</span>
                        <span className={scoreColor(day.avg_engagement)}>{day.avg_engagement.toFixed(1)}</span>
                      </div>
                      <MiniBar value={day.avg_engagement} color="amber" />
                    </div>
                  </div>
                  <span className="w-12 text-right text-slate-600 font-mono">
                    {day.article_count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Top 10 Highest Quality Articles ─────────────────────── */}
        <section className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-5">
          <h3 className="text-sm font-semibold text-white tracking-tight mb-4">
            Top 10 Highest Quality Articles
          </h3>
          {topArticles.length === 0 ? (
            <p className="text-xs text-slate-500">No articles scored yet.</p>
          ) : (
            <div className="space-y-2">
              {topArticles.map((article, idx) => (
                <div
                  key={article.id}
                  className={`flex items-center gap-3 p-2.5 rounded-lg ${scoreBg(article.quality_score)}`}
                >
                  <span className="text-xs text-slate-500 font-mono w-5 text-right">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{article.title}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {article.source}
                      {article.category ? ` · ${article.category}` : ''}
                      {' · '}{formatDate(article.ingested_at)}
                    </p>
                  </div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${scoreBadge(article.quality_score)}`}>
                    {article.quality_score}
                  </span>
                  <span className="text-xs text-slate-500 w-16 text-right">
                    Eng: {article.engagement_score}
                  </span>
                  <span className="text-xs text-slate-500 w-16 text-right">
                    Rel: {article.relevance_score.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Source Quality Ranking ──────────────────────────────── */}
        <section className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-5">
          <h3 className="text-sm font-semibold text-white tracking-tight mb-4">
            Source Quality Ranking
          </h3>
          {sourceRanking.length === 0 ? (
            <p className="text-xs text-slate-500">No source data yet.</p>
          ) : (
            <div className="space-y-2">
              {sourceRanking.map((source, idx) => (
                <div key={source.source} className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-800/30">
                  <span className="text-xs text-slate-500 font-mono w-5 text-right">
                    {idx + 1}
                  </span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">{source.source}</span>
                      <span className="text-[10px] text-slate-500">({source.article_count} articles)</span>
                    </div>
                    <MiniBar value={source.avg_quality} color="emerald" />
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-bold tabular-nums ${scoreColor(source.avg_quality)}`}>
                      {source.avg_quality.toFixed(1)}
                    </p>
                    <p className="text-[10px] text-slate-500">Quality</p>
                  </div>
                  <div className="text-right w-16">
                    <p className="text-sm text-amber-400 tabular-nums">
                      {source.avg_engagement.toFixed(1)}
                    </p>
                    <p className="text-[10px] text-slate-500">Eng.</p>
                  </div>
                  <div className="text-right w-16">
                    <p className="text-sm text-blue-400 tabular-nums">
                      {source.avg_relevance.toFixed(1)}
                    </p>
                    <p className="text-[10px] text-slate-500">Rel.</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </motion.div>
    </LazyMotion>
  );
}
