import { useEffect, useRef, useState } from 'react';
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
  const selectedProvince = useRadarStore((s) => s.selectedProvince);
  const selectProvince = useRadarStore((s) => s.selectProvince);
  const isActive = activeLayers.has('provinces');
  const prevActiveRef = useRef(isActive);
  const hoveredRef = useRef<ProvinceFeature | null>(null);
  const selectedProvinceRef = useRef(selectedProvince);
  const featuresRef = useRef<ProvinceFeature[]>([]);

  // Pulse animation for selected province
  const [pulseOn, setPulseOn] = useState(false);

  useEffect(() => {
    if (!selectedProvince) {
      setPulseOn(false);
      return;
    }
    const timer = setInterval(() => setPulseOn((p) => !p), 800);
    return () => clearInterval(timer);
  }, [selectedProvince]);

  // Keep ref in sync with store value
  selectedProvinceRef.current = selectedProvince;

  // Helper to build the color accessor function
  function makeColorFn(hovered: ProvinceFeature | null) {
    return (d: ProvinceFeature) => {
      if (d === hovered) return 'rgba(100, 200, 255, 0.7)';

      const sp = selectedProvinceRef.current;
      if (sp && d.properties.name === sp) {
        return pulseOn
          ? 'rgba(255, 210, 60, 0.7)'  // Brighter pulse
          : 'rgba(255, 210, 60, 0.45)'; // Dimmer pulse
      }

      const features = featuresRef.current;
      const index = features.indexOf(d);
      const hue = (index * 15) % 360;
      return `hsla(${hue}, 40%, 45%, 0.2)`;
    };
  }

  // Re-apply colors when pulse or selectedProvince changes
  const redrawRef = useRef<() => void>(() => {});
  redrawRef.current = () => {
    if (!isActive) return;
    globe.polygonCapColor(makeColorFn(hoveredRef.current));
  };

  useEffect(() => {
    if (isActive) {
      redrawRef.current();
    }
  }, [pulseOn, selectedProvince, isActive]);

  useEffect(() => {
    const data = provincesData as unknown as FeatureCollection<Polygon, ProvinceProperties>;
    const features = data.features;
    featuresRef.current = features;
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
      .polygonCapColor(makeColorFn(null))
      .polygonSideColor(() => 'rgba(80, 120, 200, 0.05)')
      .polygonStrokeColor((d: ProvinceFeature) => {
        const isArgentina = d.properties.name && d.properties.name !== 'unknown';
        return isArgentina
          ? 'rgba(255, 220, 120, 0.55)'
          : 'rgba(180, 200, 255, 0.3)';
      })
      .polygonLabel((d: ProvinceFeature) => {
        return `<div style="font-size:12px;background:#1e293b;color:#f1f5f9;padding:4px 8px;border-radius:4px;border:1px solid #334155;white-space:nowrap;">
          <strong>${d.properties.name}</strong>
        </div>`;
      })
      .onPolygonHover((hovered: ProvinceFeature | null) => {
        hoveredRef.current = hovered;
        // Use redrawRef to pick up the latest makeColorFn closure
        redrawRef.current();
      })
      .onPolygonClick((d: ProvinceFeature, event?: MouseEvent) => {
        const [lng, lat] = d.properties.centroid;
        // Toggle: click same province to deselect, else select + zoom
        if (selectedProvinceRef.current === d.properties.name) {
          selectProvince(null);
          // Reset zoom to Argentina overview
          globe.pointOfView({ lat: -38.4, lng: -63.6, altitude: 2.5 }, 600);
        } else {
          selectProvince(d.properties.name);
          // Zoom to province centroid — altitude 1.2 gives ~"half province" view
          globe.pointOfView({ lat, lng, altitude: 1.2 }, 600);
        }
        // Stop propagation to prevent container click handler
        event?.stopPropagation?.();
      });

    return () => {
      globe.polygonsData([]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globe, isActive, selectProvince]);

  return null;
}
