/**
 * ProvinceGlobePopup — Floating popup on the 3D globe.
 *
 * Appears near the selected province showing its name, stats, and
 * quick-action buttons. Positioned using globe.getScreenCoords() projected
 * to viewport coordinates via the container element.
 * Dismissible via close button or clicking outside.
 *
 * Uses TanStack Query hooks for stats — data is cached so no duplicate
 * API calls with the ProvinceDetailPanel.
 */

import { useEffect, useRef, useState, useCallback, useMemo, type RefObject } from 'react';
import type { FeatureCollection, Feature, Polygon } from 'geojson';
import { useRadarStore } from '../../stores/radarStore';
import { useEvents } from '../../hooks/useEvents';
import provincesData from '@shared/geo/argentina-provinces.geojson';

interface ProvinceProperties {
  name: string;
  name_short: string;
  centroid: [number, number];
  region: string;
}

type ProvinceFeature = Feature<Polygon, ProvinceProperties>;

interface Props {
  globe: any;
  containerRef: RefObject<HTMLElement | null>;
}

export function ProvinceGlobePopup({ globe, containerRef }: Props) {
  const selectedProvince = useRadarStore((s) => s.selectedProvince);
  const clearProvinceSelection = useRadarStore((s) => s.clearProvinceSelection);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [visible, setVisible] = useState(false);
  const provinceDataRef = useRef<ProvinceProperties | null>(null);

  // Fetch events for the selected province (TanStack Query caches this)
  const { events: provinceEvents, isLoading: eventsLoading } = useEvents({
    province: selectedProvince ?? undefined,
    limit: 100,
  });

  // Compute stats from fetched events
  const stats = useMemo(() => {
    const now = new Date();
    const todayStr = now.toDateString();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const eventsToday = provinceEvents.filter(
      (e) => new Date(e.publishedAt).toDateString() === todayStr,
    ).length;

    const eventsThisWeek = provinceEvents.filter(
      (e) => new Date(e.publishedAt) >= weekAgo,
    ).length;

    return { eventsToday, eventsThisWeek, total: provinceEvents.length };
  }, [provinceEvents]);

  // Find the selected province feature data and store in ref
  useEffect(() => {
    if (!selectedProvince) {
      provinceDataRef.current = null;
      setVisible(false);
      return;
    }

    const data = provincesData as unknown as FeatureCollection<Polygon, ProvinceProperties>;
    const feature = data.features.find(
      (f) => f.properties.name === selectedProvince,
    );
    provinceDataRef.current = feature?.properties ?? null;
    if (!feature) {
      setVisible(false);
    }
  }, [selectedProvince]);

  // Update position on each animation frame for smooth tracking
  const updatePosition = useCallback(() => {
    const pd = provinceDataRef.current;
    if (!selectedProvince || !pd || !globe?.getScreenCoords || !containerRef.current) {
      setVisible(false);
      return;
    }

    const [lng, lat] = pd.centroid;
    const screenPos = globe.getScreenCoords(lat, lng, 0.01);

    if (screenPos && screenPos.x != null && screenPos.y != null) {
      const rect = containerRef.current.getBoundingClientRect();
      setPosition({
        x: rect.left + screenPos.x,
        y: rect.top + screenPos.y,
      });
      setVisible(true);
    } else {
      setVisible(false);
    }
  }, [selectedProvince, globe, containerRef]);

  // Store callback in a ref so the rAF loop doesn't re-subscribe on every render
  const updatePositionRef = useRef(updatePosition);
  updatePositionRef.current = updatePosition;

  useEffect(() => {
    if (!selectedProvince || !provinceDataRef.current || !globe) return;

    let frame: number;
    const loop = () => {
      updatePositionRef.current();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [selectedProvince, globe]);

  if (!visible || !provinceDataRef.current) return null;

  return (
    <>
      {/* Invisible backdrop to dismiss on click outside */}
      <div
        className="fixed inset-0 z-20"
        onClick={clearProvinceSelection}
        aria-hidden="true"
      />

      {/* Popup */}
      <div
        style={{
          position: 'fixed',
          left: position.x,
          top: position.y,
          transform: 'translate(-50%, -120%)',
        }}
        className="z-30 bg-slate-800/95 backdrop-blur-sm border border-slate-600/50 rounded-xl shadow-2xl p-3.5 min-w-[210px] max-w-[250px] pointer-events-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={clearProvinceSelection}
          className="absolute -top-2 -right-2 w-5 h-5 bg-slate-700 hover:bg-slate-600 rounded-full border border-slate-600 flex items-center justify-center text-slate-300 hover:text-white transition-colors cursor-pointer shadow-md"
          aria-label="Cerrar"
         type="button">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>

        {/* Province name */}
        <h3 className="text-base font-bold text-slate-100 mb-2.5 pr-2">
          {provinceDataRef.current.name}
        </h3>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-1.5 mb-3">
          <div className="bg-slate-700/40 rounded-lg p-1.5 text-center">
            <span className="block text-sm font-bold text-yellow-400 tabular-nums">
              {eventsLoading ? (
                <span className="inline-block w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin align-middle" />
              ) : (
                stats.eventsToday
              )}
            </span>
            <span className="text-[9px] text-slate-400 uppercase tracking-wider">Hoy</span>
          </div>
          <div className="bg-slate-700/40 rounded-lg p-1.5 text-center">
            <span className="block text-sm font-bold text-blue-400 tabular-nums">
              {eventsLoading ? (
                <span className="inline-block w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin align-middle" />
              ) : (
                stats.eventsThisWeek
              )}
            </span>
            <span className="text-[9px] text-slate-400 uppercase tracking-wider">Semana</span>
          </div>
          <div className="bg-slate-700/40 rounded-lg p-1.5 text-center">
            <span className="block text-sm font-bold text-emerald-400 tabular-nums">—</span>
            <span className="text-[9px] text-slate-400 uppercase tracking-wider">Alertas</span>
          </div>
          <div className="bg-slate-700/40 rounded-lg p-1.5 text-center">
            <span className="block text-sm font-bold text-purple-400 tabular-nums">—</span>
            <span className="text-[9px] text-slate-400 uppercase tracking-wider">Econ.</span>
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex gap-1.5">
          <button className="flex-1 text-[10px] font-medium py-1.5 px-2 bg-blue-600/60 hover:bg-blue-600/80 text-blue-100 rounded-md transition-colors cursor-pointer" type="button">
            Ver noticias
          </button>
          <button className="flex-1 text-[10px] font-medium py-1.5 px-2 bg-emerald-600/60 hover:bg-emerald-600/80 text-emerald-100 rounded-md transition-colors cursor-pointer" type="button">
            Ver economía
          </button>
          <button className="flex-1 text-[10px] font-medium py-1.5 px-2 bg-amber-600/60 hover:bg-amber-600/80 text-amber-100 rounded-md transition-colors cursor-pointer" type="button">
            Ver alertas
          </button>
        </div>
      </div>
    </>
  );
}

