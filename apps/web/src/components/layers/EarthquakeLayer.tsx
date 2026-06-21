/**
 * Earthquake Layer
 *
 * Fetches earthquake data from the alerts service and renders
 * circle markers on the globe sized by magnitude.
 *   - M3.0–4.9 → small circles
 *   - M5.0–6.9 → medium circles
 *   - M7.0+ → large circles
 *
 * Refreshes every 60 minutes (matching the server-side schedule).
 */

import { API } from '@shared/apiConfig';
import { useEffect, useMemo, useRef } from 'react';
import { useRadarStore } from '../../stores/radarStore';
import { useLayerData } from '../../hooks/useLayerData';
import type { Earthquake } from '@shared/types';

const ALERTS_API = API.alerts;

const MAGNITUDE_COLORS: Record<string, string> = {
  small: '#22c55e',   // green — M3.0–4.9
  medium: '#f59e0b',  // amber — M5.0–6.9
  large: '#ef4444',   // red   — M7.0+
};

interface Props {
  globe: any;
}

export function EarthquakeLayer({ globe }: Props) {
  const activeLayers = useRadarStore((s) => s.activeLayers);
  const isActive = activeLayers.has('earthquakes');
  const globeRef = useRef(globe);
  globeRef.current = globe;

  const { data } = useLayerData<{ earthquakes: Earthquake[] }>(
    `${ALERTS_API}/api/alerts/earthquakes`,
    60 * 60 * 1000, // 60 min
  );
  const earthquakes = useMemo(() => data?.earthquakes ?? [], [data]);

  // Render points on globe
  useEffect(() => {
    if (!isActive) return;

    if (earthquakes.length === 0) return;

    const g = globeRef.current;

    g
      .pointsData(earthquakes)
      .pointLat((d: Earthquake) => d.lat)
      .pointLng((d: Earthquake) => d.lng)
      .pointAltitude(0.01)
      .pointRadius((d: Earthquake) => {
        if (d.magnitude >= 7.0) return 8;
        if (d.magnitude >= 5.0) return 5;
        return 3;
      })
      .pointColor((d: Earthquake) => {
        if (d.magnitude >= 7.0) return MAGNITUDE_COLORS.large;
        if (d.magnitude >= 5.0) return MAGNITUDE_COLORS.medium;
        return MAGNITUDE_COLORS.small;
      })
      .pointLabel((d: Earthquake) => {
        const depthKm = d.depth.toFixed(1);
        const time = new Date(d.time).toLocaleString('es-AR');
        return `
          <div style="font-size:12px;background:#1e293b;color:#f1f5f9;padding:6px 10px;border-radius:6px;border:1px solid #334155;white-space:nowrap;max-width:280px;">
            <strong style="font-size:14px;">M${d.magnitude.toFixed(1)}</strong>
            <span style="color:#94a3b8;"> — ${d.location}</span><br/>
            <span style="color:#94a3b8;">Profundidad: ${depthKm} km</span><br/>
            <span style="color:#94a3b8;">${time}</span>
          </div>
        `;
      })
      .onPointHover((hovered: Earthquake | null) => {
        globeRef.current.pointRadius((d: Earthquake) => {
          if (d === hovered) {
            const base = d.magnitude >= 7.0 ? 8 : d.magnitude >= 5.0 ? 5 : 3;
            return base * 1.5;
          }
          if (d.magnitude >= 7.0) return 8;
          if (d.magnitude >= 5.0) return 5;
          return 3;
        });
      });

    return () => {
      g.pointsData([]);
    };
  }, [isActive, earthquakes]);

  return null;
}
