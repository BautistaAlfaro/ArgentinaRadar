/**
 * Tweet formatter for ArgentinaRadar.
 *
 * Format: `{headline} — {source} 📍{location} 🔗{url}`
 *
 * Rules:
 *  - Max 280 characters (Twitter's limit).
 *  - If the headline doesn't fit, it is truncated with "…".
 *  - If location is missing or empty, the 📍 segment is omitted.
 *  - The URL is always appended as-is (assumed short).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TweetFormatInput {
  headline: string;
  source: string;
  /** May be null or empty — segment is omitted in that case. */
  location: string | null;
  /** Full URL; may be a short URL from a link shortener. */
  url: string;
}

/**
 * Input for the event-based tweet formatter.
 *
 * Used by the auto-publish loop when tweeting trending events from
 * the event-detector service (no individual article URL or location).
 */
export interface EventTweetInput {
  title: string;
  sourceCount: number;
  impact: number;
  consensus: 'high' | 'medium' | 'low';
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

/**
 * Format an article into a tweet string, respecting the 280-character limit.
 *
 * @returns The formatted tweet (≤ 280 chars).
 * @throws {Error} If the URL alone exceeds the tweet limit (shouldn't happen
 *   with reasonable URLs).
 */
export function formatTweet(input: TweetFormatInput): string {
  const { headline, source, location, url } = input;

  // Build the suffix — everything after the headline
  const locSegment =
    location && location.trim().length > 0 ? ` 📍${location.trim()}` : '';
  const suffix = ` — ${source}${locSegment} 🔗${url}`;

  // How many characters are left for the headline?
  const headlineBudget = 280 - suffix.length;

  if (headlineBudget <= 0) {
    throw new Error(
      `URL too long to fit in a tweet (${url.length} chars, max allowed for suffix: ${suffix.length})`
    );
  }

  // Truncate headline if necessary
  const truncatedHeadline =
    headline.length <= headlineBudget
      ? headline
      : headline.slice(0, headlineBudget - 1) + '…';

  return `${truncatedHeadline}${suffix}`;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Event-based tweet formatter for ArgentinaRadar.
 *
 * Format (Bluesky-optimized, single line):
 *   🇦🇷 {event_title} | 📰 {source_count} fuentes | Impacto: {score}/100 #ArgentinaRadar
 *
 * Rules:
 *  - Max 300 characters (Bluesky's limit).
 *  - If the title doesn't fit, it is truncated with "…".
 *  - Pipe-separated single line format for maximum readability on feeds.
 */
export function formatEventTweet(input: EventTweetInput): string {
  const { title, sourceCount, impact } = input;

  const countStr = String(sourceCount);
  const impactStr = String(impact);

  // Build suffix: " | 📰 N fuentes | Impacto: N/100 #ArgentinaRadar"
  const suffix = ` | 📰 ${countStr} fuentes | Impacto: ${impactStr}/100 #ArgentinaRadar`;

  // Prefix
  const prefix = '🇦🇷 ';

  const fixedOverhead = prefix.length + suffix.length;

  if (fixedOverhead >= 300) {
    throw new Error(
      `Overhead too long to fit in a post (${fixedOverhead} chars, max 300)`
    );
  }

  const titleBudget = 300 - fixedOverhead;

  const truncatedTitle =
    title.length <= titleBudget
      ? title
      : title.slice(0, titleBudget - 1) + '…';

  return `${prefix}${truncatedTitle}${suffix}`;
}

/**
 * Estimate the display length of a tweet.
 *
 * Twitter counts most characters as 1, but CJK characters as 2.
 * This is a simplified approximation. For production, use twitter-text.
 */
export function estimateDisplayLength(text: string): number {
  let length = 0;
  for (const char of text) {
    length += char.charCodeAt(0) > 0xffff ? 2 : 1;
  }
  return length;
}
