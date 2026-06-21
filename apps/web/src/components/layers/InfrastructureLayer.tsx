/**
 * Infrastructure Layer
 *
 * Renders static GeoJSON infrastructure data on the globe:
 *   - Gasoductos: semi-transparent yellow lines (paths)
 *   - Puertos: blue port anchor icons (HTML elements)
 *   - Represas: cyan dam icons (HTML elements)
 *
 * Toggleable from LayerToggle panel.
 */

import { useEffect, useRef } from 'react';
import { useRadarStore } from '../../stores/radarStore';
import infrastructureData from '@shared/geo/infrastructure.geojson';

interface InfrastructureProperties {
  name: string;
  type: 'gasoducto' | 'puerto' | 'represa';
  description: string;
}

type PointGeometry = { type: 'Point'; coordinates: [number, number] };
type LineGeometry = { type: 'LineString'; coordinates: [number, number][] };

interface InfrastructureFeature {
  type: 'Feature';
  properties: InfrastructureProperties;
  geometry: PointGeometry | LineGeometry;
}

interface InfrastructureCollection {
  type: 'FeatureCollection';
  features: InfrastructureFeature[];
}

/** SVG for port anchor icon (blue) */
const PORT_ICON_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <path d="M12 6v6.5"/>
    <path d="M12 15.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/>
    <path d="M8 18c2.5 1 6 1 8 0"/>
  </svg>`,
);

/** SVG for dam icon (cyan) */
const DAM_ICON_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 20h16"/>
    <path d="M6 20V4h4v16"/>
    <path d="M14 20V4h4v16"/>
    <path d="M2 20h20"/>
  </svg>`,
);

interface PathDatum {
  feature: InfrastructureFeature;
  coordinates: [number, number][];
}

interface PointDatum {
  feature: InfrastructureFeature;
  lat: number;
  lng: number;
}

interface Props {
  globe: any;
}

export function InfrastructureLayer({ globe }: Props) {
  const activeLayers = useRadarStore((s) => s.activeLayers);
  const isActive = activeLayers.has('infrastructure');
  const prevActiveRef = useRef(isActive);

  useEffect(() => {
    const prevActive = prevActiveRef.current;
    prevActiveRef.current = isActive;

    const data = infrastructureData as unknown as InfrastructureCollection;
    if (!data?.features) return;

    if (!isActive) {
      if (prevActive) {
        globe.pathsData([]);
        globe.htmlElementsData([]);
      }
      return;
    }

    // ─── Gasoductos as paths (semi-transparent yellow lines) ───
    const gasoductos: PathDatum[] = data.features.reduce<PathDatum[]>((acc, f) => {
      if (f.properties.type === 'gasoducto') {
        acc.push({
          feature: f,
          coordinates: (f.geometry as LineGeometry).coordinates as [number, number][],
        });
      }
      return acc;
    }, []);

    if (gasoductos.length > 0) {
      globe
        .pathsData(gasoductos)
        .pathPoints((d: PathDatum) => d.coordinates.map((c) => ({ lat: c[1], lng: c[0] })))
        .pathPointLat((d: any) => d.lat)
        .pathPointLng((d: any) => d.lng)
        .pathColor(() => 'rgba(250, 204, 21, 0.6)')
        .pathStrokeWidth(2.5)
        .pathDashGap(0)
        .pathDashLength(0)
        .pathDashGap((d: PathDatum) => {
          // Highlight gasoductos with information
          return 0;
        })
        .pathLabel((d: PathDatum) => {
          return `
            <div style="font-size:12px;background:#1e293b;color:#f1f5f9;padding:4px 8px;border-radius:4px;border:1px solid #facc15;white-space:nowrap;">
              <strong>${d.feature.properties.name}</strong>
            </div>
          `;
        });
    }

    // ─── Puertos and Represas as HTML elements ─────────────────
    const points: PointDatum[] = data.features.reduce<PointDatum[]>((acc, f) => {
      if (f.properties.type === 'puerto' || f.properties.type === 'represa') {
        const coords = (f.geometry as PointGeometry).coordinates;
        acc.push({
          feature: f,
          lat: coords[1],
          lng: coords[0],
        });
      }
      return acc;
    }, []);

    if (points.length > 0) {
      globe
        .htmlElementsData(points)
        .htmlLat((d: PointDatum) => d.lat)
        .htmlLng((d: PointDatum) => d.lng)
        .htmlAltitude(0.005)
        .htmlElement((d: PointDatum) => {
          const el = document.createElement('div');

          if (d.feature.properties.type === 'puerto') {
            el.style.width = '22px';
            el.style.height = '22px';
            el.style.backgroundImage = `url(data:image/svg+xml;utf8,${PORT_ICON_SVG})`;
            el.style.filter = 'drop-shadow(0 0 3px rgba(59, 130, 246, 0.8))';
          } else {
            el.style.width = '24px';
            el.style.height = '24px';
            el.style.backgroundImage = `url(data:image/svg+xml;utf8,${DAM_ICON_SVG})`;
            el.style.filter = 'drop-shadow(0 0 3px rgba(6, 182, 212, 0.8))';
          }

          el.style.backgroundSize = 'contain';
          el.style.backgroundRepeat = 'no-repeat';
          el.style.backgroundPosition = 'center';
          el.style.cursor = 'pointer';

          el.title = `${d.feature.properties.name}\n${d.feature.properties.description}`;

          return el;
        });
    }

    return () => {
      globe.pathsData([]);
      globe.htmlElementsData([]);
    };
  }, [globe, isActive]);

  return null;
}
