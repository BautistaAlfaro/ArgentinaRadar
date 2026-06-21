/**
 * Night Owl — Pattern Detection Job
 *
 * Scheduled: 03:00 ART
 *
 * Detects cyclical patterns in events by analysing entity appearances
 * over the last 30 days.  Three pattern types are emitted:
 *   - "weekly"     – entity appears on a consistent day of week
 *   - "contextual" – two entities co-occur above threshold
 *   - "temporal"   – event activity spikes in a specific time window
 *
 * Patterns are persisted to PostgreSQL via the `Pattern` Prisma model.
 * Anomalies (entity appearing outside its usual time) are recorded in
 * the pattern metadata.
 */

import type { JobFn } from './index.js';
import { prisma } from '@argentinaradar/database';
import type { Prisma } from '@prisma/client';
import { config } from '../config.js';

// ── Types ────────────────────────────────────────────────────────────

interface RawEntity {
  name: string;
  type: string;
  tier: number;
}

interface EventItem {
  id: string;
  title: string;
  category: string;
  createdAt: string;
  firstSeen: string;
  entities: RawEntity[];
}

interface EventsApiResponse {
  events: EventItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface EntityAppearance {
  entityName: string;
  entityType: string;
  eventId: string;
  eventTitle: string;
  category: string;
  date: Date;
  dayOfWeek: number; // 0=Sun … 6=Sat
  hour: number;      // 0-23
}

// ── Helpers ──────────────────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Fetch ALL events from the event-detector (handles pagination). */
async function fetchAllEvents(): Promise<EventItem[]> {
  const all: EventItem[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const url = `${config.eventDetectorUrl}/api/events?page=${page}&limit=100`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Event-detector returned ${res.status} for page ${page}`);
    }
    const body = (await res.json()) as EventsApiResponse;
    all.push(...body.events);
    totalPages = body.pagination.totalPages;
    page++;
  }

  return all;
}

/** Build appearances list from raw events, filtering to last N days. */
function buildAppearances(events: EventItem[], days: number): EntityAppearance[] {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const appearances: EntityAppearance[] = [];

  for (const event of events) {
    const eventDate = new Date(event.createdAt);
    if (eventDate < cutoff) continue;

    for (const entity of event.entities) {
      appearances.push({
        entityName: entity.name,
        entityType: entity.type,
        eventId: event.id,
        eventTitle: event.title,
        category: event.category,
        date: eventDate,
        dayOfWeek: eventDate.getUTCDay(),
        hour: eventDate.getUTCHours(),
      });
    }
  }

  return appearances;
}

/** Cosine similarity between two number arrays. */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Group appearances by a key extractor. */
function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return map;
}

/** Count value frequencies in an array. */
function frequencies<T>(items: T[]): Map<T, number> {
  const map = new Map<T, number>();
  for (const item of items) {
    map.set(item, (map.get(item) ?? 0) + 1);
  }
  return map;
}

/** Human-friendly hour range label. */
function hourBucketLabel(hour: number): string {
  const start = hour;
  const end = (hour + 4) % 24;
  return `${start.toString().padStart(2, '0')}:00-${end.toString().padStart(2, '0')}:00`;
}

// ── Pattern detectors ────────────────────────────────────────────────

interface PatternCandidate {
  type: string;
  entityName: string;
  description: string;
  confidence: number;
  metadata: Record<string, unknown>;
}

/** Detect weekly patterns: entity appears on a consistent day of week. */
function detectWeeklyPatterns(
  appearances: EntityAppearance[],
  minSamples: number,
): PatternCandidate[] {
  const byEntity = groupBy(appearances, (a) => a.entityName);
  const patterns: PatternCandidate[] = [];

  for (const [entityName, slots] of byEntity) {
    // Calculate ENTROPY of day-of-week distribution
    if (slots.length < minSamples) continue;

    const dowFreq = frequencies(slots.map((s) => s.dayOfWeek));
    const maxCount = Math.max(...dowFreq.values());
    const dominantDow = [...dowFreq.entries()].find(([, c]) => c === maxCount)![0];

    const confidence = maxCount / slots.length;

    // Only emit if signal is meaningful (confidence >= 0.35 AND at least 2
    // occurrences on the dominant day — otherwise it's likely noise).
    if (confidence >= 0.35 && maxCount >= 2) {
      const anomalies = slots
        .filter((s) => s.dayOfWeek !== dominantDow)
        .map((s) => ({
          date: s.date.toISOString().slice(0, 10),
          dayOfWeek: DAY_NAMES[s.dayOfWeek],
          eventId: s.eventId,
          eventTitle: s.eventTitle,
        }));

      // Entropy filter: if the distribution is too uniform, skip it.
      // "Too uniform" = the dominant day has < 2× the runner-up.
      const sortedCounts = [...dowFreq.values()].sort((a, b) => b - a);
      if (sortedCounts.length >= 2 && sortedCounts[0] < sortedCounts[1] * 1.8) {
        continue;
      }

      patterns.push({
        type: 'weekly',
        entityName,
        description: `${entityName} appears predominantly on ${DAY_NAMES[dominantDow]}s ` +
          `(${(confidence * 100).toFixed(0)}% of ${slots.length} appearances)`,
        confidence,
        metadata: {
          dominantDayOfWeek: dominantDow,
          dayName: DAY_NAMES[dominantDow],
          totalAppearances: slots.length,
          dominantDayCount: maxCount,
          anomalies,
        },
      });
    }
  }

  return patterns;
}

/** Detect temporal patterns: activity spikes in a specific 4-hour window. */
function detectTemporalPatterns(
  appearances: EntityAppearance[],
  minSamples: number,
): PatternCandidate[] {
  const byEntity = groupBy(appearances, (a) => a.entityName);
  const patterns: PatternCandidate[] = [];

  for (const [entityName, slots] of byEntity) {
    if (slots.length < minSamples) continue;

    // Bucket hours into 4-hour windows: [0,4), [4,8), [8,12), …
    const bucketFn = (h: number) => Math.floor(h / 4) * 4;
    const bucketCounts = new Map<number, number>();
    for (const s of slots) {
      const b = bucketFn(s.hour);
      bucketCounts.set(b, (bucketCounts.get(b) ?? 0) + 1);
    }

    const maxCount = Math.max(...bucketCounts.values());
    const dominantBucket = [...bucketCounts.entries()].find(([, c]) => c === maxCount)![0];
    const confidence = maxCount / slots.length;

    if (confidence >= 0.4 && maxCount >= 2) {
      patterns.push({
        type: 'temporal',
        entityName,
        description: `${entityName} activity peaks in the ${hourBucketLabel(dominantBucket)} window ` +
          `(${(confidence * 100).toFixed(0)}% of ${slots.length} appearances)`,
        confidence,
        metadata: {
          dominantHourBucket: dominantBucket,
          bucketLabel: hourBucketLabel(dominantBucket),
          totalAppearances: slots.length,
          dominantBucketCount: maxCount,
        },
      });
    }
  }

  return patterns;
}

/** Detect contextual patterns: two entities co-occur above threshold. */
function detectContextualPatterns(
  events: EventItem[],
  minSamples: number,
): PatternCandidate[] {
  // Build entity → set of event IDs
  const entityEvents = new Map<string, Set<string>>();
  for (const event of events) {
    for (const entity of event.entities) {
      if (!entityEvents.has(entity.name)) {
        entityEvents.set(entity.name, new Set());
      }
      entityEvents.get(entity.name)!.add(event.id);
    }
  }

  const entityNames = [...entityEvents.keys()];
  const patterns: PatternCandidate[] = [];

  for (let i = 0; i < entityNames.length; i++) {
    for (let j = i + 1; j < entityNames.length; j++) {
      const a = entityNames[i];
      const b = entityNames[j];
      const eventsA = entityEvents.get(a)!;
      const eventsB = entityEvents.get(b)!;

      const intersection = new Set([...eventsA].filter((id) => eventsB.has(id)));
      const coOccurrences = intersection.size;
      const minTotal = Math.min(eventsA.size, eventsB.size);

      if (minTotal < minSamples) continue;

      const confidence = coOccurrences / minTotal;

      if (confidence >= 0.55 && coOccurrences >= 2) {
        patterns.push({
          type: 'contextual',
          entityName: a,
          description: `${a} appears with ${b} in ${coOccurrences} of ${minTotal} events ` +
            `(${(confidence * 100).toFixed(0)}% co-occurrence)`,
          confidence,
          metadata: {
            coEntityName: b,
            coOccurrences,
            entityAEventCount: eventsA.size,
            entityBEventCount: eventsB.size,
          },
        });

        // Also emit the symmetric pattern (b → a) for discoverability
        patterns.push({
          type: 'contextual',
          entityName: b,
          description: `${b} appears with ${a} in ${coOccurrences} of ${minTotal} events ` +
            `(${(confidence * 100).toFixed(0)}% co-occurrence)`,
          confidence,
          metadata: {
            coEntityName: a,
            coOccurrences,
            entityAEventCount: eventsB.size,
            entityBEventCount: eventsA.size,
          },
        });
      }
    }
  }

  return patterns;
}

// ── Main job ─────────────────────────────────────────────────────────

export const runPattern: JobFn = async (_data) => {
  console.log('[Job:pattern] Starting — pattern detector');

  // 1 — Fetch events from event-detector
  console.log('[Job:pattern] Fetching events from event-detector...');
  const allEvents = await fetchAllEvents();
  console.log(`[Job:pattern] Fetched ${allEvents.length} events total`);

  if (allEvents.length === 0) {
    console.log('[Job:pattern] No events found — nothing to analyse');
    return;
  }

  // 2 — Build appearances (last 30 days)
  const appearances = buildAppearances(allEvents, 30);
  const recentEventCount = new Set(appearances.map((a) => a.eventId)).size;
  console.log(`[Job:pattern] ${appearances.length} entity appearances across ${recentEventCount} events (30d)`);

  if (appearances.length < config.minEventsForPattern) {
    console.log('[Job:pattern] Too few appearances for meaningful analysis');
    return;
  }

  // 3 — Detect patterns
  const minSamples = config.minEventsForPattern;
  const weeklyPatterns = detectWeeklyPatterns(appearances, minSamples);
  const temporalPatterns = detectTemporalPatterns(appearances, minSamples);
  const contextualPatterns = detectContextualPatterns(allEvents, minSamples);

  const allPatterns = [...weeklyPatterns, ...temporalPatterns, ...contextualPatterns];
  console.log(`[Job:pattern] Detected ${allPatterns.length} patterns ` +
    `(weekly=${weeklyPatterns.length}, temporal=${temporalPatterns.length}, ` +
    `contextual=${contextualPatterns.length})`);

  if (allPatterns.length === 0) {
    console.log('[Job:pattern] No patterns detected');
    return;
  }

  // 4 — Persist to DB
  console.log('[Job:pattern] Persisting patterns to database...');
  let stored = 0;
  for (const p of allPatterns) {
    await prisma.pattern.create({
      data: {
        type: p.type,
        entityName: p.entityName,
        description: p.description,
        confidence: p.confidence,
        metadata: p.metadata as Prisma.InputJsonValue,
      },
    });
    stored++;
  }
  console.log(`[Job:pattern] Stored ${stored} patterns`);

  // 5 — Log anomalies
  let anomalyCount = 0;
  for (const p of weeklyPatterns) {
    const anomalies = (p.metadata.anomalies as Array<Record<string, unknown>>) ?? [];
    if (anomalies.length > 0) {
      anomalyCount += anomalies.length;
      for (const a of anomalies) {
        console.log(`[Job:pattern] ⚠ Anomaly: "${p.entityName}" appeared on ${a.dayOfWeek} ` +
          `(${a.date as string}) — expected ${p.metadata.dayName as string}`);
      }
    }
  }
  console.log(`[Job:pattern] Done — ${stored} patterns stored, ${anomalyCount} anomalies logged`);
};
