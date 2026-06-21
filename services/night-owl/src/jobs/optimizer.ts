/**
 * Night Owl — Embedding Optimizer Job
 *
 * Scheduled: 03:30 ART
 *
 * Deduplicates events whose article embeddings have cosine similarity
 * above the merge threshold (default ≥ 0.95).  For each group of near-
 * identical events the one with the highest impact is kept; articles
 * from lower-impact duplicates are reassigned to the kept event via the
 * event-detector's /api/detect endpoint.
 *
 * Idempotent: articles already present in the target event are skipped,
 * so running multiple times with the same input produces the same state.
 */

import type { JobFn } from './index.js';
import { config } from '../config.js';

// ── Types ────────────────────────────────────────────────────────────

interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  category: string;
  publishedAt: string;
  ingestedAt: string;
  embedding: number[];
}

interface EventDetail {
  id: string;
  title: string;
  summary: string;
  category: string;
  impact: number;
  articles: NewsArticle[];
  createdAt: string;
}

interface EventDetailResponse {
  event: EventDetail;
}

interface DetectResponse {
  eventId: string;
  matchType: string;
  confidence: number;
  event: EventDetail;
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Cosine similarity between two vectors. */
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

/** Compute the centroid (average) embedding for a list of articles. */
function averageEmbedding(articles: NewsArticle[]): number[] {
  if (articles.length === 0) return [];
  const dim = articles[0].embedding.length;
  const sum = new Array(dim).fill(0);
  let validCount = 0;
  for (const a of articles) {
    if (!a.embedding || a.embedding.length === 0) continue;
    for (let i = 0; i < dim; i++) sum[i] += a.embedding[i];
    validCount++;
  }
  if (validCount === 0) return [];
  for (let i = 0; i < dim; i++) sum[i] /= validCount;
  return sum;
}

/** Fetch ALL events with their full article data (handles pagination). */
async function fetchAllEvents(): Promise<EventDetail[]> {
  const all: EventDetail[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const url = `${config.eventDetectorUrl}/api/events?page=${page}&limit=100`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Event-detector returned ${res.status} for page ${page}`);
    const body = await res.json() as {
      events: EventDetail[];
      pagination: { page: number; limit: number; total: number; totalPages: number };
    };
    all.push(...body.events);
    totalPages = body.pagination.totalPages;
    page++;
  }

  return all;
}

/** Fetch a single event with full details. */
async function fetchEvent(eventId: string): Promise<EventDetail> {
  const url = `${config.eventDetectorUrl}/api/events/${eventId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch event ${eventId}: ${res.status}`);
  const body = await res.json() as EventDetailResponse;
  return body.event;
}

/** POST an article to /api/detect and return the matched event. */
async function postArticleToDetect(article: NewsArticle): Promise<EventDetail> {
  const url = `${config.eventDetectorUrl}/api/detect`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: article.title,
      summary: article.summary,
      source: article.source,
      url: article.url,
      category: article.category,
      publishedAt: article.publishedAt,
      embedding: article.embedding,
    }),
  });
  if (!res.ok) throw new Error(`/api/detect returned ${res.status} for article "${article.title}"`);
  const body = await res.json() as DetectResponse;
  return body.event;
}

// ── Merge logic ──────────────────────────────────────────────────────

interface MergeGroup {
  keepEventId: string;
  mergedEventIds: string[];
  reassignedArticles: NewsArticle[];
}

/**
 * Build merge groups using union-find on the event similarity graph.
 * Two events are connected if their centroid embedding cosine similarity
 * is ≥ the configured threshold.
 */
function buildMergeGroups(
  events: EventDetail[],
  threshold: number,
): MergeGroup[] {
  if (events.length < 2) return [];

  // Compute centroid embedding for each event
  const centroids = new Map<string, number[]>();
  for (const ev of events) {
    const emb = averageEmbedding(ev.articles);
    centroids.set(ev.id, emb);
  }

  // Union-Find data structure
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  // Compare every pair
  let pairCount = 0;
  const totalPairs = (events.length * (events.length - 1)) / 2;
  console.log(`[Optimizer] Computing ${totalPairs} pairwise similarities...`);

  for (let i = 0; i < events.length; i++) {
    const a = events[i];
    const embA = centroids.get(a.id);
    if (!embA || embA.length === 0) continue;

    for (let j = i + 1; j < events.length; j++) {
      const b = events[j];
      const embB = centroids.get(b.id);
      if (!embB || embB.length === 0) continue;

      const sim = cosineSimilarity(embA, embB);
      pairCount++;
      if (pairCount % 1000 === 0) {
        console.log(`[Optimizer]  ... ${pairCount}/${totalPairs} pairs processed`);
      }

      if (sim >= threshold) {
        union(a.id, b.id);
        console.log(`[Optimizer] 🔗 Merge candidate: "${a.title}" ↔ "${b.title}" (sim=${sim.toFixed(4)})`);
      }
    }
  }

  console.log(`[Optimizer] Processed ${pairCount} pairs`);

  // Build connected components
  const components = new Map<string, string[]>();
  for (const ev of events) {
    const root = find(ev.id);
    if (!components.has(root)) components.set(root, []);
    components.get(root)!.push(ev.id);
  }

  // Filter out singletons (groups of size 1)
  const groups: MergeGroup[] = [];
  for (const [, memberIds] of components) {
    if (memberIds.length < 2) continue;

    // Find the event with the highest impact to keep
    const members = memberIds.map((id) => events.find((e) => e.id === id)!);
    members.sort((a, b) => b.impact - a.impact);
    const keep = members[0];
    const duplicates = members.slice(1);

    const reassignedArticles: NewsArticle[] = [];
    for (const dup of duplicates) {
      reassignedArticles.push(...dup.articles);
    }

    groups.push({
      keepEventId: keep.id,
      mergedEventIds: duplicates.map((d) => d.id),
      reassignedArticles,
    });
  }

  return groups;
}

// ── Main job ─────────────────────────────────────────────────────────

export const runOptimizer: JobFn = async (_data) => {
  console.log('[Job:optimizer] Starting — embedding optimizer');

  const threshold = config.mergeSimilarityThreshold;

  // 1 — Fetch all events
  console.log('[Job:optimizer] Fetching events from event-detector...');
  const allEvents = await fetchAllEvents();
  console.log(`[Job:optimizer] Fetched ${allEvents.length} events`);

  if (allEvents.length < 2) {
    console.log('[Job:optimizer] Fewer than 2 events — nothing to optimise');
    return;
  }

  // 2 — Build merge groups by pairwise similarity
  const groups = buildMergeGroups(allEvents, threshold);
  console.log(`[Job:optimizer] Found ${groups.length} merge groups`);

  if (groups.length === 0) {
    console.log('[Job:optimizer] No duplicate events found — nothing to merge');
    return;
  }

  // 3 — Execute merges: POST articles from duplicate events to /api/detect
  let mergedCount = 0;
  let reassignedCount = 0;

  for (const group of groups) {
    console.log(`[Optimizer] Merging ${group.mergedEventIds.length} events into "${group.keepEventId}"`);

    // Fetch the kept event to know which articles it already has
    const keptEvent = await fetchEvent(group.keepEventId);
    const existingKeys = new Set(
      keptEvent.articles.map((a) => `${a.title}|${a.source}|${a.publishedAt}`),
    );

    for (const article of group.reassignedArticles) {
      // Idempotency check: skip if the article is already in the kept event
      const key = `${article.title}|${article.source}|${article.publishedAt}`;
      if (existingKeys.has(key)) {
        console.log(`[Optimizer]  ↪ Skipping "${article.title}" — already in kept event`);
        continue;
      }

      try {
        await postArticleToDetect(article);
        reassignedCount++;
        existingKeys.add(key);
        console.log(`[Optimizer]  ↪ Reassigned "${article.title}" to event ${group.keepEventId}`);
      } catch (err) {
        console.error(`[Optimizer]  ✗ Failed to reassign "${article.title}":`, (err as Error).message);
      }
    }

    mergedCount += group.mergedEventIds.length;
  }

  // 4 — Final report
  console.log(`[Job:optimizer] Done — Merged ${mergedCount} duplicate events, ${reassignedCount} articles reassigned`);
};
