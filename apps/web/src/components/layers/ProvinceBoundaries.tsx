import { useEffect, useRef } from 'react';
import type { FeatureCollection, Feature, Polygon } from 'geojson';
import { useRadarStore } from '../../stores/radarStore';
import provincesData from '@shared/geo/argentina-provinces.geojson';

interface ProvinceProperties {
  name: string;
  name_short: string;
  centroid: [number, number];
  region: string;
}

type ProvinceFeature = Feature<Polygon, ProvinceProperties>;

interface Props {
  globe: any; // Globe instance from globe.gl — typed loosely for scaffold
}

export function ProvinceBoundaries({ globe }: Props) {
  const activeLayers = useRadarStore((s) => s.activeLayers);
  const selectProvince = useRadarStore((s) => s.selectProvince);
  const isActive = activeLayers.has('provinces');
  const prevActiveRef = useRef(isActive);
  const hoveredRef = useRef<ProvinceFeature | null>(null);

  useEffect(() => {
    const data = provincesData as unknown as FeatureCollection<Polygon, ProvinceProperties>;
    const features = data.features;
    const prevActive = prevActiveRef.current;
    prevActiveRef.current = isActive;

    if (!isActive) {
      if (prevActive) {
        globe.polygonsData([]);
      }
      return;
    }

    globe
      .polygonsData(features)
      .polygonAltitude(0.003)
      .polygonCapColor((d: ProvinceFeature) => {
        if (d === hoveredRef.current) {
          return 'rgba(100, 200, 255, 0.55)';
        }
        const index = features.indexOf(d);
        const hue = (index * 15) % 360;
        return `hsla(${hue}, 40%, 45%, 0.2)`;
      })
      .polygonSideColor(() => 'rgba(80, 120, 200, 0.05)')
      .polygonStrokeColor((d: ProvinceFeature) => {
        // Brighter, more prominent stroke for Argentina provinces
        const isArgentina = d.properties.name && d.properties.name !== 'unknown';
        return isArgentina
          ? 'rgba(255, 220, 120, 0.55)' // Warm gold stroke
          : 'rgba(180, 200, 255, 0.3)';
      })
      .polygonLabel((d: ProvinceFeature) => {
        return `<div style="font-size:12px;background:#1e293b;color:#f1f5f9;padding:4px 8px;border-radius:4px;border:1px solid #334155;white-space:nowrap;">
          <strong>${d.properties.name}</strong>
        </div>`;
      })
      .onPolygonHover((hovered: ProvinceFeature | null) => {
        hoveredRef.current = hovered;
        globe.polygonCapColor((d: ProvinceFeature) => {
          if (d === hovered) {
            return 'rgba(100, 200, 255, 0.55)';
          }
          const index = features.indexOf(d);
          const hue = (index * 15) % 360;
          return `hsla(${hue}, 40%, 45%, 0.2)`;
        });
      })
      .onPolygonClick((d: ProvinceFeature) => {
        selectProvince(d.properties.name);
      });

    return () => {
      globe.polygonsData([]);
    };
  }, [globe, isActive, selectProvince]);

  return null;
}
