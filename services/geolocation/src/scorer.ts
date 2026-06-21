/**
 * Confidence scoring engine for location extraction.
 *
 * Scores are based on match type:
 *   - Landmark match:  0.95
 *   - City match:      0.80
 *   - Province match:  0.50
 *   - No match:        0.00
 *
 * Scores < 0.5 fall back to province centroid.
 */

import type { MatchResult } from './matcher.js';

/**
 * Calculate confidence for a match result.
 *
 * @param match — The match result from the gazetteer matcher
 * @returns A confidence score from 0.0 to 1.0
 */
export function scoreMatch(match: MatchResult): number {
  switch (match.matchType) {
    case 'landmark':
      return 0.95;
    case 'city':
      return 0.80;
    case 'province':
      return 0.50;
    case 'none':
    default:
      return 0.0;
  }
}

/**
 * Determine if a confidence score merits a fallback to province-level.
 * Scores < 0.5 should fall back to province centroid.
 */
export function shouldFallbackToProvince(confidence: number): boolean {
  return confidence < 0.5;
}
