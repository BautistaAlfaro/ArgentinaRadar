/**
 * Trending Algorithm
 *
 * Compares mention counts in the current 24h window against the previous 24h
 * window to compute growth rate and a combined trending score.
 *
 * Growth rate for new entities (no previous mentions): 1.0 (100% growth).
 * Score formula: mentions × max(growthRate, 0.1)
 * Returns the top 10 trending entities sorted by score descending.
 */

import type { EntityTracker } from './tracker.js';

export interface TrendingEntity {
  name: string;
  type: string;
  mentions: number;
  previousMentions: number;
  growthRate: number;
  score: number;
}

/**
 * Compute trending entities from the tracker.
 *
 * @param tracker — EntityTracker instance with accumulated mentions
 * @returns Top 10 trending entities sorted by score descending
 */
export function calculateTrends(tracker: EntityTracker): TrendingEntity[] {
  const current = tracker.countByEntity(tracker.getMentionsInLast24h());
  const previous = tracker.countByEntity(tracker.getMentionsInPrevious24h());

  // Build a lookup to resolve an entity's type from its most recent mention
  const allMentions = tracker.getAllMentions();
  const typeByEntity = new Map<string, string>();
  // Walk backwards so the most recent mention sets the type
  for (let i = allMentions.length - 1; i >= 0; i--) {
    const m = allMentions[i];
    if (!typeByEntity.has(m.name)) {
      typeByEntity.set(m.name, m.type);
    }
  }

  const trends: TrendingEntity[] = [];

  for (const [name, count] of current) {
    const prevCount = previous.get(name) ?? 0;
    const growthRate = prevCount > 0 ? (count - prevCount) / prevCount : 1.0;
    const score = count * Math.max(growthRate, 0.1);

    trends.push({
      name,
      type: typeByEntity.get(name) ?? 'unknown',
      mentions: count,
      previousMentions: prevCount,
      growthRate,
      score,
    });
  }

  // Sort by score descending, return top 10
  return trends.sort((a, b) => b.score - a.score).slice(0, 10);
}
