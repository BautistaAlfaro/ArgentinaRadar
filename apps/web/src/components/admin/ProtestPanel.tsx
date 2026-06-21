/**
 * ProtestPanel — Active protests and cortes monitoring panel.
 *
 * Lists active protests with route/type/status badges, time since started,
 * source count, and estimated duration. Clicking on a protest fires
 * a callback to fly the map to that protest's location.
 */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchProtests, type ProtestItem, type ProtestType } from '../../services/api';
import { useRadarStore } from '../../stores/radarStore';

const PROTEST_TYPE_LABELS: Record<ProtestType, string> = {
  corte_total: 'Corte Total',
  corte_parcial: 'Corte Parcial',
  marcha: 'Marcha',
  piquete: 'Piquete',
  paro: 'Paro',
  movilizacion: 'Movilización',
};

const PROTEST_TYPE_COLORS: Record<ProtestType, string> = {
  corte_total: 'bg-red-600/30 text-red-300 border-red-500/40',
  corte_parcial: 'bg-orange-600/30 text-orange-300 border-orange-500/40',
  marcha: 'bg-yellow-600/30 text-yellow-300 border-yellow-500/40',
  piquete: 'bg-blue-600/30 text-blue-300 border-blue-500/40',
  paro: 'bg-purple-600/30 text-purple-300 border-purple-500/40',
  movilizacion: 'bg-teal-600/30 text-teal-300 border-teal-500/40',
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-500/20 text-green-400 border-green-500/30',
  dispersed: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  resolved: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
};

function formatTimeSince(startedAt: string): string {
  const diff = Date.now() - new Date(startedAt).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 48) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatDuration(minutes: number | null): string {
  if (minutes == null) return '—';
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)}d`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes}min`;
}

interface ProtestCardProps {
  protest: ProtestItem;
  onSelect: (protest: ProtestItem) => void;
}

function ProtestCard({ protest, onSelect }: ProtestCardProps) {
  const typeLabel = PROTEST_TYPE_LABELS[protest.protest_type] ?? protest.protest_type;
  const typeColor = PROTEST_TYPE_COLORS[protest.protest_type] ?? 'bg-slate-600/30 text-slate-300';
  const statusColor = STATUS_COLORS[protest.status] ?? STATUS_COLORS.active;

  return (
    <button type="button"
      onClick={() => onSelect(protest)}
      className="w-full text-left p-3 rounded-lg border border-slate-700/50 bg-slate-800/40 hover:bg-slate-700/40 transition-colors cursor-pointer"
    >
      {/* Top row: route + type badge */}
      <div className="flex items-start justify-between mb-2">
        <div className="min-w-0 flex-1">
          {protest.route_name ? (
            <span className="text-sm font-medium text-slate-200">
              {protest.route_name}
              {protest.km != null ? ` · km ${protest.km}` : ''}
            </span>
          ) : (
            <span className="text-sm font-medium text-slate-400">
              {protest.city ?? protest.province}
            </span>
          )}
        </div>
        <span className={`ml-2 px-1.5 py-0.5 text-[10px] font-medium rounded-md border ${typeColor}`}>
          {typeLabel}
        </span>
      </div>

      {/* Location */}
      <div className="text-xs text-slate-500 mb-2">
        {protest.city ? `${protest.city}, ` : ''}
        {protest.province}
      </div>

      {/* Bottom row: stats */}
      <div className="flex items-center gap-3 text-[11px]">
        {/* Status badge */}
        <span className={`px-1.5 py-0.5 rounded-full border ${statusColor}`}>
          {protest.status === 'active' ? 'Activo' : protest.status === 'dispersed' ? 'Disperso' : 'Resuelto'}
        </span>

        {/* Time since started */}
        <span className="text-slate-500">
          ⏱ {formatTimeSince(protest.started_at)}
        </span>

        {/* Source count */}
        <span className="text-slate-500">
          📰 {protest.article_count}
        </span>

        {/* Estimated duration */}
        {protest.estimated_duration_minutes != null && (
          <span className="text-slate-500">
            ⌛ {formatDuration(protest.estimated_duration_minutes)}
          </span>
        )}
      </div>
    </button>
  );
}

interface Props {
  onFlyTo?: (lat: number, lng: number) => void;
}

export function ProtestPanel({ onFlyTo }: Props) {
  const selectNewsLocation = useRadarStore((s) => s.selectNewsLocation);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['protests', 'active'],
    queryFn: () => fetchProtests({ status: 'active' }),
    refetchInterval: 15000, // 15s — faster refresh for protests
    staleTime: 10000,
  });

  const protests = data?.protests ?? [];

  const handleSelectProtest = (protest: ProtestItem) => {
    // Fly to protest location on the map
    if (onFlyTo) {
      onFlyTo(protest.lat, protest.lng);
    } else {
      selectNewsLocation({
        lat: protest.lat,
        lng: protest.lng,
        articleId: protest.id,
      });
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-slate-700/50">
        <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
          Protestas 🚧
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Cortes y manifestaciones activos · {protests.length} activo{protests.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Protest list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="p-3 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 bg-slate-800 rounded-lg animate-pulse" />
            ))}
          </div>
        )}

        {isError && (
          <div className="p-4 text-xs text-red-400">
            Error al cargar protestas activas
          </div>
        )}

        {!isLoading && !isError && protests.length === 0 && (
          <div className="p-4 text-xs text-slate-500 text-center">
            No hay protestas activas en este momento
          </div>
        )}

        {!isLoading && !isError && protests.length > 0 && (
          <div className="p-2 space-y-2">
            {protests.map((protest) => (
              <ProtestCard
                key={protest.id}
                protest={protest}
                onSelect={handleSelectProtest}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


