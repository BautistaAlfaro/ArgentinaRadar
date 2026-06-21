/**
 * Engagement Predictor — heuristic model for predicting article engagement.
 *
 * Predicts how likely an article is to generate audience engagement
 * (clicks, shares, comments) on a 0-100 scale based on:
 *   - Category multipliers (urgente ×3, politica ×2, economia ×1.5)
 *   - Time of day (morning peak = higher consumption)
 *   - Source diversity (covered by 3+ sources = more engaging)
 *   - Headline length (15-40 chars performs best)
 *   - Contains key figures (numbers, percentages, proper names)
 *
 * Used alongside the quality scorer to prioritise high-potential articles
 * for auto-publishing and promotion.
 */

// ─── Category engagement multipliers ──────────────────────────────────
const CATEGORY_MULTIPLIERS: Record<string, number> = {
  urgente: 3.0,
  politica: 2.0,
  economia: 1.5,
  policial: 1.4,
  sociedad: 1.2,
  deportes: 1.0,
  general: 0.8,
};

const DEFAULT_CATEGORY_MULTIPLIER = 0.8;

/**
 * Engagement score factor weights (base values before multipliers).
 */
const WEIGHTS = {
  CATEGORY: 25,
  TIMING: 15,
  SOURCE_DIVERSITY: 20,
  HEADLINE_LENGTH: 20,
  KEY_FIGURES: 20,
};

// ─── Article interface (minimal — matches what the pipeline provides) ──

export interface ArticleForPrediction {
  title: string;
  category?: string;
  source: string;
  sources?: string[];
  publishedAt?: string; // ISO 8601
}

/**
 * Predict engagement potential for an article.
 *
 * @param article - Article data (title, category, source, sources, publishedAt)
 * @returns       - Engagement score 0-100
 */
export function predictEngagement(article: ArticleForPrediction): number {
  let score = 0;
  const maxWeight = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);

  // ── 1. Category multiplier ──────────────────────────────────────────
  const cat = (article.category || 'general').toLowerCase();
  const multiplier = CATEGORY_MULTIPLIERS[cat] ?? DEFAULT_CATEGORY_MULTIPLIER;
  score += WEIGHTS.CATEGORY * Math.min(multiplier / 3.0, 1.0); // normalise to 0-1

  // ── 2. Time of day ─────────────────────────────────────────────────
  let timingScore = WEIGHTS.TIMING * 0.5; // neutral default
  if (article.publishedAt) {
    try {
      const hour = new Date(article.publishedAt).getHours();
      if (hour >= 8 && hour <= 11) {
        timingScore = WEIGHTS.TIMING; // morning peak
      } else if (hour >= 18 && hour <= 21) {
        timingScore = WEIGHTS.TIMING * 0.8; // evening secondary peak
      } else if (hour >= 12 && hour <= 17) {
        timingScore = WEIGHTS.TIMING * 0.6; // afternoon
      } else {
        timingScore = WEIGHTS.TIMING * 0.3; // night
      }
    } catch {
      // invalid date — use neutral
    }
  }
  score += timingScore;

  // ── 3. Source diversity ────────────────────────────────────────────
  const uniqueSources = new Set<string>();
  uniqueSources.add(article.source.toLowerCase().trim());
  if (article.sources && Array.isArray(article.sources)) {
    for (const s of article.sources) {
      uniqueSources.add(s.toLowerCase().trim());
    }
  }

  if (uniqueSources.size >= 3) {
    score += WEIGHTS.SOURCE_DIVERSITY; // full marks
  } else if (uniqueSources.size === 2) {
    score += WEIGHTS.SOURCE_DIVERSITY * 0.7;
  } else {
    score += WEIGHTS.SOURCE_DIVERSITY * 0.3;
  }

  // ── 4. Headline length ─────────────────────────────────────────────
  const titleLen = article.title.trim().length;
  if (titleLen >= 15 && titleLen <= 40) {
    score += WEIGHTS.HEADLINE_LENGTH; // optimal
  } else if (titleLen >= 10 && titleLen <= 60) {
    score += WEIGHTS.HEADLINE_LENGTH * 0.6;
  } else if (titleLen > 5 && titleLen < 120) {
    score += WEIGHTS.HEADLINE_LENGTH * 0.3;
  }
  // very short or very long → zero

  // ── 5. Key figures ─────────────────────────────────────────────────
  let figuresScore = 0;
  const text = article.title;

  // Contains numbers (digits, percentages, amounts)
  if (/\d+/.test(text)) figuresScore += 8;
  if (/\d+%/.test(text)) figuresScore += 4;
  if (/[Aa][$]?\d+/.test(text)) figuresScore += 3; // monetary amounts

  // Contains proper names (capitalised words, excluding stop words)
  const words = text.split(/\s+/);
  const properNameCount = words.filter((w) => {
    if (w.length < 2) return false;
    // First letter uppercase, rest lowercase — likely a proper name
    return /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+$/.test(w);
  }).length;
  figuresScore += Math.min(properNameCount * 2, 5); // max 5 points for names

  score += Math.min(figuresScore, WEIGHTS.KEY_FIGURES);

  // ── Normalise to 0-100 ─────────────────────────────────────────────
  return Math.round(Math.max(0, Math.min(100, (score / maxWeight) * 100)));
}

/**
 * Quick rank — shorthand to get a combined quality + engagement score.
 *
 * @param quality    - Quality score (0-100)
 * @param engagement - Engagement score (0-100)
 * @returns          - Combined score (0-100, weighted 40% quality / 60% engagement)
 */
export function combinedRank(quality: number, engagement: number): number {
  return Math.round(quality * 0.4 + engagement * 0.6);
}
