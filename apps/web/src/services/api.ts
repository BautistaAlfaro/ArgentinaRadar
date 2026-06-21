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
export async function fetchNews(params?: {
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
export async function geolocateText(text: string): Promise<{
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
export async function fetchServiceHealth(serviceUrl: string): Promise<{
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

export async function fetchTrendingEvents(): Promise<EventItem[]> {
  const resp = await fetch(`${EVENT_API}/api/events/trending`);
  if (!resp.ok) {
    throw new Error(`Failed to fetch trending events: ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
}

// ─── Trending entities ────────────────────────────────────────────

export interface TrendingEntity {
  name: string;
  type: 'persona' | 'lugar' | 'organización';
  mentions: number;
  previousMentions: number;
  growthRate: number; // percentage, e.g. 45 or -12
  score: number;
}

export async function fetchTrends(): Promise<TrendingEntity[]> {
  const resp = await fetch(`${TRENDS_API}/api/trends`);
  if (!resp.ok) {
    throw new Error(`Failed to fetch trends: ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
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

export async function fetchWeatherAlerts(): Promise<WeatherAlertResponse> {
  const resp = await fetch(`${ALERTS_API}/api/alerts/weather`);
  if (!resp.ok) throw new Error(`Weather alerts fetch failed: ${resp.status}`);
  return resp.json();
}

export async function fetchEarthquakes(): Promise<EarthquakeResponse> {
  const resp = await fetch(`${ALERTS_API}/api/alerts/earthquakes`);
  if (!resp.ok) throw new Error(`Earthquakes fetch failed: ${resp.status}`);
  return resp.json();
}

export async function fetchFires(): Promise<FireResponse> {
  const resp = await fetch(`${ALERTS_API}/api/alerts/fires`);
  if (!resp.ok) throw new Error(`Fires fetch failed: ${resp.status}`);
  return resp.json();
}

export async function fetchFlights(): Promise<FlightResponse> {
  const resp = await fetch(`${ALERTS_API}/api/alerts/flights`);
  if (!resp.ok) throw new Error(`Flights fetch failed: ${resp.status}`);
  return resp.json();
}
