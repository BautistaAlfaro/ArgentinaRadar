/**
 * Entity Tracker
 *
 * Tracks entity mentions over time in an in-memory store.
 * Each mention records the entity name, type, timestamp, article ID and source.
 */

import { CURRENT_WINDOW_MS, PREVIOUS_WINDOW_MS } from './config.js';

export interface EntityMention {
  name: string;
  type: 'person' | 'place' | 'organization';
  timestamp: Date;
  articleId: string;
  source: string;
}

export class EntityTracker {
  private mentions: EntityMention[] = [];

  /** Add a new mention to the tracker */
  addMention(mention: EntityMention): void {
    this.mentions.push(mention);
  }

  /** Return mentions whose timestamp is within the last 24 hours */
  getMentionsInLast24h(): EntityMention[] {
    const cutoff = Date.now() - CURRENT_WINDOW_MS;
    return this.mentions.filter((m) => m.timestamp.getTime() >= cutoff);
  }

  /** Return mentions whose timestamp falls in the 24h window before the current one */
  getMentionsInPrevious24h(): EntityMention[] {
    const now = Date.now();
    const upper = now - CURRENT_WINDOW_MS;
    const lower = now - PREVIOUS_WINDOW_MS;
    return this.mentions.filter((m) => m.timestamp.getTime() >= lower && m.timestamp.getTime() < upper);
  }

  /** Count mentions grouped by entity name */
  countByEntity(mentions: EntityMention[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const m of mentions) {
      counts.set(m.name, (counts.get(m.name) ?? 0) + 1);
    }
    return counts;
  }

  /** Return a copy of all mentions (for inspection / debugging) */
  getAllMentions(): EntityMention[] {
    return [...this.mentions];
  }

  /** Return entity details from all mentions matching a name */
  getEntityDetail(name: string): { totalMentions: number; mentions: EntityMention[] } {
    const matches = this.mentions.filter((m) => m.name.toLowerCase() === name.toLowerCase());
    return { totalMentions: matches.length, mentions: matches };
  }
}
