/**
 * Flight Layer
 *
 * Fetches flight positions from the alerts service and renders
 * airplane icons with callsign tooltips on the globe.
 *
 * Refreshes every 30 seconds (matching the server-side schedule).
 */

import { useEffect } from 'react';
import { useRadarStore } from '../../stores/radarStore';
import { useLayerData } from '../../hooks/useLayerData';
import type { FlightData } from '@shared/types';
import type { FlightResponse } from '../../services/api';

/** Airplane SVG icon as a data URI */
const AIRPLANE_ICON_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M22 2L11 13"/>
    <path d="M22 2l-7 20-4-9-9-4 20-7z"/>
  </svg>`,
);

interface HtmlElementDatum {
  flight: FlightData;
  lat: number;
  lng: number;
}

interface Props {
  globe: any;
}

export function FlightLayer({ globe }: Props) {
  const activeLayers = useRadarStore((s) => s.activeLayers);
  const isActive = activeLayers.has('flights');

  const { data } = useLayerData<FlightResponse>(
    'http://localhost:3007/api/alerts/flights',
    30 * 1000, // 30 seconds
  );
  const flights = data?.flights ?? [];

  // Render HTML elements on globe
  useEffect(() => {

    if (!isActive) return;

    if (flights.length === 0) return;

    const data: HtmlElementDatum[] = flights.map((f) => ({
      flight: f,
      lat: f.lat,
      lng: f.lng,
    }));

    globe
      .htmlElementsData(data)
      .htmlLat((d: HtmlElementDatum) => d.lat)
      .htmlLng((d: HtmlElementDatum) => d.lng)
      .htmlAltitude((d: HtmlElementDatum) => (d.flight.onGround ? 0.001 : 0.02))
      .htmlElement((d: HtmlElementDatum) => {
        const el = document.createElement('div');
        el.style.width = '20px';
        el.style.height = '20px';

        // Different icon for ground vs airborne
        if (d.flight.onGround) {
          el.style.backgroundImage = `url(data:image/svg+xml;utf8,${encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>`,
          )})`;
          el.style.opacity = '0.6';
        } else {
          el.style.backgroundImage = `url(data:image/svg+xml;utf8,${AIRPLANE_ICON_SVG})`;
          // Rotate based on direction (simplified — random-ish since we don't have heading)
          el.style.transform = `rotate(${Math.random() * 360}deg)`;
        }

        el.style.backgroundSize = 'contain';
        el.style.backgroundRepeat = 'no-repeat';
        el.style.backgroundPosition = 'center';
        el.style.cursor = 'pointer';
        el.style.filter = 'drop-shadow(0 0 2px rgba(96, 165, 250, 0.6))';

        // Tooltip with callsign and altitude
        const altitudeKm = d.flight.onGround
          ? 'En tierra'
          : `${Math.round(d.flight.altitude / 3.28084)} m`;
        const speed = d.flight.onGround
          ? '—'
          : `${Math.round(d.flight.velocity * 1.852)} km/h`;

        el.title = `✈️ ${d.flight.callsign}\nAltitud: ${altitudeKm}\nVelocidad: ${speed}`;

        return el;
      });

    return () => {
      globe.htmlElementsData([]);
    };
  }, [globe, isActive, flights]);

  return null;
}

