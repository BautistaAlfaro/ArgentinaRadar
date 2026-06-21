/**
 * Fire Data — NASA FIRS
 *
 * Fetches active fire hotspots from NASA FIRS API.
 * Filters by Argentina bounding box.
 * Falls back to static test data if API requires token.
 * Refreshes every 3 hours.
 *
 * API: https://firms.modaps.eosdis.nasa.gov/api/area/csv/{API_KEY}/argentina/24
 */

import axios from 'axios';

export interface FireHotspot {
  lat: number;
  lng: number;
  brightness: number;
  confidence: string;
  updatedAt: string;
}

// ─── Argentina bounding box (same as earthquakes) ──────────────────
const ARG_LAT_MIN = -55;
const ARG_LAT_MAX = -22;
const ARG_LON_MIN = -75;
const ARG_LON_MAX = -53;

// ─── State ─────────────────────────────────────────────────────────
let cachedFires: FireHotspot[] = [];
let lastFetch: number = 0;
const REFRESH_INTERVAL = 3 * 60 * 60 * 1000; // 3 hours

// ─── Mock data for fallback ────────────────────────────────────────
const MOCK_FIRES: FireHotspot[] = [
  { lat: -31.5, lng: -64.2, brightness: 320, confidence: 'high', updatedAt: new Date().toISOString() },
  { lat: -31.8, lng: -64.5, brightness: 280, confidence: 'high', updatedAt: new Date().toISOString() },
  { lat: -32.1, lng: -64.8, brightness: 150, confidence: 'low', updatedAt: new Date().toISOString() },
  { lat: -30.2, lng: -65.1, brightness: 400, confidence: 'high', updatedAt: new Date().toISOString() },
  { lat: -27.5, lng: -63.5, brightness: 210, confidence: 'nominal', updatedAt: new Date().toISOString() },
  { lat: -24.8, lng: -65.2, brightness: 180, confidence: 'nominal', updatedAt: new Date().toISOString() },
  { lat: -38.5, lng: -60.5, brightness: 90, confidence: 'low', updatedAt: new Date().toISOString() },
  { lat: -34.9, lng: -58.5, brightness: 350, confidence: 'high', updatedAt: new Date().toISOString() },
  { lat: -32.9, lng: -60.6, brightness: 120, confidence: 'low', updatedAt: new Date().toISOString() },
  { lat: -26.8, lng: -66.2, brightness: 270, confidence: 'high', updatedAt: new Date().toISOString() },
  { lat: -28.3, lng: -64.9, brightness: 310, confidence: 'high', updatedAt: new Date().toISOString() },
  { lat: -33.5, lng: -67.2, brightness: 160, confidence: 'nominal', updatedAt: new Date().toISOString() },
];

/**
 * Parse NASA FIRS CSV line into a FireHotspot.
 * CSV format: latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,confidence,version,bright_t31,frp,daynight
 */
function parseCsvLine(line: string): FireHotspot | null {
  const parts = line.split(',');
  if (parts.length < 9) return null;

  // Skip header row
  const lat = parseFloat(parts[0]);
  const lng = parseFloat(parts[1]);

  if (isNaN(lat) || isNaN(lng)) return null;
  if (lat < ARG_LAT_MIN || lat > ARG_LAT_MAX) return null;
  if (lng < ARG_LON_MIN || lng > ARG_LON_MAX) return null;

  const brightness = parseFloat(parts[2]) || 0;
  const confidence = (parts[8] || 'unknown').trim().toLowerCase();

  return {
    lat,
    lng,
    brightness,
    confidence,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Fetch fire hotspots from NASA FIRS API.
 * Falls back to mock data if API key is not configured or request fails.
 */
async function fetchFromFirms(): Promise<FireHotspot[]> {
  const apiKey = process.env.FIRMS_API_KEY || 'OPEN_DATA_TOKEN';

  // If using default token, skip API and use mock data
  if (apiKey === 'OPEN_DATA_TOKEN') {
    console.log('[Fires] No FIRMS API key configured, using mock data');
    return MOCK_FIRES;
  }

  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${apiKey}/argentina/24`;

  try {
    const response = await axios.get(url, { timeout: 20000 });

    if (response.status !== 200 || !response.data) {
      console.warn('[Fires] Invalid FIRMS response');
      return MOCK_FIRES;
    }

    const csv = typeof response.data === 'string' ? response.data : String(response.data);
    const lines = csv.split('\n').filter((l: string) => l.trim().length > 0);

    // Skip header (first line)
    const dataLines = lines.slice(1);

    const hotspots: FireHotspot[] = [];
    for (const line of dataLines) {
      const parsed = parseCsvLine(line);
      if (parsed) {
        hotspots.push(parsed);
      }
    }

    console.log(`[Fires] Fetched ${hotspots.length} fire hotspots from NASA FIRS`);
    return hotspots;
  } catch (err) {
    console.warn('[Fires] NASA FIRS API failed, using mock data:', (err as Error).message);
    return MOCK_FIRES;
  }
}

/**
 * Refresh fire hotspots — called on interval.
 */
export async function refreshFires(): Promise<FireHotspot[]> {
  try {
    cachedFires = await fetchFromFirms();
    lastFetch = Date.now();
  } catch (err) {
    console.error('[Fires] Refresh failed:', err);
    if (cachedFires.length === 0) {
      cachedFires = MOCK_FIRES;
    }
  }
  return cachedFires;
}

/**
 * Get current fire hotspots (returns cached data if within refresh interval).
 */
export async function getFires(): Promise<FireHotspot[]> {
  const elapsed = Date.now() - lastFetch;
  if (cachedFires.length === 0 || elapsed > REFRESH_INTERVAL) {
    return refreshFires();
  }
  return cachedFires;
}
