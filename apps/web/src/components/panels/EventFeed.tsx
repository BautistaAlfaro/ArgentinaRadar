/**
 * Event Feed Panel
 *
 * Left sidebar (320px) showing grouped-event cards with:
 *   - Event headline
 *   - Article count badge ("5 fuentes")
 *   - Media consensus badge (Confirmado / Reportado / Sin verificar)
 *   - Impact score bar (0–100 colored bar)
 *   - Source list (max 3 displayed, "+X más" overflow)
 *   - Time ago ("hace 2h")
 *   - Location ("Rosario, Santa Fe")
 *   - Click handler: fly to event location + expand timeline
 */

import { useState, useCallback } from 'react';
import { useEvents } from '../../hooks/useEvents';
import { useRadarStore } from '../../stores/radarStore';
import { MediaConsensusBadge } from '../MediaConsensusBadge';
import { ImpactScoreBar } from '../ImpactScoreBar';
import type { EventItem, ConsensusLevel } from '../../services/api';

const CONSENSUS_OPTIONS: { value: ConsensusLevel | ''; label: string }[] = [
  { value: '', label: 'Todo nivel' },
  { value: 'high', label: 'Confirmado' },
  { value: 'medium', label: 'Reportado' },
  { value: 'low', label: 'Sin verificar' },
];

const PROVINCES: string[] = [
  'Buenos Aires',
  'Catamarca',
  'Chaco',
  'Chubut',
  'Ciudad Autónoma de Buenos Aires',
  'Córdoba',
  'Corrientes',
  'Entre Ríos',
  'Formosa',
  'Jujuy',
  'La Pampa',
  'La Rioja',
  'Mendoza',
  'Misiones',
  'Neuquén',
  'Río Negro',
  'Salta',
  'San Juan',
  'San Luis',
  'Santa Cruz',
  'Santa Fe',
  'Santiago del Estero',
  'Tierra del Fuego',
  'Tucumán',
];

const IMPACT_MIN_OPTIONS = [
  { value: 0, label: 'Todo impacto' },
  { value: 30, label: 'Medio +' },
  { value: 60, label: 'Alto +' },
];

export function EventFeed() {
  const [consensus, setConsensus] = useState<ConsensusLevel | ''>('');
  const [province, setProvince] = useState('');
  const [impactMin, setImpactMin] = useState(0);

  const selectNewsLocation = useRadarStore((s) => s.selectNewsLocation);
  const activateLayer = useRadarStore((s) => s.activateLayer);
  const selectEvent = useRadarStore((s) => s.selectEvent);

  const { events, isLoading, isError, total } = useEvents({
    consensus: consensus || undefined,
    province: province || undefined,
    impactMin: impactMin || undefined,
  });

  const handleEventClick = useCallback(
    (event: EventItem) => {
      if (event.location) {
        selectNewsLocation({
          lat: event.location.lat,
          lng: event.location.lng,
          articleId: event.id,
        });
        activateLayer('news');
      }
      selectEvent(event.id);
    },
    [selectNewsLocation, activateLayer, selectEvent],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-slate-700/50">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">
          Eventos
          {total > 0 && (
            <span className="ml-2 text-xs font-normal text-slate-500 normal-case">
              ({total})
            </span>
          )}
        </h2>

        {/* Filters */}
        <div className="space-y-2">
          {/* Consensus filter */}
          <select
            value={consensus}
            onChange={(e) => setConsensus(e.target.value as ConsensusLevel | '')}
            className="w-full text-xs bg-slate-700/60 border border-slate-600/50 rounded-md px-2.5 py-1.5 text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/50 cursor-pointer"
            aria-label="Filtrar por nivel de consenso"
          >
            {CONSENSUS_OPTIONS.map((o) => (
              <option key={String(o.value)} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          {/* Province filter */}
          <select
            value={province}
            onChange={(e) => setProvince(e.target.value)}
            className="w-full text-xs bg-slate-700/60 border border-slate-600/50 rounded-md px-2.5 py-1.5 text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/50 cursor-pointer"
            aria-label="Filtrar por provincia"
          >
            <option value="">Todas las provincias</option>
            {PROVINCES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          {/* Impact filter */}
          <select
            value={impactMin}
            onChange={(e) => setImpactMin(Number(e.target.value))}
            className="w-full text-xs bg-slate-700/60 border border-slate-600/50 rounded-md px-2.5 py-1.5 text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/50 cursor-pointer"
            aria-label="Filtrar por impacto mínimo"
          >
            {IMPACT_MIN_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="ml-2 text-xs text-slate-400">Cargando eventos...</span>
          </div>
        )}

        {isError && (
          <div className="p-4 text-center">
            <p className="text-xs text-red-400">
              Error al cargar eventos. Verifica que el servicio event-detector esté en ejecución.
            </p>
          </div>
        )}

        {!isLoading && !isError && events.length === 0 && (
          <div className="p-4 text-center">
            <p className="text-xs text-slate-500">No hay eventos con los filtros actuales.</p>
          </div>
        )}

        {!isLoading &&
          events.map((event) => (
            <EventCard key={event.id} event={event} onClick={handleEventClick} />
          ))}
      </div>

      {/* Footer */}
      {events.length > 0 && (
        <div className="p-3 border-t border-slate-700/50 text-center">
          <span className="text-xs text-slate-500">
            Mostrando {events.length} de {total} eventos
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Event Card ───────────────────────────────────────────────────

interface EventCardProps {
  event: EventItem;
  onClick: (event: EventItem) => void;
}

function EventCard({ event, onClick }: EventCardProps) {
  const timeAgo = getTimeAgo(event.publishedAt);

  const sourceLabel =
    event.articleCount <= 1
      ? '1 fuente'
      : `${event.articleCount} fuentes`;

  return (
    <button type="button"
      onClick={() => onClick(event)}
      className="w-full text-left p-3 border-b border-slate-700/30 hover:bg-slate-700/40 transition-colors cursor-pointer group focus:outline-none focus:bg-slate-700/40"
    >
      {/* Badge row */}
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded border bg-slate-600/20 text-slate-300 border-slate-500/30">
          {sourceLabel}
        </span>
        <MediaConsensusBadge level={event.consensus} articleCount={event.articleCount} />
      </div>

      {/* Headline */}
      <h3 className="text-sm font-medium text-slate-200 group-hover:text-white transition-colors leading-snug mb-2 line-clamp-2">
        {event.title}
      </h3>

      {/* Summary */}
      {event.summary && (
        <p className="text-xs text-slate-400 leading-relaxed mb-2 line-clamp-2">
          {event.summary}
        </p>
      )}

      {/* Impact score bar */}
      <div className="mb-2">
        <ImpactScoreBar score={event.impactScore} />
      </div>

      {/* Source list */}
      <SourceBadges sources={event.sources} />

      {/* Footer: location + time */}
      <div className="flex items-center justify-between text-[10px] text-slate-500">
        <span className="truncate max-w-[180px]">
          {event.location
            ? `${event.location.city ? `${event.location.city}, ` : ''}${event.location.province}`
            : 'Sin ubicación'}
        </span>
        <span className="shrink-0 ml-2">{timeAgo}</span>
      </div>
    </button>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────

function SourceBadges({ sources }: { sources: string[] }) {
  if (sources.length === 0) return null;
  const visible = sources.slice(0, 3);
  const remainder = sources.length - 3;
  const parts = visible.join(', ');
  const text = remainder > 0 ? `${parts} +${remainder} más` : parts;
  return <p className="text-[10px] text-slate-500 mb-1.5 truncate">{text}</p>;
}

function getTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return 'ahora';

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) return `hace ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days}d`;

  return new Date(dateStr).toLocaleDateString('es-AR');
}


