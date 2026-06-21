/**
 * PoliticalRadar — Admin panel showing political figure radar.
 *
 * Displays:
 * - Top 5 most mentioned political figures as cards
 * - Per figure: name, party badge, photo placeholder (initials),
 *   mention count, sentiment bar (red↔green), growth arrow
 * - Mini sparkline chart (7-day mention trend)
 * - Click figure → filter events timeline to only show involving that figure
 *
 * Data source: trend-analyzer GET /api/trends/political
 */

import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { fetchPoliticalTrends, fetchPoliticalEvents } from '../../services/api';
import type { PoliticalFigureTrend, PoliticalEventEntry } from '../../services/api';

// ─── Party colour map ───────────────────────────────────────────

const PARTY_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  LLA: { bg: 'bg-violet-500/20', text: 'text-violet-300', border: 'border-violet-500/30' },
  PRO: { bg: 'bg-yellow-500/20', text: 'text-yellow-300', border: 'border-yellow-500/30' },
  'FdT': { bg: 'bg-blue-500/20', text: 'text-blue-300', border: 'border-blue-500/30' },
  UCR: { bg: 'bg-red-500/20', text: 'text-red-300', border: 'border-red-500/30' },
  PTS: { bg: 'bg-orange-500/20', text: 'text-orange-300', border: 'border-orange-500/30' },
};

function getPartyStyle(party: string) {
  return PARTY_STYLES[party] ?? { bg: 'bg-slate-500/20', text: 'text-slate-300', border: 'border-slate-500/30' };
}

// ─── Utilities ──────────────────────────────────────────────────

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? '?';
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function sentimentColor(sentiment: number): string {
  if (sentiment <= -0.5) return 'bg-red-500';
  if (sentiment <= -0.1) return 'bg-orange-500';
  if (sentiment < 0.1) return 'bg-slate-400';
  if (sentiment < 0.5) return 'bg-lime-500';
  return 'bg-green-500';
}

function sentimentLabel(sentiment: number): string {
  if (sentiment <= -0.5) return 'Hostil';
  if (sentiment <= -0.1) return 'Crítico';
  if (sentiment < 0.1) return 'Neutral';
  if (sentiment < 0.5) return 'Favorable';
  return 'Muy favorable';
}

// ─── Main component ─────────────────────────────────────────────

export function PoliticalRadar() {
  const [selectedFigure, setSelectedFigure] = useState<string | null>(null);

  const { data: figures, isLoading, isError } = useQuery({
    queryKey: ['political-trends'],
    queryFn: fetchPoliticalTrends,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const { data: filteredEvents } = useQuery({
    queryKey: ['political-events', selectedFigure],
    queryFn: () =>
      selectedFigure
        ? fetchPoliticalEvents({ figure: selectedFigure, limit: 20 })
        : Promise.resolve([]),
    enabled: !!selectedFigure,
    staleTime: 15_000,
  });

  const topFigures = (figures ?? []).slice(0, 5);

  const handleFigureClick = useCallback(
    (name: string) => {
      setSelectedFigure((prev) => (prev === name ? null : name));
    },
    [],
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-5"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          Political Radar
        </h2>
        {selectedFigure && (
          <button
            onClick={() => setSelectedFigure(null)}
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
          >
            Clear filter
          </button>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="ml-2 text-xs text-slate-400">Loading political data...</span>
        </div>
      )}

      {isError && (
        <div className="p-4 text-center">
          <p className="text-xs text-red-400">
            Error loading political data. Ensure trend-analyzer is running.
          </p>
        </div>
      )}

      {!isLoading && !isError && topFigures.length === 0 && (
        <div className="p-4 text-center">
          <p className="text-xs text-slate-500">
            No political figures tracked yet. Data appears as articles are processed.
          </p>
        </div>
      )}

      {/* Figure cards */}
      <div className="space-y-2">
        {topFigures.map((figure, idx) => (
          <FigureCard
            key={figure.name}
            figure={figure}
            isSelected={selectedFigure === figure.name}
            onClick={() => handleFigureClick(figure.name)}
            index={idx}
          />
        ))}
      </div>

      {/* Filtered events for selected figure */}
      {selectedFigure && filteredEvents && filteredEvents.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-700/50">
          <h3 className="text-xs font-medium text-slate-400 mb-2">
            Events involving {selectedFigure}
          </h3>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {filteredEvents.slice(0, 10).map((ev) => (
              <div
                key={ev.id}
                className="flex items-start gap-2 px-2 py-1.5 rounded-md bg-slate-700/20 hover:bg-slate-700/40 transition-colors"
              >
                <span className="text-xs text-slate-300 leading-snug line-clamp-1 flex-1">
                  {ev.title}
                </span>
                <span className="shrink-0 text-[10px] text-slate-500">
                  {ev.articleCount}f
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedFigure && filteredEvents && filteredEvents.length === 0 && (
        <div className="mt-4 pt-4 border-t border-slate-700/50 text-center">
          <p className="text-xs text-slate-500">No events found for {selectedFigure}.</p>
        </div>
      )}
    </motion.div>
  );
}

// ─── Single figure card ─────────────────────────────────────────

interface FigureCardProps {
  figure: PoliticalFigureTrend;
  isSelected: boolean;
  onClick: () => void;
  index: number;
}

function FigureCard({ figure, isSelected, onClick, index }: FigureCardProps) {
  const partyStyle = getPartyStyle(figure.party);
  const initials = getInitials(figure.name);
  const sentPct = ((figure.avgSentiment + 1) / 2) * 100; // -1..1 → 0..100
  const growthUp = figure.growthRate >= 0;

  const chartData = figure.trendChart.map((v, i) => ({ i, v }));
  const chartColor = growthUp ? '#22c55e' : '#ef4444';

  return (
    <motion.button
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      onClick={onClick}
      className={`
        w-full text-left p-3 rounded-lg border transition-all duration-200 cursor-pointer
        ${
          isSelected
            ? 'border-blue-500/50 bg-blue-500/10'
            : 'border-slate-700/30 bg-slate-700/20 hover:border-slate-600/50 hover:bg-slate-700/40'
        }
      `}
    >
      <div className="flex items-center gap-3">
        {/* Avatar / initials */}
        <div className="shrink-0 w-9 h-9 rounded-full bg-slate-600/40 border border-slate-500/40 flex items-center justify-center">
          <span className="text-xs font-bold text-slate-300">{initials}</span>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          {/* Name + party badge */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-slate-200 truncate">
              {figure.name}
            </span>
            <span
              className={`inline-flex shrink-0 items-center px-1.5 py-0.5 text-[10px] font-medium rounded border ${partyStyle.bg} ${partyStyle.text} ${partyStyle.border}`}
            >
              {figure.party}
            </span>
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-3 text-xs text-slate-400">
            {/* Mentions */}
            <span>{figure.mentions24h.toLocaleString()} menciones</span>

            {/* Growth arrow */}
            <span className={`flex items-center gap-0.5 ${growthUp ? 'text-green-400' : 'text-red-400'}`}>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="w-3 h-3"
              >
                {growthUp ? (
                  <path
                    fillRule="evenodd"
                    d="M10 17a.75.75 0 01-.75-.75V5.612L5.29 9.77a.75.75 0 01-1.08-1.04l5.25-5.5a.75.75 0 011.08 0l5.25 5.5a.75.75 0 11-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0110 17z"
                    clipRule="evenodd"
                  />
                ) : (
                  <path
                    fillRule="evenodd"
                    d="M10 3a.75.75 0 01.75.75v10.638l3.96-4.158a.75.75 0 111.08 1.04l-5.25 5.5a.75.75 0 01-1.08 0l-5.25-5.5a.75.75 0 111.08-1.04l3.96 4.158V3.75A.75.75 0 0110 3z"
                    clipRule="evenodd"
                  />
                )}
              </svg>
              <span className="tabular-nums">
                {growthUp ? '+' : ''}{figure.growthRate}%
              </span>
            </span>
          </div>

          {/* Sentiment bar */}
          <div className="mt-1.5 flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-slate-600/40 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${sentimentColor(figure.avgSentiment)}`}
                style={{ width: `${sentPct}%` }}
              />
            </div>
            <span className="text-[10px] text-slate-500 tabular-nums shrink-0">
              {sentimentLabel(figure.avgSentiment)}
            </span>
          </div>
        </div>

        {/* Sparkline */}
        <div className="shrink-0 w-16 h-8">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`pol-spark-${figure.name.replace(/\s+/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chartColor} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={chartColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="v"
                stroke={chartColor}
                strokeWidth={1.5}
                fill={`url(#pol-spark-${figure.name.replace(/\s+/g, '')})`}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </motion.button>
  );
}
