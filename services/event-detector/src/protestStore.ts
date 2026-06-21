/**
 * Protest Store — In-memory tracking of active protests and cortes.
 *
 * Features:
 *   - Track protest lifecycle (active → dispersed → resolved)
 *   - Auto-resolve protests with no new articles in 6 hours
 *   - Update protest data when a new article covers the same protest
 *   - Lookup by route + km or location approximation
 */

import crypto from 'node:crypto';
import type { Event } from './types.js';

export type ProtestStatus = 'active' | 'dispersed' | 'resolved';
export type ProtestType =
  | 'corte_total'
  | 'corte_parcial'
  | 'marcha'
  | 'piquete'
  | 'paro'
  | 'movilizacion';

export interface ActiveProtest {
  id: string;
  event_id: string;
  province: string;
  city: string | null;
  route_name: string | null;
  km: number | null;
  protest_type: ProtestType;
  status: ProtestStatus;
  lat: number;
  lng: number;
  started_at: string;
  resolved_at: string | null;
  estimated_duration_minutes: number | null;
  last_article_at: string;
  article_count: number;
}

// ── Type mapping for visual styling ──────────────────────────────
export const PROTEST_TYPE_COLORS: Record<ProtestType, string> = {
  corte_total: '#ef4444',    // red
  corte_parcial: '#f97316',  // orange
  marcha: '#eab308',         // yellow
  piquete: '#3b82f6',        // blue
  paro: '#8b5cf6',           // purple
  movilizacion: '#14b8a6',   // teal
};

const AUTO_RESOLVE_HOURS = 6;

class ProtestStore {
  private protests = new Map<string, ActiveProtest>();
  private routeKmIndex = new Map<string, string>(); // "route|km" → protestId

  /** Get all protests, optionally filtered by status and/or province. */
  getProtests(options: {
    status?: ProtestStatus;
    province?: string;
  }): ActiveProtest[] {
    this.autoResolve();

    let results = Array.from(this.protests.values());

    if (options.status) {
      results = results.filter((p) => p.status === options.status);
    }
    if (options.province) {
      results = results.filter((p) => p.province === options.province);
    }

    // Sort by started_at descending (most recent first)
    results.sort(
      (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
    );

    return results;
  }

  /** Get a single protest by ID. */
  getProtest(id: string): ActiveProtest | undefined {
    this.autoResolve();
    return this.protests.get(id);
  }

  /**
   * Register or update a protest from an event.
   * Matches by route + km if available, otherwise by province + proximity.
   */
  registerProtestFromEvent(
    event: Event,
    classification: {
      protest_type: ProtestType;
      route?: string | null;
      km?: number | null;
      location?: string | null;
      estimated_duration_minutes?: number | null;
    },
  ): ActiveProtest {
    const loc = event.location as { lat?: number; lng?: number; province?: string; city?: string } | null;
    const province = loc?.province || 'Desconocida';
    const city = loc?.city || classification.location || null;
    const lat = loc?.lat || -34.6;
    const lng = loc?.lng || -58.4;

    // Try to match by route + km
    const routeKey = classification.route && classification.km != null
      ? `${classification.route}|${classification.km}`
      : null;

    let existingId: string | undefined;

    if (routeKey) {
      existingId = this.routeKmIndex.get(routeKey);
    }

    // Also try matching by event_id
    const byEventId = Array.from(this.protests.values()).find(
      (p) => p.event_id === event.id,
    );
    if (byEventId) {
      existingId = byEventId.id;
    }

    if (existingId && this.protests.has(existingId)) {
      // Update existing protest
      const existing = this.protests.get(existingId)!;
      existing.protest_type = classification.protest_type;
      existing.city = city || existing.city;
      existing.route_name = classification.route || existing.route_name;
      existing.km = classification.km ?? existing.km;
      existing.estimated_duration_minutes =
        classification.estimated_duration_minutes ?? existing.estimated_duration_minutes;
      existing.last_article_at = new Date().toISOString();
      existing.article_count += 1;
      existing.status = 'active';
      existing.resolved_at = null;
      return existing;
    }

    // Create new protest
    const now = new Date().toISOString();
    const protest: ActiveProtest = {
      id: crypto.randomUUID(),
      event_id: event.id,
      province,
      city,
      route_name: classification.route || null,
      km: classification.km ?? null,
      protest_type: classification.protest_type,
      status: 'active',
      lat,
      lng,
      started_at: event.firstSeen || now,
      resolved_at: null,
      estimated_duration_minutes: classification.estimated_duration_minutes ?? null,
      last_article_at: now,
      article_count: 1,
    };

    this.protests.set(protest.id, protest);

    if (routeKey) {
      this.routeKmIndex.set(routeKey, protest.id);
    }

    return protest;
  }

  /** Manually resolve a protest. */
  resolveProtest(id: string): boolean {
    const protest = this.protests.get(id);
    if (!protest) return false;
    protest.status = 'resolved';
    protest.resolved_at = new Date().toISOString();
    return true;
  }

  /** Mark a protest as dispersed (people left but not formally resolved). */
  disperseProtest(id: string): boolean {
    const protest = this.protests.get(id);
    if (!protest) return false;
    protest.status = 'dispersed';
    return true;
  }

  /**
   * Auto-resolve protests that haven't had a new article in 6 hours.
   * Called before every read operation.
   */
  private autoResolve(): void {
    const cutoff = Date.now() - AUTO_RESOLVE_HOURS * 60 * 60 * 1000;

    for (const protest of this.protests.values()) {
      if (
        protest.status === 'active' &&
        new Date(protest.last_article_at).getTime() < cutoff
      ) {
        protest.status = 'resolved';
        protest.resolved_at = new Date().toISOString();
      }
    }
  }
}

export const protestStore = new ProtestStore();
