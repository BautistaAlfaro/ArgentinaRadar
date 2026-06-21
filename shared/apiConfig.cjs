/**
 * CommonJS version of the centralized API configuration.
 *
 * Usage:
 *   const { API } = require('../../shared/apiConfig.cjs');
 *   const resp = await fetch(`${API.news}/api/news`);
 */

const BASE = process.env.VITE_API_BASE_URL || 'http://localhost';

const API = {
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
};

module.exports = { API };
