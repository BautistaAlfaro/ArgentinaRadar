/**
 * Trending Topics Detector — ArgentinaRadar
 *
 * Groups articles by keyword frequency in titles and summaries over the
 * last N hours. Returns the top 10 trending topics with article count,
 * source diversity, category, and a freshness-weighted score.
 */

import type { NewsItem, Category } from './types/index.js';

// ─── Stop words to exclude ───────────────────────────────────────────────

const STOP_WORDS = new Set([
  'el', 'la', 'que', 'los', 'del', 'una', 'por', 'para', 'con', 'como',
  'un', 'una', 'las', 'lo', 'su', 'se', 'no', 'es', 'más', 'mas',
  'pero', 'sus', 'le', 'ya', 'este', 'entre', 'todo', 'esta', 'otro',
  'ese', 'esa', 'al', 'sin', 'hay', 'ser', 'han', 'cada', 'muy',
  'era', 'tras', 'allí', 'alli', 'aún', 'aun', 'donde', 'sobre',
  'también', 'tambien', 'fue', 'dos', 'tres', 'desde', 'hasta',
]);

// Minimum word length to consider as a keyword
const MIN_WORD_LENGTH = 4;

// ─── Types ───────────────────────────────────────────────────────────────

export interface TrendingTopic {
  /** The trending keyword / topic name */
  topic: string;
  /** How many articles matched this topic */
  articleCount: number;
  /** How many different news sources covered it */
  sourceCount: number;
  /** Best-guess category based on matching articles */
  category: Category | 'general';
  /** Title of the most recent article in this topic */
  latestArticleTitle: string;
  /** Freshness-weighted score (articleCount × sourceDiversity × recency) */
  trendingScore: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Tokenize an article title + summary into a set of significant keywords.
 * Strips punctuation, removes stop words and short words, then lowercases.
 */
function extractKeywords(title: string, summary?: string): string[] {
  const text = `${title} ${summary ?? ''}`.toLowerCase();
  const tokens = text
    .replace(/[^a-záéíóúüñ0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= MIN_WORD_LENGTH && !STOP_WORDS.has(w));

  // Deduplicate per article
  return [...new Set(tokens)];
}

/**
 * Returns the most frequent category among a list of items.
 */
function dominantCategory(items: Array<{ category?: string }>): Category | 'general' {
  const freq: Record<string, number> = {};
  for (const item of items) {
    const cat = item.category || 'general';
    freq[cat] = (freq[cat] ?? 0) + 1;
  }
  let best = 'general';
  let bestCount = 0;
  for (const [cat, count] of Object.entries(freq)) {
    if (count > bestCount) {
      bestCount = count;
      best = cat;
    }
  }
  return best as Category | 'general';
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Extract trending topics from a list of news articles.
 *
 * Groups articles by shared keywords across titles/summaries, then scores
 * each topic by article count × source diversity × freshness.
 *
 * @param articles - Array of news items (already filtered by time if desired)
 * @param topN     - Number of top topics to return (default: 10)
 * @returns Sorted array of trending topics (highest score first)
 */
export function getTrendingTopics(
  articles: NewsItem[],
  topN: number = 10,
): TrendingTopic[] {
  const topicMap = new Map<
    string,
    {
      articleIds: Set<string>;
      sources: Set<string>;
      categories: string[];
      latestTitle: string;
      latestPublishedAt: string;
    }
  >();

  for (const article of articles) {
    const keywords = extractKeywords(article.title, article.summary);

    for (const kw of keywords) {
      let entry = topicMap.get(kw);
      if (!entry) {
        entry = {
          articleIds: new Set(),
          sources: new Set(),
          categories: [],
          latestTitle: article.title,
          latestPublishedAt: article.publishedAt,
        };
        topicMap.set(kw, entry);
      }

      entry.articleIds.add(article.id);
      entry.sources.add(article.source);
      // Push category from each article that contributes this keyword
      entry.categories.push(article.category);

      // Track the latest article for this topic
      if (article.publishedAt > entry.latestPublishedAt) {
        entry.latestPublishedAt = article.publishedAt;
        entry.latestTitle = article.title;
      }
    }
  }

  // Convert map to scored array
  const now = Date.now();
  const scored: TrendingTopic[] = [];

  for (const [topic, data] of topicMap) {
    const articleCount = data.articleIds.size;
    const sourceCount = data.sources.size;

    // Freshness: how recent is the latest article (in hours)
    const latestTime = new Date(data.latestPublishedAt).getTime();
    const hoursAgo = Math.max(0, (now - latestTime) / 3_600_000);
    const freshnessFactor = Math.max(0.1, 1 - hoursAgo / 48); // decays over 48h

    // Trending score: articleCount × sourceDiversity² × freshness
    const trendingScore =
      articleCount *
      (1 + sourceCount * 0.5) *
      freshnessFactor;

    scored.push({
      topic,
      articleCount,
      sourceCount,
      category: dominantCategory(
        data.categories.map((c) => ({ category: c })),
      ),
      latestArticleTitle: data.latestTitle,
      trendingScore: Math.round(trendingScore * 100) / 100,
    });
  }

  // Sort by score descending, take top N
  scored.sort((a, b) => b.trendingScore - a.trendingScore);
  return scored.slice(0, topN);
}
