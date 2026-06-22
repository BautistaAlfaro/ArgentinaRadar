/**
 * Content Curator — article deduplication, event grouping, and relevance filtering.
 *
 * Provides the curation layer for the ArgentinaRadar pipeline:
 *   - isDuplicateArticle()   → Jaccard similarity > 0.7
 *   - groupByEvent()         → cluster related articles
 *   - selectBestArticle()    → pick best source per group
 *   - isArgentinaRelevant()  → filter non-Argentina news
 *
 * @module curator
 */

// ─── Argentine source reputation (mirrors qualityScorer.ts) ─────────────

const SOURCE_RANK: Record<string, number> = {
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
  lavoz: 70,
  losandes: 70,
  'rio negro': 65,
  elciudadano: 65,
  elpatagonico: 65,
  elterritorio: 65,
  minutouno: 60,
  iprofesional: 60,
  cronista: 60,
  baenegocios: 60,
};

// ─── Argentina-relevant keywords (locations, entities, topics) ─────────

const ARGENTINA_ENTITIES = [
  // Provinces
  'buenos aires', 'caba', 'capital federal', 'córdoba', 'cordoba',
  'santa fe', 'mendoza', 'tucumán', 'tucuman', 'entre ríos', 'entre rios',
  'salta', 'neuquén', 'neuquen', 'chubut', 'río negro', 'rio negro',
  'misiones', 'corrientes', 'santiago del estero', 'san juan', 'jujuy',
  'la pampa', 'catamarca', 'la rioja', 'santa cruz', 'tierra del fuego',
  'formosa', 'chaco', 'san luis',
  // Cities
  'rosario', 'la plata', 'mar del plata', 'bariloche', 'córdoba', 'cordoba',
  'mendoza', 'salta', 'ushuaia', 'posadas', 'resistencia', 'santa fe',
  'san miguel de tucumán', 'san miguel de tucuman', 'bahía blanca', 'bahia blanca',
  // National references
  'argentina', 'argentino', 'argentinos', 'argentinas',
  'presidente milei', 'gobierno argentino', 'casa rosada',
  'congreso de la nación', 'senado argentino', 'diputados argentina',
  'corte suprema argentina', 'bcra', 'banco central',
  'ministerio de economía', 'ministerio de economia',
  'cámara de diputados', 'camara de diputados',
  'inde', 'afip', 'anses', 'pami', 'arsat',
  'vaca muerta', 'litio argentino', 'patagonia',
  'pampa húmeda', 'humeda', 'litoral argentino', 'cuyo', 'noroeste argentino',
  // Argentine politicians & figures (common)
  'milei', 'villarroel', 'caputo', 'petit', 'francos',
  'larreta', 'macri', 'cristina', 'alberto fernández', 'alberto fernandez',
  'bullrich', 'masa', 'kicillof', 'schiaretti',
  // Argentine institutions
  'river plate', 'boca juniors', 'selección argentina', 'seleccion argentina',
  'afa', 'superliga argentina', 'primera división argentina',
  'universidad de buenos aires', 'uba', 'conicet',
  // Economy (Argentine-specific)
  'dólar blue', 'dolar blue', 'dólar oficial', 'dolar oficial',
  'dólar ccl', 'dolar ccl', 'riesgo país', 'riesgo pais',
  'merval', 'lecap', 'bopreal', 'soberanía', 'soberania',
  'argentin',  // catches many derivatives
];

const ARGENTINA_SOURCES = new Set(Object.keys(SOURCE_RANK));

// ─── Helpers ────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'el', 'la', 'que', 'los', 'del', 'una', 'por', 'para', 'con', 'como',
  'un', 'una', 'las', 'lo', 'su', 'se', 'no', 'es', 'más', 'mas',
  'pero', 'sus', 'le', 'ya', 'este', 'entre', 'todo', 'esta', 'otro',
  'ese', 'esa', 'al', 'sin', 'hay', 'ser', 'han', 'cada', 'muy',
  'era', 'tras', 'allí', 'alli', 'aún', 'aun', 'donde', 'sobre',
  'también', 'tambien', 'fue', 'dos', 'tres', 'desde', 'hasta',
]);

const MIN_WORD_LENGTH = 4;

/**
 * Tokenize text into a set of significant keywords (mirrors clustering.ts).
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
 * Compute Jaccard similarity between two token sets.
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

/**
 * Rank a source on a 0–100 scale for selection decisions.
 */
function sourceScore(source: string): number {
  return SOURCE_RANK[source.toLowerCase().trim()] ?? 40;
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Determine whether two articles are duplicates based on title + summary
 * Jaccard similarity.
 *
 * @param a - First article (title + summary used)
 * @param b - Second article
 * @param threshold - Similarity threshold (default: 0.7)
 * @returns `true` if the articles are considered duplicates
 */
export function isDuplicateArticle(
  a: { title: string; summary?: string },
  b: { title: string; summary?: string },
  threshold: number = 0.7,
): boolean {
  const textA = `${a.title} ${a.summary ?? ''}`;
  const textB = `${b.title} ${b.summary ?? ''}`;

  const tokensA = tokenize(textA);
  const tokensB = tokenize(textB);

  return jaccardSimilarity(tokensA, tokensB) >= threshold;
}

/**
 * Group a list of articles by event using title similarity.
 *
 * Each article is compared against existing groups. If its similarity
 * to any member of a group exceeds the threshold, it joins that group.
 * Otherwise, a new group is created.
 *
 * @param articles - The articles to group
 * @param threshold - Jaccard threshold (default: 0.25 — broader than dedup)
 * @returns Array of groups, sorted by group size descending
 */
export function groupByEvent(
  articles: Array<{ id: string; title: string; summary?: string; source: string }>,
  threshold: number = 0.25,
): Array<{
  eventId: string;
  articles: Array<{ id: string; title: string; summary?: string; source: string }>;
  articleCount: number;
  sourceCount: number;
}> {
  if (articles.length === 0) return [];

  const groups: Array<{
    articles: Array<{ id: string; title: string; summary?: string; source: string }>;
    sources: Set<string>;
  }> = [];

  for (const article of articles) {
    let matched = false;

    for (const group of groups) {
      for (const member of group.articles) {
        const textA = `${article.title} ${article.summary ?? ''}`;
        const textB = `${member.title} ${member.summary ?? ''}`;
        const sim = jaccardSimilarity(tokenize(textA), tokenize(textB));

        if (sim >= threshold) {
          group.articles.push(article);
          group.sources.add(article.source);
          matched = true;
          break;
        }
      }
      if (matched) break;
    }

    if (!matched) {
      groups.push({
        articles: [article],
        sources: new Set([article.source]),
      });
    }
  }

  // Sort by group size descending
  groups.sort((a, b) => b.articles.length - a.articles.length);

  return groups.map((g, i) => ({
    eventId: `ev_${i + 1}_${g.sources.size}src`,
    articles: g.articles,
    articleCount: g.articles.length,
    sourceCount: g.sources.size,
  }));
}

/**
 * Select the best article from a group of related articles.
 *
 * The best article is the one with the highest source reputation,
 * breaking ties by title length (preferring substantive headlines).
 *
 * @param group - Array of articles belonging to the same event
 * @returns The best article from the group
 */
export function selectBestArticle<T extends { source: string; title: string }>(
  group: T[],
): T {
  if (group.length === 0) {
    throw new Error('Cannot select best article from an empty group');
  }
  if (group.length === 1) return group[0];

  return [...group].sort((a, b) => {
    const scoreA = sourceScore(a.source);
    const scoreB = sourceScore(b.source);
    if (scoreA !== scoreB) return scoreB - scoreA;

    // Tie-break: prefer longer titles (more substantive)
    return b.title.length - a.title.length;
  })[0];
}

/**
 * Check whether an article is relevant to Argentina based on:
 *   - Source being a known Argentine outlet
 *   - Title/summary mentioning Argentine entities
 *   - Location data pointing to an Argentine province
 *
 * @param article - The article to check
 * @returns `true` if the article is likely Argentina-relevant
 */
export function isArgentinaRelevant(
  article: {
    title: string;
    summary?: string;
    source: string;
    location?: string | { province?: string } | null;
  },
): boolean {
  // 1. Known Argentine source → relevant
  if (ARGENTINA_SOURCES.has(article.source.toLowerCase().trim())) {
    return true;
  }

  // 2. Location data with an Argentine province
  if (article.location) {
    let province: string | undefined;
    if (typeof article.location === 'string') {
      try {
        const parsed = JSON.parse(article.location) as { province?: string };
        province = parsed.province;
      } catch {
        // Not JSON, skip
      }
    } else if (typeof article.location === 'object' && article.location !== null) {
      province = (article.location as { province?: string }).province;
    }

    if (province && province.toLowerCase() !== 'unknown') {
      // All provinces in our gazetteer are Argentine
      return true;
    }
  }

  // 3. Check title + summary for Argentine entities
  const text = `${article.title} ${article.summary ?? ''}`.toLowerCase();
  for (const entity of ARGENTINA_ENTITIES) {
    if (text.includes(entity)) {
      return true;
    }
  }

  // 4. Default: not obviously Argentine
  return false;
}
