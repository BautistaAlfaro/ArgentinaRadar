/**
 * Event Markers Layer
 *
 * Renders event-level markers on the globe, clustered by geographic location.
 * - Each cluster = events at the same lat/lng (rounded to 2 decimals)
 * - Marker size: based on total article count across events in the cluster
 * - Marker color: based on impact score of the highest-impact event
 *   - 0-30:  gray (#6b7280)
 *   - 31-60: yellow (#fbbf24)
 *   - 61-100: red (#ef4444)
 * - Hover tooltip: event title + event count + article count + impact score
 * - Click: navigates to event location (same as EventFeed click behavior)
 */

import { useEffect, useRef } from 'react';
import { useRadarStore } from '../../stores/radarStore';
import type { EventItem } from '../../services/api';

// ─── Color helpers ─────────────────────────────────────────────────

const IMPACT_COLORS = {
  low: '#6b7280',    // gray — impact 0–30
  medium: '#fbbf24', // yellow — impact 31–60
  high: '#ef4444',   // red — impact 61–100
} as const;

function getImpactColor(score: number): string {
  if (score <= 30) return IMPACT_COLORS.low;
  if (score <= 60) return IMPACT_COLORS.medium;
  return IMPACT_COLORS.high;
}

// ─── Types ─────────────────────────────────────────────────────────

interface ClusterDatum {
  lat: number;
  lng: number;
  count: number;          // how many events in this cluster
  totalArticles: number;  // sum of all articleCounts in the cluster
  topEvent: EventItem;    // highest-impact event in the cluster
  events: EventItem[];    // all events in the cluster
}

interface Props {
  globe: any;
  events: EventItem[];
}

// ─── Component ─────────────────────────────────────────────────────

export function EventMarkers({ globe, events }: Props) {
  const activeLayers = useRadarStore((s) => s.activeLayers);
  const isActive = activeLayers.has('events');
  const prevActiveRef = useRef(isActive);

  const selectNewsLocation = useRadarStore((s) => s.selectNewsLocation);
  const activateLayer = useRadarStore((s) => s.activateLayer);

  useEffect(() => {
    const prevActive = prevActiveRef.current;
    prevActiveRef.current = isActive;

    // Clear if deactivated
    if (!isActive) {
      if (prevActive) {
        globe.pointsData([]);
      }
      return;
    }

    // Filter events with valid location
    const located = events.filter(
      (e) => e.location?.lat != null && e.location?.lng != null,
    );
    if (located.length === 0) return;

    // ── Cluster events by lat/lng (rounded to 2 decimals ~1.1 km) ──
    const clusterMap = new Map<string, EventItem[]>();
    for (const event of located) {
      const key = `${event.location.lat.toFixed(2)}_${event.location.lng.toFixed(2)}`;
      if (!clusterMap.has(key)) clusterMap.set(key, []);
      clusterMap.get(key)!.push(event);
    }

    const clusters: ClusterDatum[] = [];
    for (const group of clusterMap.values()) {
      // Pick the event with the highest impact score
      let top = group[0];
      for (const e of group) {
        if (e.impactScore > top.impactScore) top = e;
      }
      const totalArticles = group.reduce((sum, e) => sum + e.articleCount, 0);
      clusters.push({
        lat: top.location.lat,
        lng: top.location.lng,
        count: group.length,
        totalArticles,
        topEvent: top,
        events: group,
      });
    }

    // ── Render points on globe ──
    globe
      .pointsData(clusters)
      .pointLat((d: ClusterDatum) => d.lat)
      .pointLng((d: ClusterDatum) => d.lng)
      .pointAltitude(0.03)
      .pointRadius((d: ClusterDatum) => {
        // Size by total article count
        if (d.totalArticles > 10) return 9;
        if (d.totalArticles > 5) return 7;
        if (d.count > 1) return 5.5;
        return 4;
      })
      .pointColor((d: ClusterDatum) => getImpactColor(d.topEvent.impactScore))
      .pointLabel((d: ClusterDatum) => {
        const color = getImpactColor(d.topEvent.impactScore);
        const eventLabel = d.count === 1 ? '1 evento' : `${d.count} eventos`;
        const articleLabel =
          d.totalArticles === 1
            ? '1 artículo'
            : `${d.totalArticles} artículos`;
        return `
          <div style="font-size:12px;background:#1e293b;color:#f1f5f9;padding:8px 12px;border-radius:8px;border:1px solid ${color};max-width:260px;line-height:1.4;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>
              <strong style="font-size:13px;">${d.topEvent.title}</strong>
            </div>
            <div style="color:#94a3b8;font-size:11px;">
              ${eventLabel} · ${articleLabel}
            </div>
            <div style="color:#94a3b8;font-size:11px;margin-top:2px;">
              Impacto: ${d.topEvent.impactScore}/100
            </div>
          </div>
        `;
      })
      .onPointHover((hovered: ClusterDatum | null) => {
        // Enlarge hovered marker
        globe.pointRadius((d: ClusterDatum) => {
          if (d === hovered) {
            const base =
              d.totalArticles > 10 ? 9 : d.totalArticles > 5 ? 7 : d.count > 1 ? 5.5 : 4;
            return base * 1.5;
          }
          if (d.totalArticles > 10) return 9;
          if (d.totalArticles > 5) return 7;
          if (d.count > 1) return 5.5;
          return 4;
        });
      })
      .onPointClick((clicked: ClusterDatum) => {
        if (clicked.topEvent.location) {
          selectNewsLocation({
            lat: clicked.topEvent.location.lat,
            lng: clicked.topEvent.location.lng,
            articleId: clicked.topEvent.id,
          });
          activateLayer('news');
        }
      });

    // ── Cleanup ──
    return () => {
      globe.pointsData([]);
      globe.onPointHover(null as any);
      globe.onPointClick(null as any);
    };
  }, [globe, isActive, events, selectNewsLocation, activateLayer]);

  return null;
}
