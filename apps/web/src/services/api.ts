/**
 * API Client for ArgentinaRadar services.
 *
 * Provides typed fetch functions for:
 *   - News (ingestion service on :3001)
 *   - Geolocated news (geolocation service on :3002)
 *   - Economic data (economic service on :3006)
 */

import type { NewsItem, EconomicIndicator } from '@shared/types';

const NEWS_API = 'http://localhost:3001';
const GEO_API = 'http://localhost:3002';
const ECON_API = 'http://localhost:3006';

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
