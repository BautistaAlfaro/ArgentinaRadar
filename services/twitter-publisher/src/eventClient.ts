/**
 * Event Detector HTTP client.
 *
 * Fetches trending events from the event-detector service (port 3008)
 * and returns those with impact score >= 50 for Twitter publishing.
 */

import axios from 'axios';
import { config } from './config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MediaConsensus = 'high' | 'medium' | 'low';

export interface TrendingEvent {
  id: string;
  title: string;
  summary: string;
  category: string;
  sources: string[];
  articleCount: number;
  impact: number;
  consensus: MediaConsensus;
  firstSeen: string;
  lastSeen: string;
  createdAt: string;
}

interface TrendingResponse {
  events: TrendingEvent[];
  count: number;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * Fetch trending events from the event-detector service.
 *
 * @returns Events with impact score >= 50 (high-impact).
 * @throws If the event-detector is unreachable or returns an error.
 */
export async function fetchTrendingEvents(): Promise<TrendingEvent[]> {
  const url = `${config.eventDetector.url}/api/events/trending`;

  const resp = await axios.get<TrendingResponse>(url, {
    timeout: 10_000,
  });

  // Server returns { events: TrendingEvent[], count: number }
  const all = resp.data.events ?? [];

  // Only very high-impact events auto-publish directly (>= 70).
  // Events with impact 50–69 are routed through the Telegram approval workflow
  // (handled by hermes-bridge's approval loop).
  return all.filter((e) => e.impact >= 70);
}
