/**
 * EventTimeline
 *
 * Vertical timeline panel showing how a grouped event evolved across
 * multiple sources. Articles are sorted oldest-first with timestamps,
 * source badges, and truncated headlines. Dismissible via close button.
 */

import { useRadarStore } from '../stores/radarStore';
import { useEventTimeline } from '../hooks/useEventTimeline';
import { MediaConsensusBadge } from './MediaConsensusBadge';
import { ImpactScoreBar } from './ImpactScoreBar';

export function EventTimeline() {
  const selectedEventId = useRadarStore((s) => s.selectedEventId);
  const selectEvent = useRadarStore((s) => s.selectEvent);

  const { event, isLoading, isError } = useEventTimeline(selectedEventId);

  if (!selectedEventId) return null;

  const handleClose = () => selectEvent(null);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-12 sm:pt-20">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="relative w-full max-w-lg mx-4 bg-slate-800/95 border border-slate-700/50 rounded-xl shadow-2xl overflow-hidden max-h-[75vh] flex flex-col">
        {/* Header */}
        <div className="shrink-0 flex items-start justify-between p-4 border-b border-slate-700/50">
          <div className="flex-1 min-w-0">
            {isLoading && (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs text-slate-400">Cargando evento...</span>
              </div>
            )}

            {isError && (
              <p className="text-xs text-red-400">
                Error al cargar el detalle del evento.
              </p>
            )}

            {event && (
              <>
                <h3 className="text-sm font-semibold text-slate-100 leading-snug mb-2 pr-8">
                  {event.title}
                </h3>
                <div className="flex items-center gap-3 flex-wrap">
                  <ImpactScoreBar score={event.impactScore} />
                  <MediaConsensusBadge
                    level={event.consensus}
                    articleCount={event.articleCount}
                  />
                  <span className="text-[11px] text-slate-500">
                    {event.articleCount} {event.articleCount === 1 ? 'fuente' : 'fuentes'} reportaron este evento
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Close button */}
          <button
            onClick={handleClose}
            className="shrink-0 ml-2 p-1 rounded-md text-slate-500 hover:text-slate-200 hover:bg-slate-700/60 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            aria-label="Cerrar timeline"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        {/* Timeline body */}
        <div className="flex-1 overflow-y-auto p-4">
          {event && <Timeline articles={event.articles} />}
        </div>
      </div>
    </div>
  );
}

// ─── Timeline list ──────────────────────────────────────────────

interface ArticleEntry {
  id: string;
  title: string;
  source: string;
  publishedAt: string;
  url: string;
}

function Timeline({ articles }: { articles: ArticleEntry[] }) {
  const sorted = [...articles].sort(
    (a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime(),
  );

  if (sorted.length === 0) {
    return (
      <p className="text-xs text-slate-500 text-center py-4">
        No hay artículos asociados a este evento.
      </p>
    );
  }

  return (
    <div className="relative">
      {/* Vertical line */}
      <div className="absolute left-[11px] top-1 bottom-1 w-0.5 bg-slate-700/60" aria-hidden="true" />

      <div className="space-y-4">
        {sorted.map((article, index) => (
          <TimelineItem key={article.id} article={article} isFirst={index === 0} isLast={index === sorted.length - 1} />
        ))}
      </div>
    </div>
  );
}

// ─── Single timeline dot + card ─────────────────────────────────

function TimelineItem({
  article,
  isFirst,
  isLast,
}: {
  article: ArticleEntry;
  isFirst: boolean;
  isLast: boolean;
}) {
  const formattedTime = formatTimestamp(article.publishedAt);

  return (
    <div className="flex gap-3">
      {/* Dot column */}
      <div className="flex flex-col items-center shrink-0">
        <div
          className={`w-[22px] h-[22px] rounded-full border-2 flex items-center justify-center ${
            isFirst
              ? 'bg-blue-500 border-blue-400'
              : 'bg-slate-700 border-slate-600'
          }`}
        >
          <div className={`w-[6px] h-[6px] rounded-full ${isFirst ? 'bg-white' : 'bg-slate-400'}`} />
        </div>
      </div>

      {/* Card */}
      <div className="flex-1 min-w-0 pb-1">
        <div className="bg-slate-700/40 border border-slate-700/50 rounded-lg p-3 hover:bg-slate-700/60 transition-colors">
          {/* Source badge + time */}
          <div className="flex items-center gap-2 mb-1.5">
            <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-slate-600/30 text-slate-300 border border-slate-500/30 shrink-0">
              {article.source}
            </span>
            <span className="text-[10px] text-slate-500">{formattedTime}</span>
          </div>

          {/* Headline */}
          <p className="text-xs text-slate-200 leading-snug line-clamp-2">
            {article.title}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffHours = diffMs / 3_600_000;

  if (diffHours < 1) {
    const mins = Math.round(diffMs / 60_000);
    return `hace ${mins} min`;
  }
  if (diffHours < 24) {
    const hrs = Math.round(diffHours);
    return `hace ${hrs}h`;
  }

  return d.toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
