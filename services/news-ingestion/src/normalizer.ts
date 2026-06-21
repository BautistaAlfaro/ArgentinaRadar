import crypto from 'crypto';
import type { NewsItem, Category } from '../../../shared/types/index.js';

const SUMMARY_MAX_LENGTH = 500;

/**
 * Normalize an article into a NewsItem.
 * Truncates summary to 500 chars, parses dates, generates a unique ID.
 */
export function normalizeArticle(input: {
  title: string;
  summary?: string;
  source: string;
  url: string;
  category: Category;
  publishedAt?: string | Date | null;
}): NewsItem {
  const title = input.title.trim();
  const summary = truncateSummary((input.summary ?? '').trim());
  const publishedAt = parseDate(input.publishedAt);
  const id = generateId(title, input.url);

  return {
    id,
    title,
    summary,
    source: input.source,
    sources: [input.source],
    url: input.url.trim(),
    category: input.category,
    publishedAt,
    ingestedAt: new Date().toISOString(),
    location: null,
    aiScore: null,
    tweetId: null,
    status: 'ingested',
  };
}

/** Truncate summary to a max length, preserving whole words at the boundary. */
export function truncateSummary(text: string, max = SUMMARY_MAX_LENGTH): string {
  if (text.length <= max) return text;
  const truncated = text.slice(0, max);
  // Try not to cut mid-word
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > 0 ? truncated.slice(0, lastSpace) + '…' : truncated.slice(0, max - 1) + '…';
}

/** Parse a date value to ISO string; returns current timestamp if null/invalid. */
export function parseDate(date: string | Date | null | undefined): string {
  if (!date) return new Date().toISOString();
  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

/** Generate a deterministic ID from title + URL (SHA-256 prefix). */
export function generateId(title: string, url: string): string {
  const hash = crypto.createHash('sha256').update(title + url).digest('hex');
  return hash.slice(0, 16);
}
