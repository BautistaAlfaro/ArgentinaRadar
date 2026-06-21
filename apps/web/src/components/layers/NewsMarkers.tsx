/**
 * News Markers Layer
 *
 * Renders category-colored pins on the globe at extracted lat/lng coordinates.
 * - Hover: shows Tooltip with headline (≤80 chars) + source
 * - Click: shows Popup with full headline, 200-char summary, source, timestamp, "Leer más" link
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRadarStore } from '../../stores/radarStore';
import { Tooltip } from '../Tooltip';
import { Popup } from '../Popup';
import type { NewsItem } from '@shared/types';

const CATEGORY_COLORS: Record<string, string> = {
  politica: '#3b82f6', // blue
  economia: '#10b981', // green
  sociedad: '#f97316', // orange
  deportes: '#a855f7', // purple
  general: '#6b7280',  // gray
};

interface MarkerDatum {
  article: NewsItem;
  lat: number;
  lng: number;
  category: string;
}

interface Props {
  globe: any; // Globe instance from globe.gl
  articles: NewsItem[];
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  article: NewsItem | null;
}

interface PopupState {
  visible: boolean;
  x: number;
  y: number;
  article: NewsItem | null;
}

export function NewsMarkers({ globe, articles }: Props) {
  const activeLayers = useRadarStore((s) => s.activeLayers);
  const isActive = activeLayers.has('news');
  const prevActiveRef = useRef(isActive);

  // Interaction state
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false, x: 0, y: 0, article: null,
  });
  const [popup, setPopup] = useState<PopupState>({
    visible: false, x: 0, y: 0, article: null,
  });
  const closePopup = useCallback(() => {
    setPopup({ visible: false, x: 0, y: 0, article: null });
  }, []);

  useEffect(() => {
    const prevActive = prevActiveRef.current;
    prevActiveRef.current = isActive;

    if (!isActive) {
      if (prevActive) {
        globe.pointsData([]);
      }
      return;
    }

    // Filter articles that have valid location data
    const markers: MarkerDatum[] = articles
      .filter((a) => a.location && a.location.lat != null && a.location.lng != null)
      .map((a) => ({
        article: a,
        lat: a.location!.lat,
        lng: a.location!.lng,
        category: a.category,
      }));

    if (markers.length === 0) return;

    // Get the container element for positioning tooltips/popups
    const container = globe._container || globe._canvas?.parentElement;

    globe
      .pointsData(markers)
      .pointLat((d: MarkerDatum) => d.lat)
      .pointLng((d: MarkerDatum) => d.lng)
      .pointAltitude(0.03)
      .pointRadius(3.5)
      .pointColor((d: MarkerDatum) => CATEGORY_COLORS[d.category] ?? CATEGORY_COLORS.general)
      .pointLabel(null as any) // We handle tooltips manually

      // Hover tooltip
      .onPointHover((hovered: MarkerDatum | null, prevHovered: MarkerDatum | null) => {
        // When using globe.gl, the event object may be on the second argument
        const event = arguments as unknown as { clientX?: number; clientY?: number };
        // We use pointer tracking via the container instead
        if (!hovered) {
          setTooltip({ visible: false, x: 0, y: 0, article: null });
          globe.pointColor((d: MarkerDatum) => CATEGORY_COLORS[d.category] ?? CATEGORY_COLORS.general);
          return;
        }
        // Highlight on hover
        globe.pointColor((d: MarkerDatum) => {
          if (d === hovered) return '#ffffff';
          return CATEGORY_COLORS[d.category] ?? CATEGORY_COLORS.general;
        });
      });

    // Attach mousemove on the canvas for tooltip positioning
    const onMouseMove = (e: MouseEvent) => {
      // Check if we have a hovered point by checking if tooltip should show
      // The globe.gl library doesn't give us easy access to the currently hovered point
      // So we use a workaround via custom point hover tracking
    };

    // Click handler
    globe.onPointClick((clicked: MarkerDatum, event: { clientX: number; clientY: number }) => {
      const ev = event || { clientX: 0, clientY: 0 };
      setPopup({
        visible: true,
        x: ev.clientX,
        y: ev.clientY,
        article: clicked.article,
      });
      setTooltip({ visible: false, x: 0, y: 0, article: null });
    });

    // Custom hover tracking using globe.gl's onPointHover
    // We store the hovered point and update on mousemove
    let currentHovered: MarkerDatum | null = null;

    globe.onPointHover((hovered: MarkerDatum | null) => {
      currentHovered = hovered;
      if (!hovered) {
        setTooltip({ visible: false, x: 0, y: 0, article: null });
        globe.pointColor((d: MarkerDatum) => CATEGORY_COLORS[d.category] ?? CATEGORY_COLORS.general);
      } else {
        globe.pointColor((d: MarkerDatum) => {
          if (d === hovered) return '#ffffff';
          return CATEGORY_COLORS[d.category] ?? CATEGORY_COLORS.general;
        });
      }
    });

    if (container) {
      container.addEventListener('mousemove', (e: MouseEvent) => {
        if (currentHovered) {
          setTooltip({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            article: currentHovered.article,
          });
        }
      });
    }

    return () => {
      globe.pointsData([]);
      globe.onPointHover(null as any);
      globe.onPointClick(null as any);
      if (container) {
        container.removeEventListener('mousemove', onMouseMove);
      }
    };
  }, [globe, isActive, articles]);

  return (
    <>
      {/* Tooltip */}
      {tooltip.visible && tooltip.article && (
        <Tooltip article={tooltip.article} x={tooltip.x} y={tooltip.y} />
      )}

      {/* Popup */}
      {popup.visible && popup.article && (
        <Popup article={popup.article} x={popup.x} y={popup.y} onClose={closePopup} />
      )}
    </>
  );
}
