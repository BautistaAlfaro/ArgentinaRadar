/**
 * Trending Topics Panel
 *
 * Shows the top 10 trending entities (personas, lugares, organizaciones)
 * with mention counts, growth indicators, and scores. Clicking an entity
 * will eventually filter events — for now just logs to console.
 */

import { useTrends } from '../../hooks/useTrends';
import { useRadarStore } from '../../stores/radarStore';
import type { TrendingEntity } from '../../services/api';

const TYPE_COLORS: Record<string, string> = {
  persona: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  lugar: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  organización: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
};

const TYPE_LABELS: Record<string, string> = {
  persona: 'Persona',
  lugar: 'Lugar',
  organización: 'Org.',
};

export function TrendingTopics() {
  const selectedProvince = useRadarStore((s) => s.selectedProvince);
  const { trends, isLoading, isError } = useTrends();

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-slate-700/50">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          Tendencias
        </h2>
        {selectedProvince && (
          <p className="text-[10px] text-blue-400 mt-1">
            Mostrando tendencias relacionadas con {selectedProvince}
          </p>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="ml-2 text-xs text-slate-400">Cargando tendencias...</span>
          </div>
        )}

        {isError && (
          <div className="p-4 text-center">
            <p className="text-xs text-red-400">
              Error al cargar tendencias. Verifica que el servicio trends esté en ejecución.
            </p>
          </div>
        )}

        {!isLoading && !isError && trends.length === 0 && (
          <div className="p-4 text-center">
            <p className="text-xs text-slate-500">No hay tendencias en este momento.</p>
          </div>
        )}

        {!isLoading &&
          !isError &&
          trends.slice(0, 10).map((entity) => (
            <TrendingRow key={entity.name} entity={entity} />
          ))}
      </div>
    </div>
  );
}

// ─── Single trending row ────────────────────────────────────────

interface TrendingRowProps {
  entity: TrendingEntity;
}

function TrendingRow({ entity }: TrendingRowProps) {
  const growthIcon = entity.growthRate > 0 ? '↑' : entity.growthRate < 0 ? '↓' : '→';
  const growthColor =
    entity.growthRate > 0
      ? 'text-green-400'
      : entity.growthRate < 0
        ? 'text-red-400'
        : 'text-slate-400';
  const growthLabel =
    entity.growthRate > 0 ? 'en alza' : entity.growthRate < 0 ? 'bajando' : 'estable';

  const typeClass = TYPE_COLORS[entity.type] ?? TYPE_COLORS.organización;
  const typeLabel = TYPE_LABELS[entity.type] ?? entity.type;

  const handleClick = () => {
    console.log(`[TrendingTopics] Filter by entity: ${entity.name} (${entity.type})`);
  };

  return (
    <button
      onClick={handleClick}
      className="w-full text-left p-3 border-b border-slate-700/30 hover:bg-slate-700/40 transition-colors cursor-pointer group focus:outline-none focus:bg-slate-700/40"
    >
      {/* Entity name + type badge */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-sm font-semibold text-slate-200 group-hover:text-white transition-colors truncate">
          {entity.name}
        </span>
        <span
          className={`inline-flex shrink-0 items-center px-1.5 py-0.5 text-[10px] font-medium rounded border ${typeClass}`}
        >
          {typeLabel}
        </span>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-3 text-xs">
        {/* Mentions */}
        <span className="text-slate-400">
          {entity.mentions.toLocaleString('es-AR')} menciones
        </span>

        {/* Growth arrow + label */}
        <span className={`flex items-center gap-0.5 ${growthColor}`}>
          <span className="text-sm font-bold">{growthIcon}</span>
          <span className="text-[11px]">{growthLabel}</span>
        </span>

        {/* Growth rate */}
        <span className={`tabular-nums font-medium ${growthColor}`}>
          {entity.growthRate > 0 ? '+' : ''}
          {entity.growthRate}%
        </span>

        {/* Spacer */}
        <span className="flex-1" />

        {/* Score */}
        <span className="tabular-nums text-slate-500 text-[11px]">
          {entity.score}
        </span>
      </div>
    </button>
  );
}
