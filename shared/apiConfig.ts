/**
 * Centralized API configuration for ArgentinaRadar.
 *
 * All service URLs are defined here. Import this file in any frontend
 * or ESM service file to avoid hardcoded `http://localhost` URLs.
 *
 * Usage:
 *   import { API } from '@shared/apiConfig';
 *   const resp = await fetch(`${API.news}/api/news`);
 */

// Vite replaces import.meta.env at build time. For Node ESM services
// without Vite, fall back to process.env or the default localhost.
function resolveBase(): string {
  const meta = import.meta as any;
  if (meta && meta.env?.VITE_API_BASE_URL) {
    return meta.env.VITE_API_BASE_URL as string;
  }
  const g = globalThis as any;
  if (typeof g.process !== 'undefined' && g.process.env?.VITE_API_BASE_URL) {
    return g.process.env.VITE_API_BASE_URL;
  }
  return 'http://localhost';
}

const BASE = resolveBase();

export const API = {
  /** News ingestion service — RSS fetch, pipeline, quality stats, logs */
  news: `${BASE}:3001`,
  /** Geolocation service — reverse geocoding, province detection */
  geo: `${BASE}:3002`,
  /** AI Processor — NER, classification, embeddings, translation */
  ai: `${BASE}:3013`,
  /** Twitter/Bluesky publisher — post text & images to social media */
  publisher: `${BASE}:3004`,
  /** Hermes bridge — Telegram bot backend */
  hermes: `${BASE}:3005`,
  /** Economic data — indicators, exchange rates, market data */
  econ: `${BASE}:3006`,
  /** Alerts service — weather, earthquakes, fires, flights */
  alerts: `${BASE}:3007`,
  /** Event detector — protest tracking, event management */
  events: `${BASE}:3008`,
  /** Trend analyzer — trending topics, entity tracking */
  trends: `${BASE}:3009`,
  /** Auth service — JWT authentication */
  auth: `${BASE}:3010`,
  /** Night owl — nightly batch processing, digest, briefing */
  nightOwl: `${BASE}:3011`,
  /** Admin backend — system management, PM2 control, KPIs */
  admin: `${BASE}:3012`,
} as const;

export type ApiService = keyof typeof API;
