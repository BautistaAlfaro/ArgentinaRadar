/**
 * PoliticalPanel — Sidebar tab for political figure tracking.
 *
 * Shows political figures trending with sentiment indicators, mention
 * counts, and growth rates. Integrated as the 4th tab in the sidebar
 * ("Política").
 *
 * Data source: trend-analyzer GET /api/trends/political
 */

import { usePoliticalTrends } from '../../hooks/usePoliticalTrends';
import type { PoliticalFigureTrend } from '../../services/api';

// ─── Party colour map ───────────────────────────────────────────

const PARTY_STYLES: Record<string, { bg: string; text: string }> = {
  LLA: { bg: 'bg-violet-500/15', text: 'text-violet-400' },
  PRO: { bg: 'bg-yellow-500/15', text: 'text-yellow-400' },
  'FdT': { bg: 'bg-blue-500/15', text: 'text-blue-400' },
  UCR: { bg: 'bg-red-500/15', text: 'text-red-400' },
  PTS: { bg: 'bg-orange-500/15', text: 'text-orange-400' },
};

function getPartyStyle(party: string) {
  return PARTY_STYLES[party] ?? { bg: 'bg-slate-500/15', text: 'text-slate-400' };
}

function sentimentEmoji(sentiment: number): string {
  if (sentiment <= -0.5) return '🔴';
  if (sentiment <= -0.1) return '🟠';
  if (sentiment < 0.1) return '⚪';
  if (sentiment < 0.5) return '🟢';
  return '💚';
}

export function PoliticalPanel() {
  const { figures, isLoading, isError } = usePoliticalTrends();

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-slate-700/50">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          Política
        </h2>
        <p className="text-[10px] text-slate-500 mt-1">
          Figuras políticas con sentimiento
        </p>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="ml-2 text-xs text-slate-400">Cargando figuras...</span>
          </div>
        )}

        {isError && (
          <div className="p-4 text-center">
            <p className="text-xs text-red-400">
              Error al cargar datos políticos. Verifica el servicio trend-analyzer.
            </p>
          </div>
        )}

        {!isLoading && !isError && figures.length === 0 && (
          <div className="p-4 text-center">
            <p className="text-xs text-slate-500">
              No hay datos de figuras políticas en este momento.
            </p>
          </div>
        )}

        {!isLoading &&
          !isError &&
          figures.map((figure, idx) => (
            <FigureRow key={figure.name} figure={figure} index={idx} />
          ))}
      </div>

      {/* Footer */}
      {figures.length > 0 && (
        <div className="p-3 border-t border-slate-700/50 text-center">
          <span className="text-[10px] text-slate-500">
            {figures.length} figuras monitoreadas
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Single figure row ──────────────────────────────────────────

interface FigureRowProps {
  figure: PoliticalFigureTrend;
  index: number;
}

function FigureRow({ figure, index }: FigureRowProps) {
  const partyStyle = getPartyStyle(figure.party);
  const growthUp = figure.growthRate >= 0;

  return (
    <div
      className="w-full p-3 border-b border-slate-700/30 hover:bg-slate-700/40 transition-colors"
      style={{ animationDelay: `${index * 30}ms` }}
    >
      {/* Name + party badge */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-sm font-semibold text-slate-200 truncate">
          {sentimentEmoji(figure.avgSentiment)}{' '}
          {figure.name}
        </span>
        <span
          className={`inline-flex shrink-0 items-center px-1.5 py-0.5 text-[10px] font-medium rounded border ${partyStyle.bg} ${partyStyle.text} border-transparent`}
        >
          {figure.party}
        </span>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-3 text-xs">
        {/* Mentions */}
        <span className="text-slate-400 tabular-nums">
          {figure.mentions24h.toLocaleString('es-AR')} menciones
        </span>

        {/* Growth */}
        <span className={`flex items-center gap-0.5 ${growthUp ? 'text-green-400' : 'text-red-400'}`}>
          <span className="text-sm font-bold">{growthUp ? '↑' : '↓'}</span>
          <span className="tabular-nums">
            {growthUp ? '+' : ''}{figure.growthRate}%
          </span>
        </span>

        {/* Sentiment bar */}
        <div className="flex-1 h-1 rounded-full bg-slate-600/30 overflow-hidden">
          <div
            className={`h-full rounded-full ${figure.avgSentiment >= 0 ? 'bg-green-500/60' : 'bg-red-500/60'}`}
            style={{
              width: `${Math.abs(figure.avgSentiment) * 100}%`,
              marginLeft: figure.avgSentiment < 0 ? '0' : 'auto',
            }}
          />
        </div>
      </div>
    </div>
  );
}
