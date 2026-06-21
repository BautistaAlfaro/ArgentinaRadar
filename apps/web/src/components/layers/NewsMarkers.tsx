/**
 * News Markers Layer
 *
 * Renders category-colored pins on the globe at extracted lat/lng coordinates.
 * - Hover: shows Tooltip with headline (≤80 chars) + source
 * - Click: shows Popup with full headline, 200-char summary, source, timestamp, "Leer más" link
 */

import { useEffect, useRef, useReducer, useCallback } from 'react';
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

interface InteractionState {
  tooltip: { visible: boolean; x: number; y: number; article: NewsItem | null };
  popup: { visible: boolean; x: number; y: number; article: NewsItem | null };
}

type InteractionAction =
  | { type: 'SHOW_TOOLTIP'; x: number; y: number; article: NewsItem }
  | { type: 'HIDE_TOOLTIP' }
  | { type: 'SHOW_POPUP'; x: number; y: number; article: NewsItem }
  | { type: 'HIDE_POPUP' };

const INITIAL_INTERACTION: InteractionState = {
  tooltip: { visible: false, x: 0, y: 0, article: null },
  popup: { visible: false, x: 0, y: 0, article: null },
};

function interactionReducer(state: InteractionState, action: InteractionAction): InteractionState {
  switch (action.type) {
    case 'SHOW_TOOLTIP':
      return { ...state, tooltip: { visible: true, x: action.x, y: action.y, article: action.article } };
    case 'HIDE_TOOLTIP':
      return { ...state, tooltip: { visible: false, x: 0, y: 0, article: null } };
    case 'SHOW_POPUP':
      return {
        ...state,
        popup: { visible: true, x: action.x, y: action.y, article: action.article },
        tooltip: { visible: false, x: 0, y: 0, article: null },
      };
    case 'HIDE_POPUP':
      return { ...state, popup: { visible: false, x: 0, y: 0, article: null } };
  }
}

export function NewsMarkers({ globe, articles }: Props) {
  const activeLayers = useRadarStore((s) => s.activeLayers);
  const isActive = activeLayers.has('news');
  const prevActiveRef = useRef(isActive);

  // Combined interaction state via reducer
  const [interaction, dispatch] = useReducer(interactionReducer, INITIAL_INTERACTION);
  const closePopup = useCallback(() => dispatch({ type: 'HIDE_POPUP' }), []);

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
    const markers: MarkerDatum[] = articles.reduce<MarkerDatum[]>((acc, a) => {
      if (a.location && a.location.lat != null && a.location.lng != null) {
        acc.push({
          article: a,
          lat: a.location.lat,
          lng: a.location.lng,
          category: a.category,
        });
      }
      return acc;
    }, []);

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
      .pointLabel(null as any); // We handle tooltips manually

    // Custom hover tracking using globe.gl's onPointHover
    let currentHovered: MarkerDatum | null = null;

    globe.onPointHover((hovered: MarkerDatum | null) => {
      currentHovered = hovered;
      if (!hovered) {
        dispatch({ type: 'HIDE_TOOLTIP' });
        globe.pointColor((d: MarkerDatum) => CATEGORY_COLORS[d.category] ?? CATEGORY_COLORS.general);
      } else {
        globe.pointColor((d: MarkerDatum) => {
          if (d === hovered) return '#ffffff';
          return CATEGORY_COLORS[d.category] ?? CATEGORY_COLORS.general;
        });
      }
    });

    // Click handler
    globe.onPointClick((clicked: MarkerDatum, event: { clientX: number; clientY: number }) => {
      const ev = event || { clientX: 0, clientY: 0 };
      dispatch({
        type: 'SHOW_POPUP',
        x: ev.clientX,
        y: ev.clientY,
        article: clicked.article,
      });
    });

    // Mousemove for tooltip positioning
    const onMouseMove = (e: MouseEvent) => {
      if (currentHovered) {
        dispatch({
          type: 'SHOW_TOOLTIP',
          x: e.clientX,
          y: e.clientY,
          article: currentHovered.article,
        });
      }
    };

    if (container) {
      container.addEventListener('mousemove', onMouseMove);
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
      {interaction.tooltip.visible && interaction.tooltip.article && (
        <Tooltip article={interaction.tooltip.article} x={interaction.tooltip.x} y={interaction.tooltip.y} />
      )}

      {/* Popup */}
      {interaction.popup.visible && interaction.popup.article && (
        <Popup article={interaction.popup.article} x={interaction.popup.x} y={interaction.popup.y} onClose={closePopup} />
      )}
    </>
  );
}
