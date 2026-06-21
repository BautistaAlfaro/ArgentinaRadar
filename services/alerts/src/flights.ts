/**
 * Flight Tracking — OpenSky Network (free API fallback)
 *
 * Fetches flight positions from the OpenSky Network API (free, no key required for
 * basic access, though rate-limited). Filters by Argentine airspace bounds.
 * Falls back to mock data if the API is unavailable.
 * Refreshes every 30 seconds. Limited to 200 flights max.
 *
 * API: https://opensky-network.org/api/states/all
 */

import axios from 'axios';

export interface Flight {
  callsign: string;
  lat: number;
  lng: number;
  altitude: number;
  velocity: number;
  onGround: boolean;
  updatedAt: string;
}

// ─── Argentine airspace bounds ─────────────────────────────────────
const ARG_LAT_MIN = -55;
const ARG_LAT_MAX = -22;
const ARG_LON_MIN = -75;
const ARG_LON_MAX = -53;

const MAX_FLIGHTS = 200;

// ─── State ─────────────────────────────────────────────────────────
let cachedFlights: Flight[] = [];
let lastFetch: number = 0;
const REFRESH_INTERVAL = 30 * 1000; // 30 seconds

// ─── Mock data for fallback ────────────────────────────────────────
function generateMockFlights(): Flight[] {
  const airlines = ['ARG', 'AAL', 'DAL', 'UAL', 'LAT', 'SKY', 'JET', 'AZU'];
  const now = new Date().toISOString();
  const flights: Flight[] = [];

  // Generate flights along common Argentine air routes
  const routes: Array<{ origin: [number, number]; dest: [number, number] }> = [
    { origin: [-58.5, -34.6], dest: [-64.3, -31.4] }, // AEP → COR
    { origin: [-58.5, -34.6], dest: [-68.4, -32.8] }, // AEP → MDZ
    { origin: [-58.5, -34.6], dest: [-65.0, -27.5] }, // AEP → TUC
    { origin: [-58.5, -34.6], dest: [-68.0, -38.9] }, // AEP → NQN
    { origin: [-58.5, -34.6], dest: [-57.6, -38.0] }, // AEP → MDQ
    { origin: [-64.3, -31.4], dest: [-58.5, -34.6] }, // COR → AEP
    { origin: [-68.4, -32.8], dest: [-58.5, -34.6] }, // MDZ → AEP
    { origin: [-58.3, -34.8], dest: [-57.9, -34.9] }, // EZE → AEP (short hop)
  ];

  for (let i = 0; i < routes.length; i++) {
    const { origin, dest } = routes[i];
    // Interpolate position along route (0-100% progress)
    const progress = Math.random();
    const lat = origin[1] + (dest[1] - origin[1]) * progress + (Math.random() - 0.5) * 0.5;
    const lng = origin[0] + (dest[0] - origin[0]) * progress + (Math.random() - 0.5) * 0.5;

    flights.push({
      callsign: `${airlines[i % airlines.length]}${String(1000 + Math.floor(Math.random() * 9000))}`,
      lat,
      lng,
      altitude: Math.floor(25000 + Math.random() * 15000),
      velocity: Math.floor(400 + Math.random() * 300),
      onGround: false,
      updatedAt: now,
    });
  }

  // Add 2-3 ground flights at major airports
  const airports: Array<[number, number]> = [
    [-58.5, -34.6], // AEP
    [-58.3, -34.8], // EZE
    [-64.3, -31.4], // COR
  ];
  for (const [lng, lat] of airports.slice(0, 2)) {
    flights.push({
      callsign: `${airlines[Math.floor(Math.random() * airlines.length)]}${String(1000 + Math.floor(Math.random() * 9000))}`,
      lat: lat + (Math.random() - 0.5) * 0.05,
      lng: lng + (Math.random() - 0.5) * 0.05,
      altitude: 0,
      velocity: 0,
      onGround: true,
      updatedAt: now,
    });
  }

  return flights;
}

/**
 * Parse OpenSky Network API response.
 * Response format: { time, states: [[icao24, callsign, origin_country, time_position,
 *   last_contact, longitude, latitude, baro_altitude, on_ground, velocity, ...]] }
 */
function parseOpenSkyResponse(data: any): Flight[] {
  const flights: Flight[] = [];
  const now = new Date().toISOString();

  if (!data?.states || !Array.isArray(data.states)) {
    return flights;
  }

  for (const state of data.states) {
    if (!state || state.length < 10) continue;

    const callsign = (state[1] || 'UNKN').trim();
    const longitude = state[5];
    const latitude = state[6];
    const altitude = state[7] ?? 0;
    const onGround = state[8] ?? true;
    const velocity = state[9] ?? 0;

    // Skip entries without valid coordinates
    if (longitude == null || latitude == null) continue;

    // Filter by Argentine airspace
    if (latitude < ARG_LAT_MIN || latitude > ARG_LAT_MAX) continue;
    if (longitude < ARG_LON_MIN || longitude > ARG_LON_MAX) continue;

    flights.push({
      callsign: callsign || 'UNKN',
      lat: latitude,
      lng: longitude,
      altitude: altitude ?? 0,
      velocity: velocity ?? 0,
      onGround: onGround ?? true,
      updatedAt: now,
    });

    if (flights.length >= MAX_FLIGHTS) break;
  }

  return flights;
}

/**
 * Fetch flights from OpenSky Network API.
 */
async function fetchFromOpenSky(): Promise<Flight[]> {
  try {
    // OpenSky Network basic API — no auth required for anonymous access (rate limited)
    // For authenticated access, set OPENSKY_USERNAME and OPENSKY_PASSWORD env vars
    const auth =
      process.env.OPENSKY_USERNAME && process.env.OPENSKY_PASSWORD
        ? { username: process.env.OPENSKY_USERNAME, password: process.env.OPENSKY_PASSWORD }
        : undefined;

    const config: Record<string, unknown> = { timeout: 15000 };
    if (auth) {
      config.auth = auth;
    }

    const response = await axios.get('https://opensky-network.org/api/states/all', config);

    if (response.status !== 200 || !response.data) {
      console.warn('[Flights] Invalid OpenSky response');
      return generateMockFlights();
    }

    const flights = parseOpenSkyResponse(response.data);
    console.log(`[Flights] Fetched ${flights.length} flights in Argentine airspace`);

    return flights;
  } catch (err) {
    console.warn('[Flights] OpenSky API failed, using mock data:', (err as Error).message);
    return generateMockFlights();
  }
}

/**
 * Refresh flights — called on interval.
 */
export async function refreshFlights(): Promise<Flight[]> {
  try {
    cachedFlights = await fetchFromOpenSky();
    lastFetch = Date.now();
  } catch (err) {
    console.error('[Flights] Refresh failed:', err);
    if (cachedFlights.length === 0) {
      cachedFlights = generateMockFlights();
    }
  }
  return cachedFlights;
}

/**
 * Get current flights (returns cached data if within refresh interval).
 */
export async function getFlights(): Promise<Flight[]> {
  const elapsed = Date.now() - lastFetch;
  if (cachedFlights.length === 0 || elapsed > REFRESH_INTERVAL) {
    return refreshFlights();
  }
  return cachedFlights;
}
