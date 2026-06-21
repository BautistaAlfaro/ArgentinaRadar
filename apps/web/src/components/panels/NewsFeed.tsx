/**
 * News Feed Panel
 *
 * Left sidebar (320px) with scrollable article list.
 * Filters:
 *   - Category dropdown (política/economía/sociedad/deportes/todas)
 *   - Province dropdown (all 24 provinces + todas)
 * Clicking an article centers the map on its location.
 */

import { useState, useCallback } from 'react';
import { useNews } from '../../hooks/useNews';
import { useRadarStore } from '../../stores/radarStore';
import type { NewsItem } from '@shared/types';

const CATEGORIES: { value: string; label: string }[] = [
  { value: '', label: 'Todas las categorías' },
  { value: 'politica', label: 'Política' },
  { value: 'economia', label: 'Economía' },
  { value: 'sociedad', label: 'Sociedad' },
  { value: 'deportes', label: 'Deportes' },
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

export function NewsFeed() {
  const [category, setCategory] = useState('');
  const [province, setProvince] = useState('');
  const selectNewsLocation = useRadarStore((s) => s.selectNewsLocation);
  const activateLayer = useRadarStore((s) => s.activateLayer);

  const { articles, isLoading, isError, total } = useNews({
    category: category || undefined,
    province: province || undefined,
  });

  const handleArticleClick = useCallback(
    (article: NewsItem) => {
      if (article.location) {
        selectNewsLocation({
          lat: article.location.lat,
          lng: article.location.lng,
          articleId: article.id,
        });
        // Ensure the news layer is active so marker is visible
        activateLayer('news');
      }
    },
    [selectNewsLocation, activateLayer],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-slate-700/50">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">
          Noticias
          {total > 0 && (
            <span className="ml-2 text-xs font-normal text-slate-500 normal-case">
              ({total})
            </span>
          )}
        </h2>

        {/* Filters */}
        <div className="space-y-2">
          {/* Category filter */}
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full text-xs bg-slate-700/60 border border-slate-600/50 rounded-md px-2.5 py-1.5 text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/50 cursor-pointer"
            aria-label="Filtrar por categoría"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
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
        </div>
      </div>

      {/* Article list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="ml-2 text-xs text-slate-400">Cargando noticias...</span>
          </div>
        )}

        {isError && (
          <div className="p-4 text-center">
            <p className="text-xs text-red-400">
              Error al cargar noticias. Verifica que los servicios estén en ejecución.
            </p>
          </div>
        )}

        {!isLoading && !isError && articles.length === 0 && (
          <div className="p-4 text-center">
            <p className="text-xs text-slate-500">
              No hay noticias con ubicación geolocalizada.
            </p>
          </div>
        )}

        {!isLoading &&
          articles.map((article) => (
            <ArticleCard
              key={article.id}
              article={article}
              onClick={handleArticleClick}
            />
          ))}
      </div>

      {/* Footer */}
      {articles.length > 0 && (
        <div className="p-3 border-t border-slate-700/50 text-center">
          <span className="text-xs text-slate-500">
            Mostrando {articles.length} de {total} noticias
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Article Card ─────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  politica: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  economia: 'bg-green-500/20 text-green-400 border-green-500/30',
  sociedad: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  deportes: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
};

interface ArticleCardProps {
  article: NewsItem;
  onClick: (article: NewsItem) => void;
}

function ArticleCard({ article, onClick }: ArticleCardProps) {
  const catColor = CATEGORY_COLORS[article.category] ?? 'bg-slate-500/20 text-slate-400 border-slate-500/30';

  const timeAgo = getTimeAgo(article.publishedAt);

  return (
    <button
      onClick={() => onClick(article)}
      className="w-full text-left p-3 border-b border-slate-700/30 hover:bg-slate-700/40 transition-colors cursor-pointer group focus:outline-none focus:bg-slate-700/40"
    >
      {/* Category badge */}
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded border ${catColor}`}
        >
          {article.category}
        </span>
        <span className="text-[10px] text-slate-500">{article.source}</span>
      </div>

      {/* Headline */}
      <h3 className="text-sm font-medium text-slate-200 group-hover:text-white transition-colors leading-snug mb-1 line-clamp-2">
        {article.title}
      </h3>

      {/* Summary */}
      <p className="text-xs text-slate-400 leading-relaxed mb-2 line-clamp-2">
        {article.summary}
      </p>

      {/* Footer: location + time */}
      <div className="flex items-center justify-between text-[10px] text-slate-500">
        <span className="truncate max-w-[180px]">
          {article.location
            ? `${article.location.province}${article.location.landmark ? ` · ${article.location.landmark}` : ''}`
            : 'Sin ubicación'}
        </span>
        <span className="shrink-0 ml-2">{timeAgo}</span>
      </div>
    </button>
  );
}

// ─── Utility ──────────────────────────────────────────────
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
