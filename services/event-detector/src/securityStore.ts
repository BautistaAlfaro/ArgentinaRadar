/**
 * Security Stats Store — In-memory aggregate for province-level security data.
 *
 * Provides:
 *   - Province-level crime event aggregation
 *   - Crime density calculation (per 100k population)
 *   - Trend detection (7d vs 30d)
 *   - Top categories per province
 */

import type { Event } from './types.js';

// ── Province population data (INDEC 2022 census projections) ─────
const PROVINCE_POPULATIONS: Record<string, number> = {
  'Buenos Aires': 17541141,
  'CABA': 3121707,
  'Catamarca': 429562,
  'Chaco': 1204541,
  'Chubut': 618994,
  'Córdoba': 3764570,
  'Corrientes': 1203367,
  'Entre Ríos': 1427578,
  'Formosa': 615914,
  'Jujuy': 811611,
  'La Pampa': 366688,
  'La Rioja': 393531,
  'Mendoza': 2014533,
  'Misiones': 1278466,
  'Neuquén': 726590,
  'Río Negro': 759579,
  'Salta': 1441351,
  'San Juan': 822294,
  'San Luis': 541101,
  'Santa Cruz': 337226,
  'Santa Fe': 3556522,
  'Santiago del Estero': 987217,
  'Tierra del Fuego': 190641,
  'Tucumán': 1707186,
};

// ── Security-relevant categories ──────────────────────────────────
const SECURITY_CATEGORIES = new Set([
  'seguridad', 'robo', 'homicidio', 'narcotrafico',
  'corrupcion', 'secuestro', 'estafa', 'violencia_genero',
]);

interface ProvinceSecurityData {
  total_events_7d: number;
  total_events_30d: number;
  top_categories: Array<{ category: string; count: number }>;
}

class SecurityStatsStore {
  /**
   * Compute security stats for a given province.
   * If province is 'all', aggregate across all provinces.
   */
  getProvinceSecurity(
    events: Event[],
    province?: string,
    categoryFilter?: string,
    period?: string,
  ): {
    province: string;
    total_events_7d: number;
    total_events_30d: number;
    crime_density: number;
    trend_direction: string;
    top_categories: Array<{ category: string; count: number }>;
  }[] {
    const now = Date.now();
    const MS_7D = 7 * 24 * 60 * 60 * 1000;
    const MS_30D = 30 * 24 * 60 * 60 * 1000;

    // Filter to security events with location data
    const securityEvents = events.filter((e) => {
      const isSecurity = SECURITY_CATEGORIES.has(e.category) ||
        e.category.toLowerCase().includes('segur') ||
        e.category.toLowerCase().includes('robo') ||
        e.category.toLowerCase().includes('homic');

      if (!isSecurity || !e.location) return false;
      if (categoryFilter && e.category !== categoryFilter) return false;

      return true;
    });

    // Group by province
    const byProvince = new Map<string, Event[]>();

    for (const event of securityEvents) {
      const loc = event.location as { province?: string } | null;
      const p = loc?.province || 'Desconocida';
      if (province && p !== province) continue;

      if (!byProvince.has(p)) byProvince.set(p, []);
      byProvince.get(p)!.push(event);
    }

    const results: ReturnType<SecurityStatsStore['getProvinceSecurity']> = [];

    for (const [prov, provEvents] of byProvince) {
      const total7d = provEvents.filter(
        (e) => now - new Date(e.firstSeen).getTime() < MS_7D,
      ).length;
      const total30d = provEvents.filter(
        (e) => now - new Date(e.firstSeen).getTime() < MS_30D,
      ).length;

      // Top categories
      const catCount = new Map<string, number>();
      for (const e of provEvents) {
        catCount.set(e.category, (catCount.get(e.category) || 0) + 1);
      }
      const topCategories = [...catCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([category, count]) => ({ category, count }));

      // Crime density per 100k population
      const population = PROVINCE_POPULATIONS[prov] || 100000;
      const crime_density = Math.round((total30d / population) * 100000 * 100) / 100;

      const MS_14D = 14 * 24 * 60 * 60 * 1000;

      // Trend direction
      const events7dCount = total7d;
      const eventsPrevious7d = provEvents.filter(
        (e) => {
          const t = now - new Date(e.firstSeen).getTime();
          return t >= MS_7D && t < MS_14D;
        },
      ).length;

      let trend_direction = 'stable';
      if (events7dCount > eventsPrevious7d * 1.2) {
        trend_direction = 'up';
      } else if (events7dCount < eventsPrevious7d * 0.8) {
        trend_direction = 'down';
      }

      results.push({
        province: prov,
        total_events_7d: total7d,
        total_events_30d: total30d,
        crime_density,
        trend_direction,
        top_categories: topCategories,
      });
    }

    // Sort by total_events_30d descending
    results.sort((a, b) => b.total_events_30d - a.total_events_30d);
    return results;
  }
}

export const securityStatsStore = new SecurityStatsStore();
