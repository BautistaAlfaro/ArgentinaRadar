/**
 * Event Detection Engine.
 *
 * Core algorithm (run for every incoming article):
 *   1. Ensure we have an embedding (from payload or via ai-processor).
 *   2. Compare against recent articles (last 24 h) using cosine similarity.
 *   3. If similarity ≥ 0.90 → AUTO MATCH (same event, no GPT needed).
 *   4. If 0.85–0.90 → GPT verification via entity overlap.
 *   5. If < 0.85 → NEW EVENT.
 *   6. Return { eventId, matchType, confidence }.
 */

import axios from 'axios';
import crypto from 'node:crypto';
import { config } from './config.js';
import { store } from './store.js';
import type {
  NewsArticle,
  Entity,
  DetectPayload,
  DetectResult,
} from './types.js';

// ── Similarity ──────────────────────────────────────────────────────

/**
 * Standard cosine similarity for two equal-length vectors.
 * Both vectors must be the same length (1536 for text-embedding-3-small).
 * Returns a value in [-1, 1] — for embeddings it's always ≥ 0.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

// ── ai-processor helpers ────────────────────────────────────────────

/** Fetch an embedding from the ai-processor when the payload doesn't include one. */
async function ensureEmbedding(
  title: string,
  summary: string,
  existing?: number[],
): Promise<number[]> {
  if (existing && existing.length > 0) return existing;

  try {
    const text = `${title} ${summary}`.trim() || title;
    const res = await axios.post(`${config.aiProcessorUrl}/api/embed`, {
      texts: [text],
    });
    return res.data.embeddings[0];
  } catch (err) {
    console.warn(
      '[Detector] Failed to fetch embedding from ai-processor, using zero vector:',
      (err as Error).message,
    );
    // Zero vector → similarity 0 → always treated as NEW EVENT.
    return new Array(1536).fill(0);
  }
}

/** Fetch GPT-extracted entities for a text via the ai-processor. */
async function fetchEntities(
  title: string,
  summary: string,
): Promise<Entity[]> {
  try {
    const res = await axios.post(`${config.aiProcessorUrl}/api/process`, {
      title,
      summary,
      source: 'event-detector',
    });
    return res.data.entities ?? [];
  } catch {
    // Non-fatal — entity-free articles still match by embedding alone.
    return [];
  }
}

// ── GPT Verification ───────────────────────────────────────────────

/**
 * GPT-powered verification for borderline similarity (0.85–0.90).
 *
 * Uses entity overlap as a semantic proxy: GPT extracts named entities
 * from each article, and we compare the two entity sets. High overlap
 * (≥ 30 %) means the articles describe the same real-world event.
 *
 * If the ai-processor is unreachable, we conservatively return
 * `sameEvent: false` so the article starts a new event rather than
 * polluting an existing one with a false match.
 */
async function gptVerify(
  a1: { title: string; summary: string; entities: Entity[] },
  a2: { title: string; summary: string; entities: Entity[] },
): Promise<{ sameEvent: boolean; confidence: number }> {
  try {
    const [entities1, entities2] = await Promise.all([
      a1.entities.length > 0
        ? Promise.resolve(a1.entities)
        : fetchEntities(a1.title, a1.summary),
      a2.entities.length > 0
        ? Promise.resolve(a2.entities)
        : fetchEntities(a2.title, a2.summary),
    ]);

    const names1 = new Set(entities1.map((e) => e.name.toLowerCase().trim()));
    const names2 = new Set(entities2.map((e) => e.name.toLowerCase().trim()));

    let intersection = 0;
    for (const name of names1) {
      if (names2.has(name)) intersection++;
    }

    const union = new Set([...names1, ...names2]);
    const entityOverlap = union.size > 0 ? intersection / union.size : 0;

    return {
      sameEvent: entityOverlap >= 0.3,
      confidence: Math.round(entityOverlap * 100) / 100,
    };
  } catch (err) {
    console.warn(
      '[Detector] GPT verification failed, defaulting to new event:',
      (err as Error).message,
    );
    return { sameEvent: false, confidence: 0 };
  }
}

// ── Main detection entry point ─────────────────────────────────────

/**
 * Process a newly ingested article and either attach it to an existing
 * event or create a new one.
 */
export async function detectEvent(
  payload: DetectPayload,
): Promise<DetectResult> {
  // 1. Ensure embedding
  const embedding = await ensureEmbedding(
    payload.title,
    payload.summary,
    payload.embedding,
  );

  // 2. Build article object
  const now = new Date().toISOString();
  const article: NewsArticle = {
    id: crypto.randomUUID(),
    title: payload.title,
    summary: payload.summary,
    source: payload.source,
    url: payload.url,
    category: payload.category || 'sociedad',
    publishedAt: payload.publishedAt,
    ingestedAt: now,
    embedding,
    entities: [],
  };

  // 3. Collect articles from the last 24 hours
  const recentArticles = store.getRecentArticles(24);

  // 3a. No recent articles → first event
  if (recentArticles.length === 0) {
    const event = store.createEvent(article);
    return {
      eventId: event.id,
      matchType: 'new',
      confidence: 1.0,
      event,
    };
  }

  // 4. Find the nearest neighbour by cosine similarity
  let bestSim = 0;
  let bestArticle: NewsArticle | null = null;

  for (const recent of recentArticles) {
    const sim = cosineSimilarity(embedding, recent.embedding);
    if (sim > bestSim) {
      bestSim = sim;
      bestArticle = recent;
    }
  }

  // 5. Decision tree
  /* eslint-disable @typescript-eslint/no-unnecessary-condition */
  if (bestArticle && bestSim >= config.similarityThreshold.autoMatch) {
    // ── Step 5a: AUTO MATCH ──────────────────────────────────────
    const existingEvent = store.getEventByArticleId(bestArticle.id);
    if (existingEvent) {
      store.addArticleToEvent(existingEvent.id, article);
      const updated = store.getEvent(existingEvent.id)!;
      return {
        eventId: updated.id,
        matchType: 'auto',
        confidence: Math.round(bestSim * 100) / 100,
        event: updated,
      };
    }
  }

  if (bestArticle && bestSim >= config.similarityThreshold.gptVerify) {
    // ── Step 5b: GPT VERIFY ──────────────────────────────────────
    const result = await gptVerify(
      {
        title: article.title,
        summary: article.summary,
        entities: article.entities,
      },
      {
        title: bestArticle.title,
        summary: bestArticle.summary,
        entities: bestArticle.entities,
      },
    );

    if (result.sameEvent) {
      const existingEvent = store.getEventByArticleId(bestArticle.id);
      if (existingEvent) {
        store.addArticleToEvent(existingEvent.id, article);
        const updated = store.getEvent(existingEvent.id)!;
        return {
          eventId: updated.id,
          matchType: 'gpt_verified',
          confidence: result.confidence,
          event: updated,
        };
      }
    }
  }

  // ── Step 5c: NEW EVENT ──────────────────────────────────────────
  const event = store.createEvent(article);
  return {
    eventId: event.id,
    matchType: 'new',
    confidence: Math.round(bestSim * 100) / 100,
    event,
  };
}
