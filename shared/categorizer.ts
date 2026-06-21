/**
 * Keyword-based News Categorizer for ArgentinaRadar
 *
 * Categorizes articles by matching title + summary against
 * category-specific keyword maps. Uses score-counting: the
 * category with the most keyword matches wins.
 *
 * Categories: urgente, politica, economia, deportes, policial, sociedad, general
 */

const KEYWORD_MAPS: Record<string, string[]> = {
  urgente: [
    'último momento', 'ultimo momento', 'urgente', 'emergencia',
    'alerta', 'explosión', 'explosion', 'terremoto', 'catástrofe', 'catastrofe',
  ],
  politica: [
    'milei', 'presidente', 'diputado', 'senador', 'congreso',
    'ley', 'decreto', 'ministro', 'gobernador', 'elección', 'eleccion',
    'votación', 'votacion',
  ],
  economia: [
    'dólar', 'dolar', 'inflación', 'inflacion', 'economía', 'economia',
    'fmi', 'bcra', 'mercado', 'finanzas', 'impuestos', 'subsidio',
    'deuda', 'pbi',
  ],
  deportes: [
    'fútbol', 'futbol', 'messi', 'selección', 'seleccion',
    'boca', 'river', 'mundial', 'liga', 'campeonato', 'gol', 'partido',
  ],
  policial: [
    'policía', 'policia', 'detenido', 'asesinato', 'robo',
    'crimen', 'delito', 'fiscal', 'justicia', 'juicio', 'cárcel', 'carcel',
  ],
  sociedad: [
    'salud', 'educación', 'educacion', 'protesta', 'marcha',
    'clima', 'temperatura', 'cultura',
  ],
};

/**
 * Category display metadata
 */
export const CATEGORY_META: Record<string, { emoji: string; label: string }> = {
  urgente:   { emoji: '🚨', label: 'URGENTE' },
  politica:  { emoji: '🗳️', label: 'Política' },
  economia:  { emoji: '💰', label: 'Economía' },
  deportes:  { emoji: '⚽', label: 'Deportes' },
  policial:  { emoji: '🚔', label: 'Policial' },
  sociedad:  { emoji: '🌎', label: 'Sociedad' },
  general:   { emoji: '📰', label: 'General' },
};

/**
 * Categorize a news article based on its title, summary, and source.
 *
 * @param title   - Article headline
 * @param summary - Article summary/body text (can be empty)
 * @param source  - News source identifier (not used currently, reserved for future)
 * @returns The best-matching category key
 */
export function categorizeArticle(
  title: string,
  summary: string,
  _source: string,
): string {
  const text = `${title} ${summary || ''}`.toLowerCase();

  const scores: Record<string, number> = {};
  let bestCategory = 'general';
  let bestScore = 0;

  for (const [category, keywords] of Object.entries(KEYWORD_MAPS)) {
    let score = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) {
        score++;
      }
    }
    scores[category] = score;
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return bestCategory;
}

/**
 * Get the Telegram caption prefix for a category.
 * e.g. "🚨 *URGENTE* |"
 */
export function formatCategoryBadge(category: string): string {
  const meta = CATEGORY_META[category] || CATEGORY_META.general;
  const label = category === 'urgente'
    ? `*${meta.label}*`
    : meta.label;
  return `${meta.emoji} ${label} |`;
}
