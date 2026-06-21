/**
 * Borders Layer
 *
 * Renders three border-related datasets on the globe:
 *   1. South America country outlines — dashed paths
 *   2. Argentina's Antarctic claim (wedge 25°W–74°W) — filled polygon
 *   3. Islas Malvinas / Falkland Islands — label marker
 *
 * Toggleable via the 'borders' layer ID.
 */

import { useEffect, useRef } from 'react';
import type { FeatureCollection, Feature, Polygon } from 'geojson';
import { useRadarStore } from '../../stores/radarStore';
import southAmericaData from '@shared/geo/south-america.geojson';
import antarcticClaimData from '@shared/geo/antarctic-claim.geojson';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CountryProperties {
  name: string;
  iso_a2?: string;
}

type CountryFeature = Feature<Polygon, CountryProperties>;

interface ClaimProperties {
  name: string;
  type: string;
  description?: string;
}

type ClaimFeature = Feature<Polygon, ClaimProperties>;

/** A path datum — one ring of a country polygon turned into a path */
interface PathDatum {
  feature: CountryFeature;
  coordinates: [number, number][];
}

interface Props {
  globe: any;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the outer ring of a GeoJSON Polygon into [lat, lng] points
 * suitable for globe.pathsData().
 */
function polygonToPathPoints(
  polygon: Polygon,
): [number, number][] {
  const ring = polygon.coordinates[0]; // outer ring
  return ring.map((coord) => [coord[1], coord[0]] as [number, number]); // [lat, lng]
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BordersLayer({ globe }: Props) {
  const activeLayers = useRadarStore((s) => s.activeLayers);
  const isActive = activeLayers.has('borders');
  const prevActiveRef = useRef(isActive);

  // Keep ref to the globe polygon data so we can restore on re-render
  const claimedPolygonRef = useRef<ClaimFeature[]>([]);

  useEffect(() => {
    const prevActive = prevActiveRef.current;
    prevActiveRef.current = isActive;

    const countries = southAmericaData as unknown as FeatureCollection<Polygon, CountryProperties>;
    const claimData = antarcticClaimData as unknown as FeatureCollection<Polygon, ClaimProperties>;

    if (!countries?.features || !claimData?.features) return;

    if (!isActive) {
      if (prevActive) {
        globe.pathsData([]);
        globe.polygonsData([]);
        globe.htmlElementsData([]);
      }
      return;
    }

    // ─── 1. South America country borders as dashed paths ───────────
    const paths: PathDatum[] = countries.features
      .filter((f) => f.geometry?.coordinates?.[0])
      .map((f) => ({
        feature: f,
        coordinates: polygonToPathPoints(f.geometry),
      }));

    if (paths.length > 0) {
      globe
        .pathsData(paths)
        .pathPoints((d: PathDatum) => d.coordinates)
        .pathPointLat((d: [number, number]) => d[0])
        .pathPointLng((d: [number, number]) => d[1])
        .pathColor(() => 'rgba(148, 163, 184, 0.65)') // slate-400
        .pathStrokeWidth(1.8)
        .pathDashLength(4)
        .pathDashGap(3)
        .pathDashPreferredLength((d: PathDatum) => {
          // Longer dashes for larger countries
          const coords = d.coordinates;
          const totalLen = coords.length;
          return totalLen > 20 ? 6 : 3;
        })
        .pathLabel((d: PathDatum) => {
          return `
            <div style="font-size:11px;background:#1e293b;color:#cbd5e1;padding:2px 6px;border-radius:3px;border:1px solid #475569;white-space:nowrap;">
              ${d.feature.properties.name}
            </div>
          `;
        });
    }

    // ─── 2. Argentina's Antarctic claim wedge ──────────────────────
    const claimFeatures = claimData.features.filter(
      (f) => f.properties?.type === 'antarctic_claim',
    );
    claimedPolygonRef.current = claimFeatures;

    if (claimFeatures.length > 0) {
      globe
        .polygonsData(claimFeatures)
        .polygonAltitude(0.002)
        .polygonCapColor(
          () => 'rgba(147, 197, 253, 0.18)', // light blue fill
        )
        .polygonSideColor(
          () => 'rgba(147, 197, 253, 0.06)',
        )
        .polygonStrokeColor(
          () => 'rgba(147, 197, 253, 0.6)', // blue stroke
        )
        .polygonLabel((d: ClaimFeature) => {
          return `
            <div style="font-size:11px;background:#1e293b;color:#bfdbfe;padding:3px 8px;border-radius:3px;border:1px solid #3b82f6;white-space:nowrap;">
              <strong>${d.properties.name}</strong>
            </div>
          `;
        });
    }

    // ─── 3. Islas Malvinas label marker ────────────────────────────
    const malvinasFeature = claimData.features.find(
      (f) => f.properties?.type === 'islands',
    );

    if (malvinasFeature) {
      const coords = malvinasFeature.geometry.coordinates[0];
      // Find the centroid for labeling
      let latSum = 0;
      let lngSum = 0;
      for (const c of coords) {
        latSum += c[1];
        lngSum += c[0];
      }
      const centroidLat = latSum / coords.length;
      const centroidLng = lngSum / coords.length;

      globe
        .htmlElementsData([
          { lat: centroidLat, lng: centroidLng, feature: malvinasFeature },
        ])
        .htmlLat((d: any) => d.lat)
        .htmlLng((d: any) => d.lng)
        .htmlAltitude(0.008)
        .htmlElement(() => {
          const el = document.createElement('div');
          el.innerHTML =
            '<span style="font-size:10px;background:#1e293be0;color:#fbbf24;padding:2px 6px;border-radius:3px;border:1px solid #f59e0b55;white-space:nowrap;">Islas Malvinas</span>';
          el.style.cursor = 'default';
          return el;
        });
    }

    // ─── Cleanup ───────────────────────────────────────────────────
    return () => {
      globe.pathsData([]);
      globe.polygonsData([]);
      globe.htmlElementsData([]);
    };
  }, [globe, isActive]);

  return null;
}
