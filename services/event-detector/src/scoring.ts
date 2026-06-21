/**
 * Event Impact Scoring.
 *
 * Calculates a 0-100 impact score for an event based on five weighted
 * dimensions:
 *   - Source count reach  (30%)
 *   - Article velocity     (25%)
 *   - Geographic reach     (15%)
 *   - Entity importance    (20%)
 *   - Trending momentum    (10%)
 */

import type { Event } from './types.js';

/** Articles per hour since the event was first detected. */
function articlesPerHour(event: Event): number {
  const first = new Date(event.firstSeen).getTime();
  const last = new Date(event.lastSeen).getTime();
  const hours = Math.max((last - first) / (1000 * 60 * 60), 1);
  return event.articleCount / hours;
}

/**
 * Highest entity tier → scalar value.
 *   Tier 1 (president, VP, cabinet) → 1.0  — national relevance
 *   Tier 2 (governor, senator)      → 0.5  — regional relevance
 *   Tier 3 (local, other)           → 0.2  — local relevance
 *   No entities                     → 0.0
 */
function topEntityImportance(event: Event): number {
  if (event.entities.length === 0) return 0;
  const bestTier = Math.min(...event.entities.map((e) => e.tier));
  if (bestTier === 1) return 1.0;
  if (bestTier === 2) return 0.5;
  return 0.2;
}

/** Count of unique provinces mentioned across the event's articles. */
function affectedProvinces(event: Event): number {
  const provinces = new Set<string>();
  for (const article of event.articles) {
    for (const entity of article.entities) {
      if (entity.type === 'place') {
        provinces.add(entity.name.toLowerCase().trim());
      }
    }
  }
  return provinces.size;
}

/**
 * Simple trending heuristic: events with impact >= 50 are considered trending.
 * A more sophisticated version would compare against the top 20% of all
 * active events — this can be added when pgvector/persistent storage lands.
 */
function isInTop20Trends(_event: Event): boolean {
  return _event.impact >= 50;
}

/**
 * Calculate a 0–100 impact score for the given event.
 *
 * Formula (same weights as spec):
 *   0.30 × sourceCountScore
 *   0.25 × velocityScore
 *   0.15 × geoReachScore
 *   0.20 × entityScore
 *   0.10 × trendingScore
 */
export function calculateImpact(event: Event): number {
  const sourceCountScore = Math.min(event.sources.length, 10) / 10 * 100;
  const velocityScore = Math.min(articlesPerHour(event), 10) / 10 * 100;
  const geoReachScore = Math.min(affectedProvinces(event), 5) / 5 * 100;
  const entityScore = topEntityImportance(event) * 100;
  const trendingScore = isInTop20Trends(event) ? 100 : 0;

  return Math.round(
    0.30 * sourceCountScore +
    0.25 * velocityScore +
    0.15 * geoReachScore +
    0.20 * entityScore +
    0.10 * trendingScore,
  );
}
