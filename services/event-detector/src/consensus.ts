/**
 * Media Consensus calculator.
 *
 * Determines how many unique news sources are covering the same event.
 * This is a proxy for event reliability and visibility.
 *
 *   🟢 high   — 5+ unique sources → widespread coverage
 *   🟡 medium — 3-4 unique sources → moderate coverage
 *   🔴 low    — 1-2 unique sources → isolated coverage
 */

import type { Event, MediaConsensus } from './types.js';

export function calculateConsensus(event: Event): MediaConsensus {
  const uniqueSources = event.sources.length;

  if (uniqueSources >= 5) return 'high';
  if (uniqueSources >= 3) return 'medium';
  return 'low';
}
