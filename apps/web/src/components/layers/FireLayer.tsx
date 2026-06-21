/**
 * Fire Layer
 *
 * Fetches active fire hotspots from the alerts service and renders
 * them as fire icons using HTML elements on the globe.
 *
 * Refreshes every 3 hours (matching the server-side schedule).
 */

import { useEffect, useMemo, useRef } from 'react';
import { useRadarStore } from '../../stores/radarStore';
import { useLayerData } from '../../hooks/useLayerData';
import type { FireHotspot } from '@shared/types';

const ALERTS_API = 'http://localhost:3007';

/** Fire SVG icon as a data URI */
const FIRE_ICON_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#ff6b35" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>
  </svg>`,
);

interface HtmlElementDatum {
  hotspot: FireHotspot;
  lat: number;
  lng: number;
}

interface Props {
  globe: any;
}

export function FireLayer({ globe }: Props) {
  const activeLayers = useRadarStore((s) => s.activeLayers);
  const isActive = activeLayers.has('fires');
  const globeRef = useRef(globe);
  globeRef.current = globe;

  const { data } = useLayerData<{ fires: FireHotspot[] }>(
    `${ALERTS_API}/api/alerts/fires`,
    3 * 60 * 60 * 1000, // 3 hours
  );
  const fires = useMemo(() => data?.fires ?? [], [data]);

  // Render HTML elements on globe
  useEffect(() => {
    if (!isActive) return;

    if (fires.length === 0) return;

    const g = globeRef.current;

    const data: HtmlElementDatum[] = fires.map((f) => ({
      hotspot: f,
      lat: f.lat,
      lng: f.lng,
    }));

    g
      .htmlElementsData(data)
      .htmlLat((d: HtmlElementDatum) => d.lat)
      .htmlLng((d: HtmlElementDatum) => d.lng)
      .htmlAltitude(0.01)
      .htmlElement((d: HtmlElementDatum) => {
        const el = document.createElement('div');
        el.style.width = '24px';
        el.style.height = '24px';
        el.style.backgroundImage = `url(data:image/svg+xml;utf8,${FIRE_ICON_SVG})`;
        el.style.backgroundSize = 'contain';
        el.style.backgroundRepeat = 'no-repeat';
        el.style.backgroundPosition = 'center';
        el.style.cursor = 'pointer';
        el.style.filter =
          d.hotspot.confidence === 'high'
            ? 'drop-shadow(0 0 4px rgba(255, 107, 53, 0.8))'
            : 'none';

        // Tooltip on hover
        el.title = `🔥 Fuego activo\nConfianza: ${d.hotspot.confidence}\nBrillo: ${Math.round(d.hotspot.brightness)}K`;

        return el;
      });

    return () => {
      g.htmlElementsData([]);
    };
  }, [isActive, fires]);

  return null;
}

