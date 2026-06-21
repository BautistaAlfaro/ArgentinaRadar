import { useEffect, useRef, useState } from 'react';
import Globe from 'globe.gl';
import { useWebGLDetect } from '../hooks/useWebGLDetect';
import { useNews } from '../hooks/useNews';
import { useRadarStore } from '../stores/radarStore';
import { MapLibreFallback } from './MapLibreFallback';
import { ProvinceBoundaries } from './layers/ProvinceBoundaries';
import { NewsMarkers } from './layers/NewsMarkers';

type GlobeInstance = InstanceType<typeof Globe>;

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeInstance | null>(null);
  const [globeReady, setGlobeReady] = useState(false);
  const hasWebGL = useWebGLDetect();

  // Fetch geolocated articles for markers
  const { articles } = useNews();

  // Selected news location → center map
  const selectedNewsLocation = useRadarStore((s) => s.selectedNewsLocation);
  const selectNewsLocation = useRadarStore((s) => s.selectNewsLocation);

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

  // Center map on selected article location
  useEffect(() => {
    if (!globeRef.current || !selectedNewsLocation) return;

    globeRef.current.pointOfView(
      {
        lat: selectedNewsLocation.lat,
        lng: selectedNewsLocation.lng,
        altitude: 3.5,
      },
      800, // transition duration ms
    );
  }, [selectedNewsLocation]);

  // Clear selection when clicking off
  const handleContainerClick = (e: React.MouseEvent) => {
    // Only clear if clicking directly on the container (not on a marker/globe)
    if (e.target === containerRef.current) {
      selectNewsLocation(null);
    }
  };

  if (!hasWebGL) {
    return <MapLibreFallback />;
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative"
      style={{ minHeight: 0 }}
      onClick={handleContainerClick}
    >
      {globeReady && globeRef.current && (
        <>
          <ProvinceBoundaries globe={globeRef.current} />
          <NewsMarkers globe={globeRef.current} articles={articles} />
        </>
      )}
    </div>
  );
}
