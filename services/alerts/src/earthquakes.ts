/**
 * Earthquake Data — USGS
 *
 * Fetches earthquakes from the USGS API, filters by Argentina bounding box
 * (lat -55 to -22, lon -75 to -53), and only returns magnitude ≥ 3.0.
 * Refreshes every hour.
 *
 * API: https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson
 */

import axios from 'axios';

export interface Earthquake {
  id: string;
  magnitude: number;
  location: string;
  depth: number;
  time: string;
  url: string;
  lat: number;
  lng: number;
}

// ─── Argentina bounding box ────────────────────────────────────────
const ARG_LAT_MIN = -55;
const ARG_LAT_MAX = -22;
const ARG_LON_MIN = -75;
const ARG_LON_MAX = -53;

const MIN_MAGNITUDE = 3.0;

// ─── State ─────────────────────────────────────────────────────────
let cachedEarthquakes: Earthquake[] = [];
let lastFetch: number = 0;
const REFRESH_INTERVAL = 60 * 60 * 1000; // 1 hour

const USGS_URL =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson';

/**
 * Check if coordinates fall within Argentina bounding box.
 */
function isInArgentina(lat: number, lng: number): boolean {
  return (
    lat >= ARG_LAT_MIN &&
    lat <= ARG_LAT_MAX &&
    lng >= ARG_LON_MIN &&
    lng <= ARG_LON_MAX
  );
}

/**
 * Parse a USGS feature into our Earthquake format.
 */
function parseFeature(feature: any): Earthquake | null {
  try {
    const props = feature.properties;
    const coords = feature.geometry?.coordinates;

    if (!props || !coords || coords.length < 3) return null;

    const [lng, lat, depth] = coords;
    const magnitude = props.mag ?? 0;

    if (magnitude < MIN_MAGNITUDE) return null;
    if (!isInArgentina(lat, lng)) return null;

    return {
      id: feature.id ?? props.code ?? String(Math.random()),
      magnitude,
      location: props.place ?? 'Unknown',
      depth: depth ?? 0,
      time: new Date(props.time).toISOString(),
      url: props.url ?? '',
      lat,
      lng,
    };
  } catch (err) {
    console.warn('[Earthquakes] Failed to parse feature:', err);
    return null;
  }
}

/**
 * Fetch earthquakes from USGS API.
 */
async function fetchFromUsgs(): Promise<Earthquake[]> {
  try {
    const response = await axios.get(USGS_URL, { timeout: 15000 });

    if (response.status !== 200 || !response.data?.features) {
      console.warn('[Earthquakes] Invalid USGS response');
      return [];
    }

    const earthquakes: Earthquake[] = [];
    for (const feature of response.data.features) {
      const parsed = parseFeature(feature);
      if (parsed) {
        earthquakes.push(parsed);
      }
    }

    // Sort by magnitude descending
    earthquakes.sort((a, b) => b.magnitude - a.magnitude);

    console.log(`[Earthquakes] Found ${earthquakes.length} earthquakes in Argentina region`);
    return earthquakes;
  } catch (err) {
    console.error('[Earthquakes] USGS API failed:', (err as Error).message);
    return [];
  }
}

/**
 * Refresh earthquakes — called on interval.
 */
export async function refreshEarthquakes(): Promise<Earthquake[]> {
  try {
    cachedEarthquakes = await fetchFromUsgs();
    lastFetch = Date.now();
  } catch (err) {
    console.error('[Earthquakes] Refresh failed:', err);
  }
  return cachedEarthquakes;
}

/**
 * Get current earthquakes (returns cached data if within refresh interval).
 */
export async function getEarthquakes(): Promise<Earthquake[]> {
  const elapsed = Date.now() - lastFetch;
  if (elapsed > REFRESH_INTERVAL) {
    return refreshEarthquakes();
  }
  return cachedEarthquakes;
}
