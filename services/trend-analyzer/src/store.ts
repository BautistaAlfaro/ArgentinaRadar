/**
 * In-memory Trend Store
 *
 * Holds:
 *  - The current top-10 trending entities
 *  - Timestamp of the last trend calculation
 *  - A sliding window of historical trend snapshots (last 7 days)
 */

import type { TrendingEntity } from './trending.js';

const MAX_HISTORY_SNAPSHOTS = 7 * 24; // up to one snapshot per hour for 7 days

export interface TrendSnapshot {
  timestamp: Date;
  trends: TrendingEntity[];
}

export class TrendStore {
  private current: TrendingEntity[] = [];
  private lastUpdated: Date | null = null;
  private history: TrendSnapshot[] = [];

  /** Replace the current top-10 trends */
  setCurrent(trends: TrendingEntity[]): void {
    this.current = trends;
    this.lastUpdated = new Date();

    this.history.push({ timestamp: new Date(), trends: [...trends] });
    if (this.history.length > MAX_HISTORY_SNAPSHOTS) {
      this.history.shift();
    }
  }

  /** Get the current top-10 trending entities */
  getCurrent(): TrendingEntity[] {
    return this.current;
  }

  /** When were the trends last recalculated */
  getLastUpdated(): Date | null {
    return this.lastUpdated;
  }

  /** Return all historical snapshots */
  getHistory(): TrendSnapshot[] {
    return this.history;
  }
}
