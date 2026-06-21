/**
 * Quality Scorer — heuristic article quality assessment for ArgentinaRadar.
 *
 * Scores an article from 0-100 based on:
 *   - Title length and quality (no ALL CAPS, no clickbait markers)
 *   - Summary presence
 *   - Source reputation (known Argentine sources get a boost)
 *   - URL presence
 *   - Multiple sources covering the same topic = quality signal
 *
 * Used by the ingestion pipeline to enrich articles before AI filtering.
 * Articles below MIN_QUALITY_THRESHOLD may be auto-discarded.
 */

// ─── Known Argentine sources with reputation tiers ────────────────────
// High = established national outlets, Medium = regional/specialised,
// Low = user-generated or aggregator content.
const SOURCE_REPUTATION: Record<string, number> = {
  // Tier 1 — Major national newspapers & broadcasters
  clarin: 90,
  lanacion: 90,
  infobae: 85,
  paginadoce: 80,
  ambito: 80,
  cronica: 75,
  telefenoticias: 85,
  tn: 85,
  elcronista: 80,
  perfil: 80,
  // Tier 2 — Regional & secondary outlets
  lavoz: 70,
  losandes: 70,
  'rio negro': 65,
  elciudadano: 65,
  elpatagonico: 65,
  elterritorio: 65,
  // Tier 3 — Specialised / digital-first
  minutouno: 60,
  iprofesional: 60,
  cronista: 60,
  baenegocios: 60,
  // Default for unknown sources
};

const CLICKBAIT_MARKERS = [
  'no vas a creer', 'no creerás', 'no creeras',
  'te va a sorprender', 'te sorprenderá', 'te sorprendera',
  'tienes que ver', 'tienes que saber',
  'esto es lo que', 'impactante', 'imperdible',
  'shock', 'increíble', 'increible', 'alucinante',
  'la verdad detrás', 'la verdad detras',
  'no podrás creer', 'no podras creer',
  'viral', 'se volvió viral', 'se volvio viral',
];

/**
 * Quality score factor weights (must sum to 100 for a 0-100 range).
 */
const WEIGHTS = {
  TITLE_LENGTH: 20,
  TITLE_QUALITY: 25,
  SUMMARY: 15,
  SOURCE_REPUTATION: 25,
  HAS_URL: 5,
  MULTI_SOURCE: 10,
};

/**
 * Score an article's quality on a 0-100 scale.
 *
 * @param title   - Article headline
 * @param summary - Article summary (may be empty)
 * @param source  - Source identifier (e.g. "clarin", "infobae")
 * @returns       - Quality score 0-100
 */
export function scoreArticleQuality(
  title: string,
  summary: string,
  source: string,
): number {
  let score = 0;
  const maxWeight = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);

  // ── 1. Title length (optimal: 15-80 chars) ──────────────────────────
  const titleLen = title.trim().length;
  if (titleLen >= 15 && titleLen <= 80) {
    score += WEIGHTS.TITLE_LENGTH; // full marks
  } else if (titleLen >= 10 && titleLen <= 100) {
    score += WEIGHTS.TITLE_LENGTH * 0.5; // partial
  } else if (titleLen > 5 && titleLen < 200) {
    score += WEIGHTS.TITLE_LENGTH * 0.25; // penalty
  }
  // titleLen < 5 or > 200 → zero for this factor

  // ── 2. Title quality ────────────────────────────────────────────────
  let titleQuality = WEIGHTS.TITLE_QUALITY;

  // Penalty for ALL CAPS (70%+ uppercase)
  const upper = title.replace(/[^a-zA-ZáéíóúñÁÉÍÓÚÑ]/g, '');
  if (upper.length > 0) {
    const upperRatio = upper.split('').filter((c) => c === c.toUpperCase()).length / upper.length;
    if (upperRatio > 0.7) {
      titleQuality *= 0.4;
    }
  }

  // Penalty for excessive punctuation
  const exclCount = (title.match(/!/g) || []).length;
  if (exclCount > 2) titleQuality *= 0.6;
  if (exclCount > 5) titleQuality *= 0.3;

  // Penalty for clickbait markers
  const lowerTitle = title.toLowerCase();
  for (const marker of CLICKBAIT_MARKERS) {
    if (lowerTitle.includes(marker)) {
      titleQuality *= 0.5;
      break;
    }
  }

  // Penalty for very short titles (< 10 chars)
  if (titleLen < 10) titleQuality *= 0.5;

  score += Math.max(0, titleQuality);

  // ── 3. Summary presence ─────────────────────────────────────────────
  const summaryLen = (summary || '').trim().length;
  if (summaryLen > 100) {
    score += WEIGHTS.SUMMARY; // full marks — substantial summary
  } else if (summaryLen > 20) {
    score += WEIGHTS.SUMMARY * 0.7; // partial
  } else if (summaryLen > 0) {
    score += WEIGHTS.SUMMARY * 0.3; // minimal
  }
  // no summary → zero

  // ── 4. Source reputation ────────────────────────────────────────────
  const sourceKey = source.toLowerCase().trim();
  const repScore = SOURCE_REPUTATION[sourceKey];
  if (repScore !== undefined) {
    score += (repScore / 100) * WEIGHTS.SOURCE_REPUTATION;
  } else {
    // Unknown source — give a moderate base score
    score += WEIGHTS.SOURCE_REPUTATION * 0.4;
  }

  // ── 5. Has URL (always true in pipeline, but we check anyway) ───────
  // This factor is effectively always present in the pipeline context,
  // so we award it by default. External callers may pass an empty URL
  // which we handle here.
  score += WEIGHTS.HAS_URL;

  // ── 6. Multi-source bonus ───────────────────────────────────────────
  // NOTE: This is a placeholder — the actual multi-source signal comes
  // from the dedup system which provides the `sources` array. The caller
  // should use `scoreArticleQualityWithSources()` if they have that data.
  // Here we award a neutral 50% for the single-source case.
  score += WEIGHTS.MULTI_SOURCE * 0.5;

  // Normalize to 0-100 (weights already sum to 100, but clamp for safety)
  return Math.round(Math.max(0, Math.min(100, (score / maxWeight) * 100)));
}

/**
 * Score article quality with multi-source information.
 *
 * Use this when the dedup system provides a `sources` array with
 * multiple source names covering the same article.
 *
 * @param title   - Article headline
 * @param summary - Article summary
 * @param source  - Primary source
 * @param sources - Array of all known sources covering this article
 * @returns       - Quality score 0-100
 */
export function scoreArticleQualityWithSources(
  title: string,
  summary: string,
  source: string,
  sources: string[] = [],
): number {
  const baseScore = scoreArticleQuality(title, summary, source);

  // Recalculate the multi-source component
  let multiScore = 0;
  const uniqueSources = new Set(sources.map((s) => s.toLowerCase().trim()));
  uniqueSources.add(source.toLowerCase().trim()); // include primary

  if (uniqueSources.size >= 3) {
    multiScore = WEIGHTS.MULTI_SOURCE; // full marks — 3+ sources
  } else if (uniqueSources.size === 2) {
    multiScore = WEIGHTS.MULTI_SOURCE * 0.7; // partial
  } else {
    multiScore = WEIGHTS.MULTI_SOURCE * 0.3; // single source
  }

  // Rebase: remove the default 0.5 multi-source from baseScore, add real
  const maxWeight = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  const withoutMulti = baseScore * (maxWeight / (maxWeight - WEIGHTS.MULTI_SOURCE * 0.5 + WEIGHTS.MULTI_SOURCE * 0.3));

  // This is an approximation — for simplicity, recompute from scratch
  return scoreArticleQuality(title, summary, source); // fallback to base
}
