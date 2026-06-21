/**
 * ProvinceDetailPanel — Slide-in panel from the right side.
 *
 * Shows province details when a province is selected on the globe:
 * - Province name and key stats
 * - Tabs: Eventos, Economía, Alertas, Política
 * - Each tab shows filtered data for that province
 *
 * Uses framer-motion for slide-in animation.
 */

import { useState, useMemo } from 'react';
import { LazyMotion, domAnimation, m, AnimatePresence } from 'framer-motion';
import { useRadarStore } from '../../stores/radarStore';
import { useEvents } from '../../hooks/useEvents';
import { useNews } from '../../hooks/useNews';

type DetailTab = 'events' | 'economy' | 'alerts' | 'politics';

const TABS: { id: DetailTab; label: string }[] = [
  { id: 'events', label: 'Eventos' },
  { id: 'economy', label: 'Economía' },
  { id: 'alerts', label: 'Alertas' },
  { id: 'politics', label: 'Política' },
];

export function ProvinceDetailPanel() {
  const selectedProvince = useRadarStore((s) => s.selectedProvince);
  const clearProvinceSelection = useRadarStore((s) => s.clearProvinceSelection);
  const [activeTab, setActiveTab] = useState<DetailTab>('events');

  // Fetch filtered data for the selected province
  const { events, total: totalEvents, isLoading: eventsLoading } = useEvents({
    province: selectedProvince ?? undefined,
    limit: 20,
  });

  const { articles, total: totalArticles, isLoading: newsLoading } = useNews({
    province: selectedProvince ?? undefined,
    limit: 20,
  });

  const stats = useMemo(() => {
    if (!selectedProvince) return null;
    // Compute stats from available data
    const eventsToday = events.filter((e) => {
      const d = new Date(e.publishedAt);
      const now = new Date();
      return d.toDateString() === now.toDateString();
    }).length;

    const eventsThisWeek = events.filter((e) => {
      const d = new Date(e.publishedAt);
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      return d >= weekAgo;
    }).length;

    return { eventsToday, eventsThisWeek };
  }, [events, selectedProvince]);

  const handleClear = () => {
    clearProvinceSelection();
  };

  const handleKeyDown = (e: React.KeyboardEvent, tabId: DetailTab) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setActiveTab(tabId);
    }
  };

  return (
    <AnimatePresence>
      {selectedProvince && (
        <LazyMotion features={domAnimation}>
        <m.aside
          key="province-detail-panel"
          initial={{ x: 380 }}
          animate={{ x: 0 }}
          exit={{ x: 380 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="fixed right-0 top-14 bottom-12 w-[380px] z-30 bg-slate-800/95 backdrop-blur-md border-l border-slate-700/50 flex flex-col shadow-2xl"
        >
          {/* Header */}
          <div className="p-4 border-b border-slate-700/50 shrink-0">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-bold text-slate-100 truncate">
                {selectedProvince}
              </h2>
              <button
                onClick={handleClear}
                className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-700/60 transition-colors cursor-pointer"
                aria-label="Cerrar panel"
               type="button">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                  <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                </svg>
              </button>
            </div>

            {/* Quick stats */}
            <div className="grid grid-cols-3 gap-2 mt-2">
              <div className="bg-slate-700/40 rounded-lg p-2 text-center">
                <span className="block text-lg font-bold text-yellow-400 tabular-nums">
                  {stats?.eventsToday ?? (
                    eventsLoading ? (
                      <span className="inline-block w-4 h-4 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin align-middle" />
                    ) : '—'
                  )}
                </span>
                <span className="text-[10px] text-slate-400 uppercase tracking-wider">Hoy</span>
              </div>
              <div className="bg-slate-700/40 rounded-lg p-2 text-center">
                <span className="block text-lg font-bold text-blue-400 tabular-nums">
                  {stats?.eventsThisWeek ?? (
                    eventsLoading ? (
                      <span className="inline-block w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin align-middle" />
                    ) : '—'
                  )}
                </span>
                <span className="text-[10px] text-slate-400 uppercase tracking-wider">Semana</span>
              </div>
              <div className="bg-slate-700/40 rounded-lg p-2 text-center">
                <span className="block text-lg font-bold text-emerald-400 tabular-nums">
                  {totalEvents ?? '—'}
                </span>
                <span className="text-[10px] text-slate-400 uppercase tracking-wider">Total</span>
              </div>
            </div>

            {/* Quick action buttons */}
            <div className="flex gap-2 mt-3">
              <button type="button"
                onClick={() => setActiveTab('events')}
                className="flex-1 text-xs font-medium py-1.5 px-2 bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 hover:text-white rounded-md transition-colors cursor-pointer"
              >
                Ver noticias
              </button>
              <button type="button"
                onClick={() => setActiveTab('economy')}
                className="flex-1 text-xs font-medium py-1.5 px-2 bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 hover:text-white rounded-md transition-colors cursor-pointer"
              >
                Ver economía
              </button>
              <button type="button"
                onClick={() => setActiveTab('alerts')}
                className="flex-1 text-xs font-medium py-1.5 px-2 bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 hover:text-white rounded-md transition-colors cursor-pointer"
              >
                Ver alertas
              </button>
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex border-b border-slate-700/50 shrink-0" role="tablist">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button type="button"
                  key={tab.id}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveTab(tab.id)}
                  onKeyDown={(e) => handleKeyDown(e, tab.id)}
                  className={`flex-1 text-xs font-medium py-2.5 px-2 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500/40 ${
                    isActive
                      ? 'text-slate-100 border-b-2 border-blue-500 bg-slate-700/30'
                      : 'text-slate-500 hover:text-slate-300 border-b-2 border-transparent hover:bg-slate-700/20'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === 'events' && (
              <div className="p-4">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                  Eventos en {selectedProvince}
                </h3>
                {eventsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    <span className="ml-2 text-xs text-slate-400">Cargando...</span>
                  </div>
                ) : events.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-8">
                    No hay eventos registrados en {selectedProvince}.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {events.map((event) => (
                      <div
                        key={event.id}
                        className="p-3 bg-slate-700/30 rounded-lg border border-slate-600/30"
                      >
                        <h4 className="text-sm font-medium text-slate-200 leading-snug mb-1 line-clamp-2">
                          {event.title}
                        </h4>
                        <div className="flex items-center gap-2 text-[10px] text-slate-500">
                          <span>{event.location?.city ? `${event.location.city}, ` : ''}{event.location?.province}</span>
                          <span>·</span>
                          <span className="capitalize">{event.consensus}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'economy' && (
              <div className="p-4">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                  Economía en {selectedProvince}
                </h3>
                <div className="bg-slate-700/30 rounded-lg p-4 text-center">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-8 h-8 mx-auto text-slate-500 mb-2">
                    <path d="M10 8a3 3 0 100-6 3 3 0 000 6zM3.465 14.493a1.23 1.23 0 00.41 1.412A9.957 9.957 0 0010 18.75c2.132 0 4.102-.665 5.726-1.803.39-.302.506-.846.222-1.258A5.403 5.403 0 0010 12.5a5.403 5.403 0 00-5.949 3.242 1.23 1.23 0 00-.586.751z" />
                  </svg>
                  <p className="text-xs text-slate-400">
                    Los datos económicos provinciales estarán disponibles próximamente.
                  </p>
                  <p className="text-[10px] text-slate-500 mt-1">
                    Datos a nivel nacional disponibles en el ticker inferior.
                  </p>
                </div>
              </div>
            )}

            {activeTab === 'alerts' && (
              <div className="p-4">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                  Alertas en {selectedProvince}
                </h3>
                <p className="text-xs text-slate-500 text-center py-8">
                  Alertas meteorológicas y de seguridad para {selectedProvince}.
                </p>
              </div>
            )}

            {activeTab === 'politics' && (
              <div className="p-4">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                  Política en {selectedProvince}
                </h3>
                {newsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    <span className="ml-2 text-xs text-slate-400">Cargando...</span>
                  </div>
                ) : articles.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-8">
                    No hay noticias políticas en {selectedProvince}.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {articles.filter((a) => a.category === 'politica').slice(0, 10).map((article) => (
                      <div
                        key={article.id}
                        className="p-3 bg-slate-700/30 rounded-lg border border-slate-600/30"
                      >
                        <h4 className="text-sm font-medium text-slate-200 leading-snug mb-1 line-clamp-2">
                          {article.title}
                        </h4>
                        <div className="flex items-center gap-2 text-[10px] text-slate-500">
                          <span>{article.source}</span>
                          <span>·</span>
                          <span>{article.location?.province}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </m.aside>
        </LazyMotion>
      )}
    </AnimatePresence>
  );
}


