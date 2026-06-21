/**
 * ProtestLayer — 3D globe layer for active protests and cortes.
 *
 * Fetches active protests from the event-detector service and renders
 * them as HTML elements on the globe with:
 *   - 🚧 icons with pulsing CSS animation for active cortes
 *   - Color by type: red=corte_total, orange=corte_parcial, yellow=marcha, blue=piquete
 *   - Click → show details popup
 *   - 15s refresh interval
 */

import { useEffect } from 'react';
import { useRadarStore } from '../../stores/radarStore';
import { useLayerData } from '../../hooks/useLayerData';
import type { ProtestsResponse } from '../../services/api';

// Color mapping for protest types (same as ProtestPanel)
const TYPE_COLORS: Record<string, string> = {
  corte_total: '#ef4444',    // red
  corte_parcial: '#f97316',  // orange
  marcha: '#eab308',         // yellow
  piquete: '#3b82f6',        // blue
  paro: '#8b5cf6',           // purple
  movilizacion: '#14b8a6',   // teal
};

const TYPE_LABELS: Record<string, string> = {
  corte_total: 'Corte Total',
  corte_parcial: 'Corte Parcial',
  marcha: 'Marcha',
  piquete: 'Piquete',
  paro: 'Paro',
  movilizacion: 'Movilización',
};

interface HtmlElementDatum {
  protest: import('../../services/api').ProtestItem;
  lat: number;
  lng: number;
}

interface Props {
  globe: any;
}

function formatTimeSince(startedAt: string): string {
  const diff = Date.now() - new Date(startedAt).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 48) return `${Math.floor(hours / 24)}d`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}min`;
}

export function ProtestLayer({ globe }: Props) {
  const activeLayers = useRadarStore((s) => s.activeLayers);
  const isActive = activeLayers.has('protests');

  const { data } = useLayerData<ProtestsResponse>(
    'http://localhost:3008/api/events/protests?status=active',
    15 * 1000, // 15 seconds
  );
  const protests = data?.protests ?? [];

  // Render HTML elements on globe
  useEffect(() => {

    if (!isActive) return;

    if (protests.length === 0) return;

    const data: HtmlElementDatum[] = protests.map((p) => ({
      protest: p,
      lat: p.lat,
      lng: p.lng,
    }));

    const typeColor = TYPE_COLORS;

    globe
      .htmlElementsData(data)
      .htmlLat((d: HtmlElementDatum) => d.lat)
      .htmlLng((d: HtmlElementDatum) => d.lng)
      .htmlAltitude(0.015)
      .htmlElement((d: HtmlElementDatum) => {
        const el = document.createElement('div');
        const p = d.protest;
        const color = typeColor[p.protest_type] || '#94a3b8';
        const isCorte = p.protest_type === 'corte_total' || p.protest_type === 'corte_parcial';

        // Outer container for positioning
        el.style.position = 'relative';
        el.style.width = '36px';
        el.style.height = '36px';
        el.style.cursor = 'pointer';

        // Pulsing ring for active cortes
        if (isCorte) {
          const ring = document.createElement('div');
          ring.style.position = 'absolute';
          ring.style.top = '50%';
          ring.style.left = '50%';
          ring.style.transform = 'translate(-50%, -50%)';
          ring.style.width = '36px';
          ring.style.height = '36px';
          ring.style.borderRadius = '50%';
          ring.style.border = `2px solid ${color}`;
          ring.style.opacity = '0.4';
          ring.style.animation = 'protest-pulse 2s ease-in-out infinite';
          el.appendChild(ring);
        }

        // Icon
        const icon = document.createElement('div');
        icon.style.position = 'absolute';
        icon.style.top = '50%';
        icon.style.left = '50%';
        icon.style.transform = 'translate(-50%, -50%)';
        icon.style.width = '24px';
        icon.style.height = '24px';
        icon.style.display = 'flex';
        icon.style.alignItems = 'center';
        icon.style.justifyContent = 'center';
        icon.style.fontSize = '18px';
        icon.style.lineHeight = '1';
        icon.style.filter = `drop-shadow(0 0 4px ${color}80)`;
        icon.textContent = '🚧';

        // Pulse animation for active cortes
        if (isCorte) {
          icon.style.animation = 'protest-bounce 2s ease-in-out infinite';
        }

        el.appendChild(icon);

        // Tooltip on hover
        const routeInfo = p.route_name
          ? `${p.route_name}${p.km != null ? ` · km ${p.km}` : ''}`
          : p.city || p.province;
        el.title = `🚧 ${TYPE_LABELS[p.protest_type] || p.protest_type}\n${routeInfo}\n${p.province}\n⏱ ${formatTimeSince(p.started_at)}\n📰 ${p.article_count} fuente${p.article_count !== 1 ? 's' : ''}`;

        return el;
      });

    return () => {
      globe.htmlElementsData([]);
    };
  }, [globe, isActive, protests]);

  return null;
}

