import { useEffect, useRef, useState } from 'react';
import Globe from 'globe.gl';
import { useWebGLDetect } from '../hooks/useWebGLDetect';
import { MapLibreFallback } from './MapLibreFallback';
import { ProvinceBoundaries } from './layers/ProvinceBoundaries';

type GlobeInstance = InstanceType<typeof Globe>;

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeInstance | null>(null);
  const [globeReady, setGlobeReady] = useState(false);
  const hasWebGL = useWebGLDetect();

  useEffect(() => {
    if (!containerRef.current || !hasWebGL) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const globe = new Globe(containerRef.current)
      .globeImageUrl('//unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
      .backgroundImageUrl('//unpkg.com/three-globe/example/img/night-sky.png')
      .width(width)
      .height(height)
      .pointOfView({ lat: -38.4, lng: -63.6, altitude: 4.5 });

    globeRef.current = globe;
    setGlobeReady(true);

    const handleResize = () => {
      if (!containerRef.current || !globeRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      globeRef.current.width(w).height(h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      setGlobeReady(false);
      if (globeRef.current) {
        globeRef.current._destructor();
        globeRef.current = null;
      }
    };
  }, [hasWebGL]);

  if (!hasWebGL) {
    return <MapLibreFallback />;
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative"
      style={{ minHeight: 0 }}
    >
      {globeReady && globeRef.current && (
        <ProvinceBoundaries globe={globeRef.current} />
      )}
    </div>
  );
}
