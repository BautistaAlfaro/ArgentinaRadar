/**
 * Weather Layer
 *
 * Fetches SMN weather alerts from the alerts service and renders
 * them as colored polygons on the globe by province.
 *   - Yellow alerts → yellow polygons
 *   - Orange alerts → orange polygons
 *   - Red alerts → red polygons
 *
 * Refreshes every 30 minutes (matching the server-side schedule).
 */

import { API } from '@shared/apiConfig';
import { useEffect, useMemo, useRef } from 'react';
import { useRadarStore } from '../../stores/radarStore';
import { useLayerData } from '../../hooks/useLayerData';
import type { WeatherAlert } from '@shared/types';
import type { WeatherAlertResponse } from '../../services/api';

const SEVERITY_COLORS: Record<string, { fill: string; stroke: string; label: string }> = {
  yellow: { fill: 'rgba(255, 255, 0, 0.25)', stroke: 'rgba(255, 255, 0, 0.5)', label: 'Alerta Amarilla' },
  orange: { fill: 'rgba(255, 165, 0, 0.3)', stroke: 'rgba(255, 165, 0, 0.6)', label: 'Alerta Naranja' },
  red: { fill: 'rgba(255, 0, 0, 0.3)', stroke: 'rgba(255, 0, 0, 0.6)', label: 'Alerta Roja' },
};

interface PolygonDatum {
  alert: WeatherAlert;
  coordinates: number[][];
  centroid: [number, number];
}

interface Props {
  globe: any;
}

export function WeatherLayer({ globe }: Props) {
  const activeLayers = useRadarStore((s) => s.activeLayers);
  const isActive = activeLayers.has('weather');
  const globeRef = useRef(globe);
  globeRef.current = globe;

  const { data } = useLayerData<WeatherAlertResponse>(
    `${API.alerts}/api/alerts/weather`,
    30 * 60 * 1000, // 30 min
  );
  const alerts = useMemo(() => data?.alerts ?? [], [data]);

  // Render polygons on globe
  useEffect(() => {
    if (!isActive) return;

    const g = globeRef.current;

    // Build polygon data from alerts
    const polygonData: PolygonDatum[] = alerts.flatMap((alert) => {
      return alert.coordinates.map((ring) => {
        // Calculate centroid for label placement
        const lats = ring.map((c) => c[1]);
        const lngs = ring.map((c) => c[0]);
        const centroid: [number, number] = [
          lngs.reduce((a, b) => a + b, 0) / lngs.length,
          lats.reduce((a, b) => a + b, 0) / lats.length,
        ];

        return {
          alert,
          coordinates: ring,
          centroid,
        };
      });
    });

    if (polygonData.length === 0) return;

    g
      .polygonsData(polygonData)
      .polygonLat((d: PolygonDatum) => d.coordinates.map((c) => c[1]))
      .polygonLng((d: PolygonDatum) => d.coordinates.map((c) => c[0]))
      .polygonAltitude(0.005)
      .polygonCapColor((d: PolygonDatum) => {
        const colors = SEVERITY_COLORS[d.alert.severity] ?? SEVERITY_COLORS.yellow;
        return colors.fill;
      })
      .polygonSideColor((d: PolygonDatum) => {
        const colors = SEVERITY_COLORS[d.alert.severity] ?? SEVERITY_COLORS.yellow;
        return colors.stroke.replace('0.6', '0.15');
      })
      .polygonStrokeColor((d: PolygonDatum) => {
        const colors = SEVERITY_COLORS[d.alert.severity] ?? SEVERITY_COLORS.yellow;
        return colors.stroke;
      })
      .polygonLabel((d: PolygonDatum) => {
        const colors = SEVERITY_COLORS[d.alert.severity] ?? SEVERITY_COLORS.yellow;
        return `
          <div style="font-size:12px;background:#1e293b;color:#f1f5f9;padding:6px 10px;border-radius:6px;border:2px solid ${colors.stroke};white-space:nowrap;">
            <strong>${colors.label}</strong><br/>
            <span>${d.alert.event}</span><br/>
            <span style="color:#94a3b8;font-size:11px;">${d.alert.province}</span>
          </div>
        `;
      })
      .onPolygonHover((hovered: PolygonDatum | null) => {
        globeRef.current.polygonCapColor((d: PolygonDatum) => {
          if (d === hovered) {
            const colors = SEVERITY_COLORS[d.alert.severity] ?? SEVERITY_COLORS.yellow;
            return colors.fill.replace('0.25', '0.45').replace('0.3', '0.5');
          }
          const colors = SEVERITY_COLORS[d.alert.severity] ?? SEVERITY_COLORS.yellow;
          return colors.fill;
        });
      });

    return () => {
      g.polygonsData([]);
    };
  }, [isActive, alerts]);

  return null;
}

