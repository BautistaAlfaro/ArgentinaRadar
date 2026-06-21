/**
 * Semantic Search — cosine similarity search on article embeddings.
 *
 * Uses Ollama's nomic-embed-text (768d) to generate query embeddings,
 * then computes cosine similarity against all stored article embeddings.
 *
 * Falls back to title LIKE search when no embeddings are available.
 */

import Database from 'better-sqlite3';

// ─── Types ────────────────────────────────────────────────────────────

export interface SearchResult {
  id: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  category: string | null;
  publishedAt: string | null;
  ingestedAt: string;
  similarity: number; // 0.0 – 1.0 cosine similarity
}

export interface SemanticSearchOptions {
  limit?: number;
  threshold?: number; // minimum similarity to include (0.0 – 1.0)
}

// ─── Constants ────────────────────────────────────────────────────────

const AI_PROCESSOR_URL =
  process.env.AI_PROCESSOR_URL ?? 'http://localhost:3013';

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Perform a semantic search across all articles using embedding similarity.
 *
 * 1. Generates an embedding for the query via the ai-processor
 * 2. Loads all stored article embeddings from the DB
 * 3. Computes cosine similarity for each
 * 4. Returns top N results sorted by similarity (descending)
 *
 * @param db     — SQLite database instance
 * @param query  — Natural language search query
 * @param opts   — Options: limit (default 5), threshold (default 0.0)
 */
export async function semanticSearch(
  db: Database.Database,
  query: string,
  opts: SemanticSearchOptions = {},
): Promise<SearchResult[]> {
  const { limit = 5, threshold = 0.0 } = opts;

  // 1. Generate embedding for the query
  let queryEmbedding: number[];
  try {
    queryEmbedding = await generateQueryEmbedding(query);
  } catch (err) {
    console.warn(`[semanticSearch] Embedding generation failed, falling back to LIKE: ${(err as Error).message}`);
    return fallbackSearch(db, query, limit);
  }

  if (!queryEmbedding || queryEmbedding.length === 0) {
    return fallbackSearch(db, query, limit);
  }

  // 2. Load articles with embeddings from DB
  const rows = db.prepare(
    `SELECT id, title, summary, source, url, category,
            published_at, ingested_at, embedding
     FROM news_items
     WHERE embedding IS NOT NULL AND embedding != ''
     ORDER BY ingested_at DESC`,
  ).all() as Array<Record<string, unknown>>;

  if (rows.length === 0) {
    console.warn('[semanticSearch] No embeddings found in DB, falling back to LIKE');
    return fallbackSearch(db, query, limit);
  }

  // 3. Compute cosine similarity for each article
  const scored: Array<{ row: Record<string, unknown>; similarity: number }> = [];

  for (const row of rows) {
    let articleEmbedding: number[] | null = null;
    try {
      const raw = row.embedding;
      if (typeof raw === 'string') {
        articleEmbedding = JSON.parse(raw);
      } else if (Array.isArray(raw)) {
        articleEmbedding = raw as number[];
      }
    } catch {
      // Skip rows with unparseable embeddings
      continue;
    }

    if (!articleEmbedding || articleEmbedding.length === 0) continue;

    const similarity = cosineSimilarity(queryEmbedding, articleEmbedding);
    if (similarity >= threshold) {
      scored.push({ row, similarity });
    }
  }

  // 4. Sort by similarity descending, take top N
  scored.sort((a, b) => b.similarity - a.similarity);
  const top = scored.slice(0, limit);

  return top.map((item) => ({
    id: item.row.id as string,
    title: item.row.title as string,
    summary: (item.row.summary as string) || '',
    source: item.row.source as string,
    url: item.row.url as string,
    category: (item.row.category as string) || null,
    publishedAt: (item.row.published_at as string) || null,
    ingestedAt: item.row.ingested_at as string,
    similarity: Math.round(item.similarity * 10000) / 10000, // 4 decimal places
  }));
}

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Generate an embedding for the query text by calling the ai-processor.
 */
async function generateQueryEmbedding(text: string): Promise<number[]> {
  const resp = await fetch(`${AI_PROCESSOR_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    throw new Error(`Embedding API returned HTTP ${resp.status}`);
  }

  const data = (await resp.json()) as { embedding: number[] };
  return data.embedding;
}

/**
 * Compute cosine similarity between two vectors.
 * Returns 0.0 if vectors are different lengths or zero-magnitude.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0.0;

  let dotProduct = 0.0;
  let normA = 0.0;
  let normB = 0.0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0.0;

  return dotProduct / magnitude;
}

/**
 * Fallback: simple title LIKE search when embeddings aren't available.
 */
function fallbackSearch(
  db: Database.Database,
  query: string,
  limit: number,
): SearchResult[] {
  const like = `%${query}%`;
  const rows = db.prepare(
    `SELECT id, title, summary, source, url, category,
            published_at, ingested_at
     FROM news_items
     WHERE title LIKE ?
     ORDER BY ingested_at DESC
     LIMIT ?`,
  ).all(like, limit) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: row.id as string,
    title: row.title as string,
    summary: (row.summary as string) || '',
    source: row.source as string,
    url: row.url as string,
    category: (row.category as string) || null,
    publishedAt: (row.published_at as string) || null,
    ingestedAt: row.ingested_at as string,
    similarity: 0.0, // unknown similarity for LIKE search
  }));
}
