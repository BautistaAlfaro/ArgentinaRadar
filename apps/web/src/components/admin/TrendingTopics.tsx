/**
 * TrendingTopics — Admin panel for trending topics and article clusters.
 *
 * Shows:
 *   - Top 10 trending topics with article counts, source diversity, scores
 *   - Multi-source article clusters
 *   - Color-coded by category
 */

import { useState } from 'react';
import { useTrendingTopics } from '../../hooks/useAdminData';

const CATEGORY_COLORS: Record<string, string> = {
  urgente: 'bg-red-900/30 text-red-300 border-red-700/30',
  politica: 'bg-blue-900/30 text-blue-300 border-blue-700/30',
  economia: 'bg-amber-900/30 text-amber-300 border-amber-700/30',
  deportes: 'bg-emerald-900/30 text-emerald-300 border-emerald-700/30',
  policial: 'bg-purple-900/30 text-purple-300 border-purple-700/30',
  sociedad: 'bg-cyan-900/30 text-cyan-300 border-cyan-700/30',
  general: 'bg-slate-700/30 text-slate-300 border-slate-600/30',
};

const CATEGORY_BADGE: Record<string, string> = {
  urgente: '🚨 URgente',
  politica: '🗳️ Política',
  economia: '💰 Economía',
  deportes: '⚽ Deportes',
  policial: '🚔 Policial',
  sociedad: '🌎 Sociedad',
  general: '📰 General',
};

function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] || CATEGORY_COLORS.general;
}

function getCategoryBadge(category: string): string {
  return CATEGORY_BADGE[category] || CATEGORY_BADGE.general;
}

// ─── Sub-components ──────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="h-6 w-48 bg-slate-800 rounded-lg animate-pulse" />
        <div className="h-8 w-24 bg-slate-800 rounded-lg animate-pulse" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 bg-slate-800 rounded-xl animate-pulse" />
        ))}
      </div>
    </div>
  );
}

function TrendingCard({
  topic,
  rank,
}: {
  topic: TrendingTopic;
  rank: number;
}) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4 hover:bg-slate-800/60 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono text-slate-500 w-5 shrink-0">
              #{rank}
            </span>
            <h3 className="text-sm font-semibold text-white truncate">
              {topic.topic}
            </h3>
          </div>
          <p className="text-xs text-slate-400 truncate mt-1">
            {topic.latestArticleTitle}
          </p>
          <div className="flex items-center gap-3 mt-2">
            <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full border ${getCategoryColor(topic.category)}`}>
              {getCategoryBadge(topic.category)}
            </span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-bold text-white tabular-nums">
            {topic.articleCount}
          </div>
          <div className="text-[10px] text-slate-500">articles</div>
        </div>
      </div>
      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-slate-700/30 text-[11px] text-slate-400">
        <span>
          📰 <span className="text-slate-300 font-medium">{topic.sourceCount}</span> fuentes
        </span>
        <span>
          🔥 <span className="text-slate-300 font-medium">{topic.trendingScore.toFixed(0)}</span> score
        </span>
      </div>
    </div>
  );
}

function ClusterCard({
  cluster,
  index,
}: {
  cluster: Cluster;
  index: number;
}) {
  const consensusPercent = Math.round(cluster.consensusScore * 100);
  const barColor =
    consensusPercent >= 70
      ? 'bg-emerald-500'
      : consensusPercent >= 40
        ? 'bg-amber-500'
        : 'bg-slate-500';

  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4 hover:bg-slate-800/60 transition-colors">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-slate-500">#{index + 1}</span>
            <h3 className="text-sm font-semibold text-white truncate">
              {cluster.mainTopic}
            </h3>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-bold text-white tabular-nums">
            {cluster.articleCount}
          </div>
          <div className="text-[10px] text-slate-500">artículos</div>
        </div>
      </div>

      {/* Consensus bar */}
      <div className="flex items-center gap-2 mt-2">
        <div className="flex-1 h-1.5 rounded-full bg-slate-700 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${consensusPercent}%` }}
          />
        </div>
        <span className="text-[10px] text-slate-400 w-8 text-right font-mono">
          {consensusPercent}%
        </span>
      </div>

      {/* Top titles */}
      <div className="mt-2 space-y-1">
        {cluster.topArticleTitles.map((title) => (
          <p key={title} className="text-[11px] text-slate-400 truncate pl-2 border-l-2 border-slate-700">
            {title}
          </p>
        ))}
      </div>

      <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-500">
        <span>📰 {cluster.sourceCount} fuentes</span>
        <span>🔗 {cluster.clusterId.slice(0, 12)}</span>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────

export function TrendingTopics() {
  const { data, isLoading, isFetching, isError, error, refetch } = useTrendingTopics();
  const [view, setView] = useState<'trending' | 'clusters'>('trending');

  const trending = data?.trending ?? null;
  const clusters = data?.clusters ?? null;

  // ─── Loading ──────────────────────────────────────────────────────
  if (isLoading) {
    return <LoadingSkeleton />;
  }

  // ─── Error ────────────────────────────────────────────────────────
  if (isError && !data) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-900/20 p-6 text-center">
        <p className="text-sm text-red-300 mb-3">Failed to load trending data</p>
        <p className="text-xs text-red-400/80 mb-4">{error instanceof Error ? error.message : 'Unknown error'}</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="px-4 py-2 text-xs font-medium rounded-lg bg-red-700 text-white hover:bg-red-600 transition-colors cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-white tracking-tight">
            {view === 'trending' ? '📈 Trending Topics' : '🔗 Article Clusters'}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {view === 'trending'
              ? `Top topics from ${trending?.totalArticles ?? 0} articles in the last ${trending?.window ?? '24h'}`
              : `${clusters?.multiSourceClusters ?? 0} clusters from ${clusters?.totalClusters ?? 0} total groups`
            }
          </p>
        </div>

        <div className="flex rounded-lg border border-slate-700/50 bg-slate-800/60 p-0.5">
          <button
            type="button"
            onClick={() => setView('trending')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
              view === 'trending'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Trending
          </button>
          <button
            type="button"
            onClick={() => setView('clusters')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
              view === 'clusters'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Clusters
          </button>
        </div>
      </div>

      {/* ── Refresh button ──────────────────────────────────────────── */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-50 transition-colors cursor-pointer"
        >
          {isFetching ? 'Refreshing…' : '🔄 Refresh'}
        </button>
      </div>

      {/* ── Trending View ──────────────────────────────────────────── */}
      {view === 'trending' && trending && (
        <div>
          {trending.topics.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm">
              No trending data available yet. Articles are being processed.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {trending.topics.map((topic, i) => (
                <TrendingCard key={topic.topic} topic={topic} rank={i + 1} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Clusters View ───────────────────────────────────────────── */}
      {view === 'clusters' && clusters && (
        <div>
          {clusters.clusters.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm">
              No multi-source clusters found. Articles from different sources
              covering the same topic will appear here.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {clusters.clusters.map((cluster, i) => (
                <ClusterCard key={cluster.clusterId} cluster={cluster} index={i} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Summary bar ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 text-[11px] text-slate-600 pt-2 border-t border-slate-800/50">
        <span>📈 {trending?.topics.length ?? 0} trending topics</span>
        <span>🔗 {clusters?.multiSourceClusters ?? 0} clusters</span>
        <span>🕐 {trending?.generatedAt ? new Date(trending.generatedAt).toLocaleTimeString() : ''}</span>
      </div>
    </div>
  );
}
