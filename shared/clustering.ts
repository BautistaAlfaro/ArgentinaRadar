/**
 * News Clustering — ArgentinaRadar
 *
 * Groups similar news articles from different sources using:
 *   - Title similarity (keyword overlap + Jaccard index)
 *   - Source diversity bonus
 *   - Time proximity bonus (< 2 hours apart → higher probability of same topic)
 *
 * Returns clusters with a consensus_score indicating how many sources agree.
 */

import type { NewsItem } from './types/index.js';

// ─── Stop words (shared with trending.ts) ─────────────────────────────────

const STOP_WORDS = new Set([
  'el', 'la', 'que', 'los', 'del', 'una', 'por', 'para', 'con', 'como',
  'un', 'una', 'las', 'lo', 'su', 'se', 'no', 'es', 'más', 'mas',
  'pero', 'sus', 'le', 'ya', 'este', 'entre', 'todo', 'esta', 'otro',
  'ese', 'esa', 'al', 'sin', 'hay', 'ser', 'han', 'cada', 'muy',
  'era', 'tras', 'allí', 'alli', 'aún', 'aun', 'donde', 'sobre',
  'también', 'tambien', 'fue', 'dos', 'tres', 'desde', 'hasta',
]);

const MIN_WORD_LENGTH = 4;

// ─── Types ───────────────────────────────────────────────────────────────

export interface Cluster {
  /** Unique cluster identifier */
  clusterId: string;
  /** The most representative topic (most frequent keyword) */
  mainTopic: string;
  /** How many articles are in this cluster */
  articleCount: number;
  /** How many different sources contributed */
  sourceCount: number;
  /** Top 3 article titles (most recent first) */
  topArticleTitles: string[];
  /** Consensus score: 0–1 where 1 = every source agrees */
  consensusScore: number;
  /** IDs of the articles in this cluster */
  articleIds: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Tokenize text into a set of significant, stemmed-like keywords.
 */
function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-záéíóúüñ0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= MIN_WORD_LENGTH && !STOP_WORDS.has(w));
  return new Set(tokens);
}

/**
 * Compute the Jaccard similarity coefficient between two sets.
 * J(A, B) = |A ∩ B| / |A ∪ B|
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

/**
 * Determine how close two publishedAt timestamps are.
 * Returns 1 if < 2h apart, decaying to 0 over 12h.
 */
function timeProximity(a: string, b: string): number {
  const diff = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  const hours = diff / 3_600_000;
  if (hours < 2) return 1;
  if (hours > 12) return 0;
  return 1 - (hours - 2) / 10;
}

/**
 * Check if two articles are about the same topic.
 * Combines Jaccard similarity with time proximity.
 */
function isSameTopic(a: NewsItem, b: NewsItem, threshold = 0.3): boolean {
  const titleA = tokenize(a.title);
  const titleB = tokenize(b.title);
  const summaryA = tokenize(a.summary || '');
  const summaryB = tokenize(b.summary || '');

  // Combined token set for titles and summaries
  const combinedA = new Set([...titleA, ...summaryA]);
  const combinedB = new Set([...titleB, ...summaryB]);

  const jaccard = jaccardSimilarity(combinedA, combinedB);
  const timeBonus = timeProximity(a.publishedAt, b.publishedAt) * 0.15;

  return (jaccard + timeBonus) >= threshold;
}

/**
 * Extract the most common significant keyword from a group of articles
 * to serve as the cluster's main topic.
 */
function extractMainTopic(articles: NewsItem[]): string {
  const freq = new Map<string, number>();
  for (const article of articles) {
    const tokens = tokenize(article.title);
    for (const token of tokens) {
      freq.set(token, (freq.get(token) ?? 0) + 1);
    }
  }

  let bestWord = '';
  let bestCount = 0;
  for (const [word, count] of freq) {
    if (count > bestCount) {
      bestCount = count;
      bestWord = word;
    }
  }
  return bestWord || articles[0]?.title?.slice(0, 40) || 'unknown';
}

/**
 * Generate a deterministic cluster ID from a set of article IDs.
 */
function generateClusterId(articleIds: string[]): string {
  const sorted = [...articleIds].sort();
  const hash = sorted.join(',').slice(0, 40);
  // Simple hash for a short ID
  let h = 0;
  for (let i = 0; i < hash.length; i++) {
    h = ((h << 5) - h) + hash.charCodeAt(i);
    h |= 0;
  }
  const hex = Math.abs(h).toString(36).slice(0, 12);
  return `cl_${hex}`;
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Cluster a list of news articles by topic similarity.
 *
 * Uses a greedy approach: each article is compared to existing clusters,
 * and if its similarity to any cluster's centroid exceeds the threshold,
 * it's added to that cluster. Otherwise, a new cluster is created.
 *
 * @param articles - List of news items to cluster
 * @param threshold - Similarity threshold [0–1] (default: 0.3)
 * @returns Array of clusters, sorted by article count descending
 */
export function clusterArticles(
  articles: NewsItem[],
  threshold: number = 0.3,
): Cluster[] {
  if (articles.length === 0) return [];

  // Sort by publishedAt descending so we process newest first
  const sorted = [...articles].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );

  interface ClusterState {
    articles: NewsItem[];
    members: Set<string>;
    sources: Set<string>;
  }

  const clusters: ClusterState[] = [];

  for (const article of sorted) {
    let matched = false;

    for (const cluster of clusters) {
      // Compare with existing articles in the cluster
      for (const member of cluster.articles) {
        if (isSameTopic(article, member, threshold)) {
          cluster.articles.push(article);
          cluster.members.add(article.id);
          cluster.sources.add(article.source);
          matched = true;
          break;
        }
      }
      if (matched) break;
    }

    if (!matched) {
      // Create a new cluster
      clusters.push({
        articles: [article],
        members: new Set([article.id]),
        sources: new Set([article.source]),
      });
    }
  }

  // Convert to output format
  const result: Cluster[] = clusters.map((c) => {
    const articleIds = Array.from(c.members);
    const sortedArticles = [...c.articles].sort(
      (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
    );

    const topTitles = sortedArticles
      .slice(0, 3)
      .map((a) => a.title);

    // Consensus: ratio of sources to articles (1 = every source is unique = high consensus)
    // More unique sources covering the same topic = higher consensus
    const consensusScore =
      c.articles.length > 0
        ? Math.min(1, c.sources.size / c.articles.length + 0.2)
        : 0;

    return {
      clusterId: generateClusterId(articleIds),
      mainTopic: extractMainTopic(c.articles),
      articleCount: c.members.size,
      sourceCount: c.sources.size,
      topArticleTitles: topTitles,
      consensusScore: Math.round(consensusScore * 100) / 100,
      articleIds,
    };
  });

  // Sort by article count descending
  result.sort((a, b) => b.articleCount - a.articleCount);
  return result;
}

/**
 * Filter clusters to only include those with more than 1 article
 * (multi-source clusters are the interesting ones).
 */
export function filterMultiSourceClusters(clusters: Cluster[]): Cluster[] {
  return clusters.filter((c) => c.articleCount > 1);
}
