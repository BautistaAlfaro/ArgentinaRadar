/**
 * Weather Alerts — Open-Meteo (free API)
 *
 * Fetches weather data from Open-Meteo API for major Argentine cities.
 * Generates alerts based on weather conditions (heavy rain, extreme temps, etc.)
 * Refreshes every 30 minutes.
 *
 * API: https://api.open-meteo.com/v1/forecast (free, no registration required)
 * Fallback: structured mock data representing common alert patterns.
 */

import axios from 'axios';

export interface WeatherAlert {
  province: string;
  severity: 'yellow' | 'orange' | 'red';
  event: string;
  description: string;
  coordinates: number[][][];
  updatedAt: string;
}

// ─── Province → simplified polygon coordinates ─────────────────────
// Approximate bounding polygons for each province for alert rendering.
const PROVINCE_POLYGONS: Record<string, number[][][]> = {
  'Buenos Aires': [[[-63.5, -41.0], [-56.5, -41.0], [-56.5, -36.5], [-58.0, -36.5], [-58.0, -35.5], [-56.5, -35.5], [-56.5, -33.0], [-62.5, -33.0], [-63.5, -35.0], [-63.5, -41.0]]],
  CABA: [[[-58.53, -34.7], [-58.33, -34.7], [-58.33, -34.53], [-58.53, -34.53], [-58.53, -34.7]]],
  Córdoba: [[[-65.5, -35.0], [-62.0, -35.0], [-62.0, -29.5], [-65.5, -29.5], [-65.5, -35.0]]],
  'Santa Fe': [[[-62.5, -34.0], [-59.5, -34.0], [-59.5, -28.0], [-62.5, -28.0], [-62.5, -34.0]]],
  Mendoza: [[[-70.5, -37.0], [-66.5, -37.0], [-66.5, -32.0], [-70.5, -32.0], [-70.5, -37.0]]],
  Tucumán: [[[-66.0, -28.0], [-64.5, -28.0], [-64.5, -26.0], [-66.0, -26.0], [-66.0, -28.0]]],
  Salta: [[[-68.5, -26.0], [-62.0, -26.0], [-62.0, -22.0], [-68.5, -22.0], [-68.5, -26.0]]],
  'Entre Ríos': [[[-60.5, -34.0], [-58.0, -34.0], [-58.0, -30.5], [-60.5, -30.5], [-60.5, -34.0]]],
  Corrientes: [[[-59.5, -31.0], [-56.0, -31.0], [-56.0, -27.0], [-59.5, -27.0], [-59.5, -31.0]]],
  Chaco: [[[-63.5, -28.0], [-58.5, -28.0], [-58.5, -24.0], [-63.5, -24.0], [-63.5, -28.0]]],
  'Santiago del Estero': [[[-65.5, -30.0], [-62.0, -30.0], [-62.0, -25.5], [-65.5, -25.5], [-65.5, -30.0]]],
  'San Juan': [[[-71.0, -32.5], [-67.5, -32.5], [-67.5, -28.5], [-71.0, -28.5], [-71.0, -32.5]]],
  'La Rioja': [[[-70.0, -32.0], [-66.0, -32.0], [-66.0, -28.0], [-70.0, -28.0], [-70.0, -32.0]]],
  Catamarca: [[[-69.0, -30.0], [-65.0, -30.0], [-65.0, -25.5], [-69.0, -25.5], [-69.0, -30.0]]],
  Jujuy: [[[-67.5, -24.5], [-64.0, -24.5], [-64.0, -21.5], [-67.5, -21.5], [-67.5, -24.5]]],
  'La Pampa': [[[-68.0, -39.5], [-63.5, -39.5], [-63.5, -35.0], [-68.0, -35.0], [-68.0, -39.5]]],
  'Río Negro': [[[-72.0, -42.0], [-62.5, -42.0], [-62.5, -37.5], [-72.0, -37.5], [-72.0, -42.0]]],
  Neuquén: [[[-72.0, -41.0], [-68.0, -41.0], [-68.0, -36.0], [-72.0, -36.0], [-72.0, -41.0]]],
  Chubut: [[[-72.0, -46.5], [-63.0, -46.5], [-63.0, -42.0], [-72.0, -42.0], [-72.0, -46.5]]],
  'Santa Cruz': [[[-73.0, -52.0], [-64.0, -52.0], [-64.0, -46.5], [-73.0, -46.5], [-73.0, -52.0]]],
  'Tierra del Fuego': [[[-69.0, -55.0], [-63.0, -55.0], [-63.0, -52.5], [-69.0, -52.5], [-69.0, -55.0]]],
  Misiones: [[[-56.0, -28.5], [-53.5, -28.5], [-53.5, -25.5], [-56.0, -25.5], [-56.0, -28.5]]],
  Formosa: [[[-63.0, -27.5], [-57.5, -27.5], [-57.5, -22.5], [-63.0, -22.5], [-63.0, -27.5]]],
  'San Luis': [[[-67.5, -36.0], [-64.5, -36.0], [-64.5, -32.0], [-67.5, -32.0], [-67.5, -36.0]]],
};

// ─── Major Argentine cities for weather monitoring ─────────────────
const CITIES = [
  { name: 'Buenos Aires', province: 'CABA', lat: -34.6, lon: -58.4 },
  { name: 'Córdoba', province: 'Córdoba', lat: -31.4, lon: -64.2 },
  { name: 'Rosario', province: 'Santa Fe', lat: -32.9, lon: -60.7 },
  { name: 'Mendoza', province: 'Mendoza', lat: -32.9, lon: -68.8 },
  { name: 'Tucumán', province: 'Tucumán', lat: -26.8, lon: -65.2 },
  { name: 'La Plata', province: 'Buenos Aires', lat: -34.9, lon: -57.9 },
  { name: 'Mar del Plata', province: 'Buenos Aires', lat: -38.0, lon: -57.6 },
  { name: 'Salta', province: 'Salta', lat: -24.8, lon: -65.4 },
  { name: 'Santa Fe', province: 'Santa Fe', lat: -31.6, lon: -60.7 },
  { name: 'Neuquén', province: 'Neuquén', lat: -38.9, lon: -68.1 },
];

// ─── Severity ordering ─────────────────────────────────────────────
const SEVERITY_ORDER: Record<string, number> = {
  yellow: 1,
  orange: 2,
  red: 3,
};

// ─── Mock data for fallback / testing ──────────────────────────────
const MOCK_ALERTS: WeatherAlert[] = [
  {
    province: 'Buenos Aires',
    severity: 'orange',
    event: 'Tormentas fuertes',
    description: 'Se esperan tormentas fuertes con ráfagas, caída de granizo y abundante caída de agua en cortos períodos.',
    coordinates: PROVINCE_POLYGONS['Buenos Aires'],
    updatedAt: new Date().toISOString(),
  },
  {
    province: 'CABA',
    severity: 'yellow',
    event: 'Lluvias persistentes',
    description: 'Lluvias de variada intensidad, algunas localmente fuertes. No se descartan tormentas eléctricas.',
    coordinates: PROVINCE_POLYGONS['CABA'],
    updatedAt: new Date().toISOString(),
  },
  {
    province: 'Córdoba',
    severity: 'red',
    event: 'Tormentas severas',
    description: 'Tormentas muy severas con ráfagas intensas, caída de granizo grande y actividad eléctrica importante.',
    coordinates: PROVINCE_POLYGONS['Córdoba'],
    updatedAt: new Date().toISOString(),
  },
  {
    province: 'Mendoza',
    severity: 'orange',
    event: 'Vientos fuertes (Zonda)',
    description: 'Viento Zonda con ráfagas que pueden superar los 80 km/h, especialmente en precordillera.',
    coordinates: PROVINCE_POLYGONS['Mendoza'],
    updatedAt: new Date().toISOString(),
  },
  {
    province: 'Santa Fe',
    severity: 'yellow',
    event: 'Lluvias y tormentas',
    description: 'Probabilidad de lluvias y tormentas aisladas, algunas localmente fuertes.',
    coordinates: PROVINCE_POLYGONS['Santa Fe'],
    updatedAt: new Date().toISOString(),
  },
];

// ─── State ─────────────────────────────────────────────────────────
let cachedAlerts: WeatherAlert[] = [];
let lastFetch: number = 0;
const REFRESH_INTERVAL = 30 * 60 * 1000; // 30 minutes

/**
 * Generate weather alerts based on Open-Meteo forecast data.
 */
function generateAlertsFromWeather(data: any, city: typeof CITIES[0]): WeatherAlert[] {
  const alerts: WeatherAlert[] = [];
  const hourly = data.hourly;
  
  if (!hourly || !hourly.time || hourly.time.length === 0) return alerts;

  // Check next 6 hours for severe weather
  const nextHours = Math.min(6, hourly.time.length);
  
  let maxPrecipitation = 0;
  let maxWindSpeed = 0;
  let minTemp = Infinity;
  let maxTemp = -Infinity;

  for (let i = 0; i < nextHours; i++) {
    const precip = hourly.precipitation?.[i] || 0;
    const wind = hourly.wind_speed_10m?.[i] || 0;
    const temp = hourly.temperature_2m?.[i] || 0;
    
    maxPrecipitation = Math.max(maxPrecipitation, precip);
    maxWindSpeed = Math.max(maxWindSpeed, wind);
    minTemp = Math.min(minTemp, temp);
    maxTemp = Math.max(maxTemp, temp);
  }

  const coordinates = PROVINCE_POLYGONS[city.province];
  if (!coordinates) return alerts;

  // Heavy rain alert (>10mm in 6 hours)
  if (maxPrecipitation > 10) {
    const severity = maxPrecipitation > 30 ? 'red' : maxPrecipitation > 20 ? 'orange' : 'yellow';
    alerts.push({
      province: city.province,
      severity,
      event: 'Lluvias intensas',
      description: `Se esperan lluvias intensas con acumulados de hasta ${maxPrecipitation.toFixed(1)}mm en las próximas 6 horas.`,
      coordinates,
      updatedAt: new Date().toISOString(),
    });
  }

  // Strong wind alert (>60 km/h)
  if (maxWindSpeed > 60) {
    const severity = maxWindSpeed > 100 ? 'red' : maxWindSpeed > 80 ? 'orange' : 'yellow';
    alerts.push({
      province: city.province,
      severity,
      event: 'Vientos fuertes',
      description: `Ráfagas de viento que pueden superar los ${Math.round(maxWindSpeed)} km/h.`,
      coordinates,
      updatedAt: new Date().toISOString(),
    });
  }

  // Extreme temperature alert
  if (maxTemp > 40) {
    alerts.push({
      province: city.province,
      severity: 'orange',
      event: 'Ola de calor',
      description: `Temperaturas que pueden superar los ${Math.round(maxTemp)}°C.`,
      coordinates,
      updatedAt: new Date().toISOString(),
    });
  } else if (minTemp < -5) {
    alerts.push({
      province: city.province,
      severity: 'yellow',
      event: 'Heladas',
      description: `Temperaturas que pueden descender a ${Math.round(minTemp)}°C.`,
      coordinates,
      updatedAt: new Date().toISOString(),
    });
  }

  return alerts;
}

/**
 * Fetch weather data from Open-Meteo API for a city.
 */
async function fetchCityWeather(city: typeof CITIES[0]): Promise<WeatherAlert[]> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&hourly=temperature_2m,precipitation,wind_speed_10m&timezone=America/Argentina/Buenos_Aires&forecast_days=1`;
    
    const response = await axios.get(url, { timeout: 10000 });
    
    if (response.status === 200 && response.data) {
      return generateAlertsFromWeather(response.data, city);
    }
    
    return [];
  } catch (err) {
    console.warn(`[WeatherAlerts] Failed to fetch weather for ${city.name}:`, (err as Error).message);
    return [];
  }
}

/**
 * Fetch weather alerts from Open-Meteo API for all major Argentine cities.
 * Falls back to mock data if the API is unreachable.
 */
async function fetchFromOpenMeteo(): Promise<WeatherAlert[]> {
  const allAlerts: WeatherAlert[] = [];
  
  // Fetch weather for all cities in parallel
  const results = await Promise.allSettled(
    CITIES.map(city => fetchCityWeather(city))
  );
  
  for (const result of results) {
    if (result.status === 'fulfilled') {
      allAlerts.push(...result.value);
    }
  }
  
  if (allAlerts.length > 0) {
    console.log(`[WeatherAlerts] Generated ${allAlerts.length} alerts from Open-Meteo`);
    return allAlerts;
  }
  
  console.warn('[WeatherAlerts] Open-Meteo returned no alerts, using mock data');
  return MOCK_ALERTS;
}

/**
 * Refresh weather alerts — called on interval.
 */
export async function refreshWeatherAlerts(): Promise<WeatherAlert[]> {
  try {
    cachedAlerts = await fetchFromOpenMeteo();
    lastFetch = Date.now();
  } catch (err) {
    console.error('[WeatherAlerts] Refresh failed:', err);
    if (cachedAlerts.length === 0) {
      cachedAlerts = MOCK_ALERTS;
    }
  }
  return cachedAlerts;
}

/**
 * Get current weather alerts (returns cached data if within refresh interval).
 */
export async function getWeatherAlerts(): Promise<WeatherAlert[]> {
  const elapsed = Date.now() - lastFetch;
  if (cachedAlerts.length === 0 || elapsed > REFRESH_INTERVAL) {
    return refreshWeatherAlerts();
  }
  return cachedAlerts;
}

/**
 * Get the highest severity for a given province.
 */
export function getHighestSeverity(alerts: WeatherAlert[], province: string): WeatherAlert | null {
  const provinceAlerts = alerts.filter(
    (a) => a.province.toLowerCase() === province.toLowerCase(),
  );
  if (provinceAlerts.length === 0) return null;

  return provinceAlerts.sort(
    (a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity],
  )[0];
}
