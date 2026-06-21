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
  political?: number;
  economic?: number;
  social?: number;
  urgency?: number;
  quality?: number;
  relevance?: number;
  combined?: number;
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
  // Quality scoring (v2)
  qualityScore?: number;
  engagementScore?: number;
  relevanceScore?: number;
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

// ─── Alert types for map layers (PR 7) ─────────────────────────────

export type AlertSeverity = 'yellow' | 'orange' | 'red';

export interface WeatherAlert {
  province: string;
  severity: AlertSeverity;
  event: string;
  description: string;
  coordinates: number[][][]; // polygon rings
  updatedAt: string;
}

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

export interface FireHotspot {
  lat: number;
  lng: number;
  brightness: number;
  confidence: string;
  updatedAt: string;
}

export interface FlightData {
  callsign: string;
  lat: number;
  lng: number;
  altitude: number;
  velocity: number;
  onGround: boolean;
  updatedAt: string;
}

export interface InfrastructureFeature {
  type: FeatureType;
  name: string;
  description: string;
  coordinates: number[] | number[][];
}

export type FeatureType = 'gasoducto' | 'puerto' | 'represa';
