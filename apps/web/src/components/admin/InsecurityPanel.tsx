/**
 * InsecurityPanel — Province-level security statistics panel.
 *
 * Shows a list of provinces with color-coded bars based on crime density.
 * Supports filtering by crime category and toggling between 7d / 30d views.
 * Clicking a province shows a detailed breakdown.
 */

import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchSecurityStats, type ProvinceSecurityStats } from '../../services/api';

const CRIME_CATEGORIES = [
  { value: '', label: 'Todas' },
  { value: 'robo', label: 'Robo' },
  { value: 'homicidio', label: 'Homicidio' },
  { value: 'narcotrafico', label: 'Narcotráfico' },
  { value: 'corrupcion', label: 'Corrupción' },
  { value: 'secuestro', label: 'Secuestro' },
  { value: 'estafa', label: 'Estafa' },
  { value: 'violencia_genero', label: 'Violencia de Género' },
];

const TREND_LABELS: Record<string, { label: string; color: string }> = {
  up: { label: '↑ Alza', color: 'text-red-400' },
  down: { label: '↓ Baja', color: 'text-green-400' },
  stable: { label: '→ Estable', color: 'text-yellow-400' },
};

function getCrimeDensityColor(density: number, avg: number): string {
  if (density <= avg * 0.8) return 'bg-green-500';
  if (density <= avg * 1.2) return 'bg-yellow-500';
  return 'bg-red-500';
}

function getCrimeDensityBg(density: number, avg: number): string {
  if (density <= avg * 0.8) return 'bg-green-500/20';
  if (density <= avg * 1.2) return 'bg-yellow-500/20';
  return 'bg-red-500/20';
}

interface DetailViewProps {
  stat: ProvinceSecurityStats;
  onClose: () => void;
  period: string;
}

function DetailView({ stat, onClose, period }: DetailViewProps) {
  const totalEvents = period === '7d' ? stat.total_events_7d : stat.total_events_30d;

  return (
    <div className="p-4 bg-slate-800/60 rounded-lg border border-slate-700/50">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-200">{stat.province}</h3>
        <button
          onClick={onClose}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
        >
          ✕ Cerrar
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="p-2 bg-slate-900/40 rounded">
          <div className="text-xs text-slate-500">Eventos ({period})</div>
          <div className="text-lg font-bold text-slate-100">{totalEvents}</div>
        </div>
        <div className="p-2 bg-slate-900/40 rounded">
          <div className="text-xs text-slate-500">Densidad</div>
          <div className="text-lg font-bold text-slate-100">
            {stat.crime_density.toFixed(2)}
            <span className="text-xs text-slate-500 ml-1">/100k</span>
          </div>
        </div>
      </div>

      {/* Trend */}
      <div className="mb-3">
        <span className="text-xs text-slate-500">Tendencia: </span>
        <span className={`text-xs font-medium ${TREND_LABELS[stat.trend_direction]?.color ?? 'text-slate-400'}`}>
          {TREND_LABELS[stat.trend_direction]?.label ?? stat.trend_direction}
        </span>
      </div>

      {/* Top Categories */}
      <div>
        <div className="text-xs text-slate-500 mb-1.5">Categorías principales</div>
        <div className="space-y-1">
          {stat.top_categories.map((cat) => (
            <div key={cat.category} className="flex items-center justify-between text-xs">
              <span className="text-slate-300 capitalize">{cat.category}</span>
              <span className="text-slate-500 font-mono">{cat.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function InsecurityPanel() {
  const [selectedCategory, setSelectedCategory] = useState('');
  const [period, setPeriod] = useState<'7d' | '30d'>('30d');
  const [selectedProvince, setSelectedProvince] = useState<ProvinceSecurityStats | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['security-stats', selectedCategory, period],
    queryFn: () => fetchSecurityStats({
      category: selectedCategory || undefined,
      period,
    }),
    refetchInterval: 60000, // 1 min
    staleTime: 30000,
  });

  const stats = data?.stats ?? [];
  const avgDensity = stats.length > 0
    ? stats.reduce((sum, s) => sum + s.crime_density, 0) / stats.length
    : 0;

  const handleProvinceClick = useCallback((stat: ProvinceSecurityStats) => {
    setSelectedProvince((prev) => (prev?.province === stat.province ? null : stat));
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-slate-700/50">
        <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
          Insecurity Radar
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Estadísticas de seguridad por provincia
        </p>
      </div>

      {/* Filters */}
      <div className="p-3 border-b border-slate-700/50 space-y-2">
        {/* Category filter */}
        <div className="flex flex-wrap gap-1">
          {CRIME_CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => setSelectedCategory(cat.value)}
              className={`px-2 py-0.5 text-xs rounded-full transition-colors cursor-pointer ${
                selectedCategory === cat.value
                  ? 'bg-red-600/40 text-red-200 border border-red-500/40'
                  : 'bg-slate-800 text-slate-400 border border-slate-700/50 hover:text-slate-200'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Period toggle */}
        <div className="flex rounded-lg border border-slate-700/50 bg-slate-800/60 p-0.5 w-fit">
          {(['7d', '30d'] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => setPeriod(opt)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all cursor-pointer ${
                period === opt
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      {/* Province list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="p-4 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-12 bg-slate-800 rounded-lg animate-pulse" />
            ))}
          </div>
        )}

        {isError && (
          <div className="p-4 text-xs text-red-400">
            Error al cargar estadísticas de seguridad
          </div>
        )}

        {!isLoading && !isError && stats.length === 0 && (
          <div className="p-4 text-xs text-slate-500 text-center">
            No hay datos de seguridad disponibles
          </div>
        )}

        {!isLoading && !isError && stats.length > 0 && (
          <div className="p-2 space-y-1">
            {stats.map((stat) => {
              const totalEvents = period === '7d' ? stat.total_events_7d : stat.total_events_30d;
              const maxEvents = Math.max(...stats.map((s) => period === '7d' ? s.total_events_7d : s.total_events_30d), 1);
              const barWidth = (totalEvents / maxEvents) * 100;

              const isSelected = selectedProvince?.province === stat.province;

              return (
                <div key={stat.province}>
                  <button
                    onClick={() => handleProvinceClick(stat)}
                    className={`w-full text-left p-2 rounded-md transition-colors cursor-pointer hover:bg-slate-700/40 ${
                      isSelected ? 'bg-slate-700/40' : ''
                    }`}
                  >
                    {/* Province name + stats */}
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-slate-200">{stat.province}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500 font-mono">{totalEvents}</span>
                        <span className={`text-xs font-medium ${TREND_LABELS[stat.trend_direction]?.color ?? ''}`}>
                          {TREND_LABELS[stat.trend_direction]?.label ?? ''}
                        </span>
                      </div>
                    </div>

                    {/* Color-coded bar */}
                    <div className="w-full h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${getCrimeDensityColor(stat.crime_density, avgDensity)}`}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>

                    {/* Density indicator */}
                    <div className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] ${getCrimeDensityBg(stat.crime_density, avgDensity)} text-slate-400`}>
                      {stat.crime_density.toFixed(1)} /100k
                    </div>
                  </button>

                  {/* Detail section */}
                  {isSelected && (
                    <div className="px-2 pb-2">
                      <DetailView
                        stat={stat}
                        onClose={() => setSelectedProvince(null)}
                        period={period}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
