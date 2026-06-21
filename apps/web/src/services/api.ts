/**
 * API Client for ArgentinaRadar services.
 *
 * Provides typed fetch functions for:
 *   - News (ingestion service on :3001)
 *   - Geolocated news (geolocation service on :3002)
 *   - Economic data (economic service on :3006)
 */

import type { NewsItem, EconomicIndicator, WeatherAlert, Earthquake, FireHotspot, FlightData } from '@shared/types';

const NEWS_API = 'http://localhost:3001';
const GEO_API = 'http://localhost:3002';
const ECON_API = 'http://localhost:3006';
const ALERTS_API = 'http://localhost:3007';
const EVENT_API = 'http://localhost:3008';
const TRENDS_API = 'http://localhost:3009';

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

// ─── Fetch news items ─────────────────────────────────────────────
async function fetchNews(params?: {
  category?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<PaginatedResponse<NewsItem>> {
  const searchParams = new URLSearchParams();
  if (params?.category) searchParams.set('category', params.category);
  if (params?.status) searchParams.set('status', params.status);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));

  const url = `${NEWS_API}/api/news${searchParams.toString() ? '?' + searchParams.toString() : ''}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch news: ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
}

// ─── Fetch geolocated news ────────────────────────────────────────
export async function fetchGeolocatedNews(params?: {
  category?: string;
  province?: string;
  limit?: number;
  offset?: number;
}): Promise<PaginatedResponse<NewsItem>> {
  const searchParams = new URLSearchParams();
  if (params?.category) searchParams.set('category', params.category);
  if (params?.province) searchParams.set('province', params.province);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));

  const url = `${GEO_API}/api/news/geolocated${searchParams.toString() ? '?' + searchParams.toString() : ''}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch geolocated news: ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
}

// ─── Geolocate text ───────────────────────────────────────────────
async function geolocateText(text: string): Promise<{
  province: string;
  city: string | null;
  neighborhood: string | null;
  landmark: string | null;
  lat: number;
  lng: number;
  confidence: number;
  label: string | null;
}> {
  const resp = await fetch(`${GEO_API}/api/geolocate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!resp.ok) {
    throw new Error(`Geolocation failed: ${resp.status}`);
  }
  return resp.json();
}

// ─── Fetch economic indicators ────────────────────────────────────
export async function fetchEconomicData(): Promise<EconomicIndicator[]> {
  const resp = await fetch(`${ECON_API}/api/economic`);
  if (!resp.ok) {
    throw new Error(`Failed to fetch economic data: ${resp.status}`);
  }
  return resp.json();
}

// ─── Fetch service health ─────────────────────────────────────────
async function fetchServiceHealth(serviceUrl: string): Promise<{
  status: string;
  uptime: number;
}> {
  const resp = await fetch(`${serviceUrl}/health`);
  if (!resp.ok) {
    throw new Error(`Health check failed: ${resp.status}`);
  }
  return resp.json();
}

// ─── Event types ──────────────────────────────────────────────────

export type ConsensusLevel = 'high' | 'medium' | 'low';

export interface EventItem {
  id: string;
  title: string;
  summary: string;
  articleCount: number;
  sources: string[];
  consensus: ConsensusLevel;
  impactScore: number; // 0–100
  location: {
    lat: number;
    lng: number;
    province: string;
    city: string | null;
  };
  publishedAt: string; // ISO 8601
  relatedArticleIds: string[];
}

// ─── Fetch events ─────────────────────────────────────────────────
export async function fetchEvents(params?: {
  impact_min?: number;
  consensus?: ConsensusLevel;
  province?: string;
  limit?: number;
  offset?: number;
}): Promise<PaginatedResponse<EventItem>> {
  const searchParams = new URLSearchParams();
  if (params?.impact_min !== undefined) searchParams.set('impact_min', String(params.impact_min));
  if (params?.consensus) searchParams.set('consensus', params.consensus);
  if (params?.province) searchParams.set('province', params.province);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));

  const url = `${EVENT_API}/api/events${searchParams.toString() ? '?' + searchParams.toString() : ''}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch events: ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
}

export async function fetchEvent(id: string): Promise<EventDetail> {
  const resp = await fetch(`${EVENT_API}/api/events/${encodeURIComponent(id)}`);
  if (!resp.ok) {
    throw new Error(`Failed to fetch event ${id}: ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
}

async function fetchTrendingEvents(): Promise<EventItem[]> {
  const resp = await fetch(`${EVENT_API}/api/events/trending`);
  if (!resp.ok) {
    throw new Error(`Failed to fetch trending events: ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
}

// ─── Trending entities ────────────────────────────────────────────

const BACKEND_TO_FRONTEND_TYPE: Record<string, 'persona' | 'lugar' | 'organización'> = {
  person: 'persona',
  place: 'lugar',
  organization: 'organización',
};

export interface TrendingEntity {
  name: string;
  type: 'persona' | 'lugar' | 'organización';
  mentions: number;
  previousMentions: number;
  growthRate: number; // percentage, e.g. 45 or -12
  score: number;
}

/**
 * Fallback mock trends so the UI has data to display even when the
 * trend-analyzer hasn't received entity mentions yet.
 */
const MOCK_TRENDS: TrendingEntity[] = [
  { name: 'Javier Milei',       type: 'persona',       mentions: 2847, previousMentions: 2103, growthRate: 35, score: 35000 },
  { name: 'Inflación',          type: 'organización',  mentions: 2140, previousMentions: 1890, growthRate: 13, score: 28000 },
  { name: 'Copa Argentina',     type: 'organización',  mentions: 1856, previousMentions: 1200, growthRate: 55, score: 26000 },
  { name: 'Buenos Aires',       type: 'lugar',         mentions: 1520, previousMentions: 1480, growthRate:  3, score: 15500 },
  { name: 'River Plate',        type: 'organización',  mentions: 1230, previousMentions:  890, growthRate: 38, score: 17000 },
  { name: 'Santa Fe',           type: 'lugar',         mentions:  980, previousMentions: 1020, growthRate: -4, score:  9500 },
  { name: 'Patricia Bullrich',  type: 'persona',       mentions:  890, previousMentions:  650, growthRate: 37, score: 12000 },
  { name: 'YPF',                type: 'organización',  mentions:  750, previousMentions:  820, growthRate: -9, score:  7000 },
  { name: 'Córdoba',            type: 'lugar',         mentions:  680, previousMentions:  600, growthRate: 13, score:  7700 },
  { name: 'Lionel Messi',       type: 'persona',       mentions:  620, previousMentions:  450, growthRate: 38, score:  8500 },
];

/**
 * Normalize an entity type from backend format to frontend format.
 *
 * The trend-analyzer uses English types internally (`person`, `place`,
 * `organization`) but the UI displays them in Spanish (`persona`,
 * `lugar`, `organización`).
 */
function normalizeEntityType(rawType: string): 'persona' | 'lugar' | 'organización' {
  return BACKEND_TO_FRONTEND_TYPE[rawType] ?? 'organización';
}

export async function fetchTrends(): Promise<TrendingEntity[]> {
  const resp = await fetch(`${TRENDS_API}/api/trends`);
  if (!resp.ok) {
    throw new Error(`Failed to fetch trends: ${resp.status} ${resp.statusText}`);
  }

  // The API returns { trends: TrendingEntity[], lastUpdated: string }
  const body = (await resp.json()) as {
    trends: Array<{
      name: string;
      type: string;
      mentions: number;
      previousMentions: number;
      growthRate: number;
      score: number;
    }>;
  };

  if (!Array.isArray(body.trends) || body.trends.length === 0) {
    // No real data yet — return mock trends so the UI has something to show
    return MOCK_TRENDS;
  }

  // Normalize types from backend (person/place/organization) → frontend (persona/lugar/organización)
  return body.trends.map((t) => ({
    ...t,
    type: normalizeEntityType(t.type),
  }));
}

// ─── Political trends ────────────────────────────────────────────

export interface PoliticalFigureTrend {
  name: string;
  party: string;
  mentions24h: number;
  growthRate: number;
  avgSentiment: number;
  trendChart: number[]; // 7-day daily mention counts
}

export async function fetchPoliticalTrends(): Promise<PoliticalFigureTrend[]> {
  const resp = await fetch(`${TRENDS_API}/api/trends/political`);
  if (!resp.ok) {
    throw new Error(`Failed to fetch political trends: ${resp.status} ${resp.statusText}`);
  }
  // The API returns { figures: PoliticalFigureTrend[], count: number }
  const body = (await resp.json()) as {
    figures: PoliticalFigureTrend[];
    count: number;
  };
  return body.figures ?? [];
}

// ─── Political Events ────────────────────────────────────────────

export interface PoliticalEventEntry {
  id: string;
  title: string;
  summary: string;
  articleCount: number;
  sources: string[];
  consensus: ConsensusLevel;
  impactScore: number;
  entities: Array<{
    name: string;
    type: string;
    tier: number;
    sentiment: number;
  }>;
  province: string | null;
  publishedAt: string;
}

export async function fetchPoliticalEvents(params?: {
  figure?: string;
  sentiment_min?: number;
  limit?: number;
}): Promise<PoliticalEventEntry[]> {
  const searchParams = new URLSearchParams();
  if (params?.figure) searchParams.set('figure', params.figure);
  if (params?.sentiment_min !== undefined) {
    searchParams.set('sentiment_min', String(params.sentiment_min));
  }
  if (params?.limit) searchParams.set('limit', String(params.limit));

  const url = `${EVENT_API}/api/events/political${searchParams.toString() ? '?' + searchParams.toString() : ''}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch political events: ${resp.status} ${resp.statusText}`);
  }
  const body = (await resp.json()) as {
    events: PoliticalEventEntry[];
    count: number;
  };
  return body.events ?? [];
}

// ─── Event detail ─────────────────────────────────────────────────

export interface EventDetail extends EventItem {
  articles: Array<{
    id: string;
    title: string;
    source: string;
    publishedAt: string;
    url: string;
  }>;
}

// ─── Alert data fetch functions ───────────────────────────────────

export interface WeatherAlertResponse {
  alerts: WeatherAlert[];
  count: number;
  updatedAt: string | null;
}

export interface EarthquakeResponse {
  earthquakes: Earthquake[];
  count: number;
  updatedAt: string | null;
}

export interface FireResponse {
  fires: FireHotspot[];
  count: number;
  updatedAt: string | null;
}

export interface FlightResponse {
  flights: FlightData[];
  count: number;
  updatedAt: string | null;
}

async function fetchWeatherAlerts(): Promise<WeatherAlertResponse> {
  const resp = await fetch(`${ALERTS_API}/api/alerts/weather`);
  if (!resp.ok) throw new Error(`Weather alerts fetch failed: ${resp.status}`);
  return resp.json();
}

async function fetchEarthquakes(): Promise<EarthquakeResponse> {
  const resp = await fetch(`${ALERTS_API}/api/alerts/earthquakes`);
  if (!resp.ok) throw new Error(`Earthquakes fetch failed: ${resp.status}`);
  return resp.json();
}

async function fetchFires(): Promise<FireResponse> {
  const resp = await fetch(`${ALERTS_API}/api/alerts/fires`);
  if (!resp.ok) throw new Error(`Fires fetch failed: ${resp.status}`);
  return resp.json();
}

async function fetchFlights(): Promise<FlightResponse> {
  const resp = await fetch(`${ALERTS_API}/api/alerts/flights`);
  if (!resp.ok) throw new Error(`Flights fetch failed: ${resp.status}`);
  return resp.json();
}

// ─── Insecurity Radar API ───────────────────────────────────────────

export interface ProvinceSecurityStats {
  province: string;
  total_events_7d: number;
  total_events_30d: number;
  crime_density: number;
  trend_direction: 'up' | 'down' | 'stable';
  top_categories: Array<{ category: string; count: number }>;
}

export interface SecurityStatsResponse {
  stats: ProvinceSecurityStats[];
  count: number;
}

export async function fetchSecurityStats(params?: {
  province?: string;
  category?: string;
  period?: string;
}): Promise<SecurityStatsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.province) searchParams.set('province', params.province);
  if (params?.category) searchParams.set('category', params.category);
  if (params?.period) searchParams.set('period', params.period);

  const url = `${EVENT_API}/api/events/security${searchParams.toString() ? '?' + searchParams.toString() : ''}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch security stats: ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
}

// ─── Protest Radar API ─────────────────────────────────────────────

export type ProtestStatus = 'active' | 'dispersed' | 'resolved';
export type ProtestType =
  | 'corte_total'
  | 'corte_parcial'
  | 'marcha'
  | 'piquete'
  | 'paro'
  | 'movilizacion';

export interface ProtestItem {
  id: string;
  event_id: string;
  province: string;
  city: string | null;
  route_name: string | null;
  km: number | null;
  protest_type: ProtestType;
  status: ProtestStatus;
  lat: number;
  lng: number;
  started_at: string;
  resolved_at: string | null;
  estimated_duration_minutes: number | null;
  last_article_at: string;
  article_count: number;
}

export interface ProtestsResponse {
  protests: ProtestItem[];
  count: number;
}

export async function fetchProtests(params?: {
  status?: ProtestStatus;
  province?: string;
}): Promise<ProtestsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.province) searchParams.set('province', params.province);

  const url = `${EVENT_API}/api/events/protests${searchParams.toString() ? '?' + searchParams.toString() : ''}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch protests: ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
}
