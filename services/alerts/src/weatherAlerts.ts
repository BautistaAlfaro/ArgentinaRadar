/**
 * Weather Alerts — SMN (Servicio Meteorológico Nacional)
 *
 * Fetches weather alerts for Argentina provinces from the SMN API.
 * Parses alerts by province with severity levels (yellow/orange/red).
 * Refreshes every 30 minutes.
 *
 * API: https://ssl.smn.gob.ar/service/alerts/warnings (XML)
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
 * Parse SMN XML alert response into our WeatherAlert format.
 * The SMN API returns XML with <Aviso> elements containing province,
 * severity, description, and polygon coordinates.
 */
function parseSmnXml(xml: string): WeatherAlert[] {
  const alerts: WeatherAlert[] = [];

  try {
    // Simple regex-based XML parser for SMN alerts
    const avisoRegex = /<Aviso[^>]*>([\s\S]*?)<\/Aviso>/gi;
    let match: RegExpExecArray | null;

    while ((match = avisoRegex.exec(xml)) !== null) {
      const avisoXml = match[1];

      const getField = (tag: string): string => {
        const fieldMatch = new RegExp(`<${tag}>([^<]*)<\\/${tag}>`).exec(avisoXml);
        return fieldMatch ? fieldMatch[1].trim() : '';
      };

      const province = getField('provincia');
      const severityRaw = getField('severidad').toLowerCase();
      const event = getField('fenomeno');
      const description = getField('descripcion');

      // Map severity to our enum
      let severity: 'yellow' | 'orange' | 'red' = 'yellow';
      if (severityRaw.includes('naranja') || severityRaw === 'orange') severity = 'orange';
      if (severityRaw.includes('roja') || severityRaw === 'red') severity = 'red';

      // Get polygon coordinates if available
      const coordsMatch = new RegExp(`<poligono>([^<]*)<\\/poligono>`).exec(avisoXml);
      let coordinates = PROVINCE_POLYGONS[province] ?? [];

      if (coordsMatch && coordsMatch[1].trim()) {
        try {
          const parsed = JSON.parse(coordsMatch[1]);
          if (Array.isArray(parsed) && parsed.length > 0) {
            coordinates = parsed;
          }
        } catch {
          // Fall back to province polygon
        }
      }

      if (province && event) {
        alerts.push({
          province,
          severity,
          event,
          description,
          coordinates,
          updatedAt: new Date().toISOString(),
        });
      }
    }
  } catch (err) {
    console.warn('[WeatherAlerts] Failed to parse SMN XML:', err);
  }

  return alerts;
}

/**
 * Fetch weather alerts from SMN API.
 * Falls back to mock data if the API is unreachable.
 */
async function fetchFromSmn(): Promise<WeatherAlert[]> {
  const urls = [
    'https://ssl.smn.gob.ar/service/alerts/warnings',
    'https://ws.smn.gob.ar/alerts/warnings',
  ];

  for (const url of urls) {
    try {
      const response = await axios.get(url, { timeout: 10000 });
      if (response.status === 200 && response.data) {
        const xml = typeof response.data === 'string' ? response.data : String(response.data);
        const parsed = parseSmnXml(xml);
        if (parsed.length > 0) {
          console.log(`[WeatherAlerts] Fetched ${parsed.length} alerts from SMN`);
          return parsed;
        }
      }
    } catch (err) {
      console.warn(`[WeatherAlerts] SMN API failed (${url}):`, (err as Error).message);
    }
  }

  console.warn('[WeatherAlerts] All SMN endpoints failed, using mock data');
  return MOCK_ALERTS;
}

/**
 * Refresh weather alerts — called on interval.
 */
export async function refreshWeatherAlerts(): Promise<WeatherAlert[]> {
  try {
    cachedAlerts = await fetchFromSmn();
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
