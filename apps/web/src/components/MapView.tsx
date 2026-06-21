import { useEffect, useRef, useState } from 'react';
import Globe from 'globe.gl';
import * as THREE from 'three';
import { useWebGLDetect } from '../hooks/useWebGLDetect';
import { useNews } from '../hooks/useNews';
import { useRadarStore } from '../stores/radarStore';
import { MapLibreFallback } from './MapLibreFallback';
import { ProvinceBoundaries } from './layers/ProvinceBoundaries';
import { NewsMarkers } from './layers/NewsMarkers';
import { WeatherLayer } from './layers/WeatherLayer';
import { EarthquakeLayer } from './layers/EarthquakeLayer';
import { FireLayer } from './layers/FireLayer';
import { InfrastructureLayer } from './layers/InfrastructureLayer';
import { FlightLayer } from './layers/FlightLayer';
import { BordersLayer } from './layers/BordersLayer';

type GlobeInstance = InstanceType<typeof Globe>;

// ---------------------------------------------------------------------------
// CDN-hosted texture URLs — publicly available on unpkg, threejs.org, etc.
// ---------------------------------------------------------------------------
const TEXTURE_BASE = '//unpkg.com/three-globe/example/img/earth-blue-marble.jpg';
const TEXTURE_BUMP = '//unpkg.com/three-globe/example/img/earth-topology.png';
const TEXTURE_NIGHT = '//unpkg.com/three-globe/example/img/earth-night.jpg';
const TEXTURE_WATER = '//unpkg.com/three-globe/example/img/earth-water.png';
const TEXTURE_BACKGROUND = '//unpkg.com/three-globe/example/img/night-sky.png';
// Cloud texture hosted on the official three.js examples CDN
const TEXTURE_CLOUDS = 'https://threejs.org/examples/textures/planets/earth_clouds_1024.png';

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeInstance | null>(null);
  const cloudMeshRef = useRef<THREE.Mesh | null>(null);
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
      .globeImageUrl(TEXTURE_BASE)
      .bumpImageUrl(TEXTURE_BUMP)
      .backgroundImageUrl(TEXTURE_BACKGROUND)
      .width(width)
      .height(height)
      .pointOfView({ lat: -38.4, lng: -63.6, altitude: 2.5 });

    // ---- Globe-material enhancements (fires once base texture loads) ----
    const loader = new THREE.TextureLoader();

    globe.onGlobeReady(() => {
      const baseMaterial = globe.globeMaterial();
      if (!baseMaterial) return;

      // The default globe material is MeshPhongMaterial (confirmed by three-globe source)
      const material = baseMaterial as THREE.MeshPhongMaterial;

      // Night lights — emissive glow from urban areas on the dark side
      loader.load(TEXTURE_NIGHT, (tex: THREE.Texture) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        material.emissiveMap = tex;
        material.emissive = new THREE.Color(0xffcc88);
        material.emissiveIntensity = 0.3;
        material.needsUpdate = true;
      });

      // Specular water map — makes oceans reflect light
      loader.load(TEXTURE_WATER, (tex: THREE.Texture) => {
        material.specularMap = tex;
        material.specular = new THREE.Color(0x445566);
        material.shininess = 20;
        material.needsUpdate = true;
      });

      // Sharper textures at oblique angles
      if (material.map) {
        material.map.anisotropy = 4;
        material.map.minFilter = THREE.LinearMipmapLinearFilter;
      }
      if (material.bumpMap) {
        material.bumpMap.anisotropy = 4;
      }

      // More visible terrain relief
      material.bumpScale = 0.06;

      material.needsUpdate = true;

      // ---- Clouds layer ----
      const globeRadius = globe.getGlobeRadius();
      const cloudGeo = new THREE.SphereGeometry(globeRadius * 1.006, 64, 64);

      loader.load(TEXTURE_CLOUDS, (cloudTex: THREE.Texture) => {
        cloudTex.colorSpace = THREE.SRGBColorSpace;

        const cloudMat = new THREE.MeshPhongMaterial({
          map: cloudTex,
          transparent: true,
          opacity: 0.4,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        });

        const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
        cloudMeshRef.current = cloudMesh;

        // Attach clouds under the globe mesh so they inherit rotation
        const scene = globe.scene();
        scene.traverse((obj: THREE.Object3D) => {
          if ((obj as THREE.Mesh).isMesh && (obj as THREE.Mesh).material === baseMaterial) {
            obj.add(cloudMesh);
          }
        });
      });
    });

    // ---- Enhanced lighting with southern-hemisphere bias ----
    const ambient = new THREE.AmbientLight(0xcccccc, Math.PI * 0.9);
    const mainLight = new THREE.DirectionalLight(0xffffff, 0.5 * Math.PI);
    mainLight.position.set(0.5, 1, 1).normalize();

    // Fill light from the direction of Argentina to reduce shadow on S. America
    const fillLight = new THREE.DirectionalLight(0xffeedd, 0.25 * Math.PI);
    const arPos = globe.getCoords(-34, -64, 5);
    fillLight.position.set(arPos.x, arPos.y, arPos.z);

    globe.lights([ambient, mainLight, fillLight]);

    // ---- Orbit controls focused on Argentina/South America ----
    const controls = globe.controls();
    // minPolarAngle (~31.5°N): keep South America visible, block N. America/Europe
    controls.minPolarAngle = Math.PI * 0.35;
    // maxPolarAngle (~-68.4°S): allow Tierra del Fuego, Islas Malvinas, Antártida
    controls.maxPolarAngle = Math.PI * 0.88;
    // Azimuth (±90° from lng=0): Atlantic ocean + Pacific coast of SA
    controls.minAzimuthAngle = -Math.PI * 0.5;
    controls.maxAzimuthAngle = Math.PI * 0.5;
    controls.enableZoom = true;
    // Globe radius = 100 → minDistance 130 = altitude ~0.3 (close zoom)
    controls.minDistance = 130;
    controls.maxDistance = 600;

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

      // Dispose cloud mesh
      if (cloudMeshRef.current) {
        cloudMeshRef.current.geometry.dispose();
        if (Array.isArray(cloudMeshRef.current.material)) {
          (cloudMeshRef.current.material as THREE.Material[]).forEach((m: THREE.Material) => m.dispose());
        } else {
          (cloudMeshRef.current.material as THREE.Material).dispose();
        }
        cloudMeshRef.current = null;
      }

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
          <WeatherLayer globe={globeRef.current} />
          <EarthquakeLayer globe={globeRef.current} />
          <FireLayer globe={globeRef.current} />
          <InfrastructureLayer globe={globeRef.current} />
          <BordersLayer globe={globeRef.current} />
          <FlightLayer globe={globeRef.current} />
        </>
      )}
    </div>
  );
}
