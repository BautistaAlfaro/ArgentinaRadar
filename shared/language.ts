/**
 * Language Detector for ArgentinaRadar
 *
 * Hybrid keyword-based language detection using common word patterns.
 * Score-counting approach: the language with the most indicator matches wins.
 * Falls back to 'other' if the result is unclear.
 *
 * Languages: es (Spanish), en (English), pt (Portuguese), other
 */

const LANGUAGE_INDICATORS: Record<string, string[]> = {
  es: [
    'el', 'la', 'los', 'las', 'que', 'en', 'de', 'del', 'por', 'con',
    'para', 'como', 'pero', 'más', 'mas', 'este', 'esta', 'entre', 'sin',
    'sobre', 'también', 'tambien', 'donde', 'cuando', 'porque', 'muy',
    'todo', 'tras', 'según', 'segun', 'durante', 'hasta', 'contra',
    'ante', 'cada', 'otro', 'otra', 'sido', 'tiene', 'tienen', 'está',
    'esta', 'están', 'estan', 'han', 'hay', 'sea', 'solo', 'sólo',
  ],
  en: [
    'the', 'is', 'are', 'was', 'were', 'have', 'has', 'been', 'will',
    'would', 'could', 'should', 'this', 'that', 'with', 'from', 'they',
    'their', 'what', 'which', 'when', 'where', 'about', 'than', 'more',
    'also', 'after', 'said', 'according', 'while', 'because', 'those',
    'these', 'into', 'during', 'through', 'being', 'before', 'between',
    'against', 'under', 'after', 'over', 'some', 'such', 'only',
  ],
  pt: [
    'do', 'da', 'dos', 'das', 'não', 'nao', 'para', 'uma', 'com',
    'como', 'mais', 'mas', 'por', 'que', 'aos', 'das', 'pelos',
    'pelas', 'num', 'numa', 'dum', 'duma', 'nesse', 'nessa', 'aquele',
    'aquela', 'entre', 'sobre', 'também', 'tambem', 'muito', 'pode',
    'deve', 'está', 'estes', 'essas', 'pelas', 'senão', 'senao',
  ],
};

const MIN_SCORE = 2;
const MIN_CONFIDENCE_RATIO = 1.5;

/**
 * Detect the language of a given text.
 *
 * @param text - The text to analyze (title, summary, or combined)
 * @returns One of 'es', 'en', 'pt', or 'other'
 */
export function detectLanguage(text: string): 'es' | 'en' | 'pt' | 'other' {
  if (!text || text.trim().length < 10) {
    return 'other';
  }

  const normalized = text.toLowerCase();
  const words = normalized.split(/[\s,.;:!?¡¿()\-'"]+/).filter(Boolean);

  const scores: Record<string, number> = { es: 0, en: 0, pt: 0 };

  for (const word of words) {
    for (const [lang, indicators] of Object.entries(LANGUAGE_INDICATORS)) {
      if (indicators.includes(word)) {
        scores[lang]++;
      }
    }
  }

  // Find the top score
  let bestLang: 'es' | 'en' | 'pt' | 'other' = 'other';
  let bestScore = 0;
  let secondScore = 0;

  for (const [lang, score] of Object.entries(scores)) {
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      bestLang = lang as 'es' | 'en' | 'pt';
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  // Must meet minimum score and have a clear margin over second place
  if (bestScore >= MIN_SCORE && (secondScore === 0 || bestScore / secondScore >= MIN_CONFIDENCE_RATIO)) {
    return bestLang;
  }

  return 'other';
}

/**
 * Check if text is likely non-Spanish and needs translation.
 */
export function needsTranslation(text: string): boolean {
  const lang = detectLanguage(text);
  return lang !== 'es' && lang !== 'other';
}
