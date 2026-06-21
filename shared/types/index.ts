/** Shared TypeScript interfaces for ArgentinaRadar */

export interface Location {
  province: string;
  city: string | null;
  neighborhood: string | null;
  landmark: string | null;
  lat: number;
  lng: number;
  confidence: number; // 0.0–1.0
  label: string | null; // "Ubicación aproximada" for low confidence
}

export interface AiScore {
  publish: boolean;
  reasoning: string;
}

export type NewsStatus =
  | 'ingested'
  | 'geolocated'
  | 'filtered'
  | 'published'
  | 'discarded';

export type Category = 'politica' | 'economia' | 'sociedad' | 'deportes';

export interface NewsItem {
  id: string;
  title: string;
  summary: string; // max 500 chars
  source: string;
  sources: string[]; // dedup: multiple sources for same event
  url: string;
  category: Category;
  publishedAt: string; // ISO 8601
  ingestedAt: string;
  location: Location | null;
  aiScore: AiScore | null;
  tweetId: string | null;
  status: NewsStatus;
}

export type IndicatorType =
  | 'dolar_blue'
  | 'merval'
  | 'riesgo_pais'
  | 'reservas_bcra';

export interface EconomicIndicator {
  type: IndicatorType;
  value: number;
  source: string;
  timestamp: string;
  stale: boolean;
}

export type ServiceStatus = 'healthy' | 'degraded' | 'down';

export interface ServiceHealth {
  name: string;
  status: ServiceStatus;
  lastRun: string | null;
  uptime: number;
}
