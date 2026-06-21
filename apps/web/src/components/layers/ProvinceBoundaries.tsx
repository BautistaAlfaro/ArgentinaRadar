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
      .polygonLat((d: ProvinceFeature) => d.properties.centroid[1])
      .polygonLng((d: ProvinceFeature) => d.properties.centroid[0])
      .polygonAltitude(0.002)
      .polygonCapColor((d: ProvinceFeature) => {
        const index = features.indexOf(d);
        const hue = (index * 15) % 360;
        return `hsla(${hue}, 40%, 45%, 0.2)`;
      })
      .polygonSideColor(() => 'rgba(100, 130, 200, 0.06)')
      .polygonStrokeColor(() => 'rgba(180, 200, 255, 0.35)')
      .polygonLabel((d: ProvinceFeature) => {
        return `<div style="font-size:12px;background:#1e293b;color:#f1f5f9;padding:4px 8px;border-radius:4px;border:1px solid #334155;white-space:nowrap;">
          <strong>${d.properties.name}</strong>
        </div>`;
      })
      .onPolygonHover((hovered: ProvinceFeature | null) => {
        globe.polygonCapColor((d: ProvinceFeature) => {
          if (d === hovered) {
            return 'rgba(100, 180, 255, 0.45)';
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
