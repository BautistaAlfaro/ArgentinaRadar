/**
 * Hashtag generator for ArgentinaRadar Bluesky posts.
 *
 * Extracts keywords from article titles and maps them to
 * relevant Spanish hashtags for the Argentine context.
 *
 * @module hashtags
 */

// ---------------------------------------------------------------------------
// Keyword → Hashtag map
// ---------------------------------------------------------------------------

const KEYWORD_HASHTAG_MAP: Array<{ keywords: string[]; hashtag: string }> = [
  // Economy
  { keywords: ['dólar', 'dolar', 'inflación', 'inflacion', 'fmi', 'blue', 'bcra', 'economía', 'economia'], hashtag: '#EconomíaArgentina' },
  // Politics
  { keywords: ['milei', 'presidente', 'gobierno', 'casa rosada', 'congreso', 'senado', 'diputados', 'elecciones', 'política', 'politica'], hashtag: '#PolíticaAR' },
  // Sports
  { keywords: ['messi', 'selección', 'seleccion', 'fútbol', 'futbol', 'scaloneta', 'river', 'boca', 'primera división'], hashtag: '#FútbolArgentino' },
  // Weather
  { keywords: ['clima', 'tormenta', 'lluvia', 'temporal', 'alerta meteorológico', 'alerta'], hashtag: '#ClimaAR' },
  // Technology
  { keywords: ['tecnología', 'tecnologia', 'vaca muerta', 'litio', 'energía', 'energia', 'petróleo', 'petroleo', 'gas'], hashtag: '#TecnologíaAR' },
  // Society
  { keywords: ['sociedad', 'salud', 'educación', 'educacion', 'derechos', 'universidad'], hashtag: '#SociedadAR' },
  // Security
  { keywords: ['seguridad', 'policial', 'delito', 'robo', 'asalt', 'homicidio', 'detenido'], hashtag: '#SeguridadAR' },
  // International
  { keywords: ['internacional', 'mundo', 'eeuu', 'china', 'brasil', 'europa', 'guerra'], hashtag: '#InternacionalAR' },
  // Justice
  { keywords: ['justicia', 'juez', 'tribunal', 'corte suprema', 'fallo', 'condena'], hashtag: '#JusticiaAR' },
  // Agriculture
  { keywords: ['campo', 'agro', 'soja', 'trigo', 'maíz', 'maiz', 'ganadería', 'ganaderia'], hashtag: '#CampoAR' },
];

// Argentine provinces and major cities mapping
const LOCATION_MAP: Record<string, string> = {
  'buenos aires': '#BuenosAires',
  'caba': '#CABA',
  'capital federal': '#CABA',
  'córdoba': '#Córdoba',
  'cordoba': '#Córdoba',
  'santa fe': '#SantaFe',
  'mendoza': '#Mendoza',
  'tucumán': '#Tucumán',
  'tucuman': '#Tucumán',
  'entre ríos': '#EntreRíos',
  'entre rios': '#EntreRíos',
  'salta': '#Salta',
  'neuquén': '#Neuquén',
  'neuquen': '#Neuquén',
  'chubut': '#Chubut',
  'río negro': '#RíoNegro',
  'rio negro': '#RíoNegro',
  'misiones': '#Misiones',
  'corrientes': '#Corrientes',
  'santiago del estero': '#SgoDelEstero',
  'san juan': '#SanJuan',
  'jujuy': '#Jujuy',
  'la pampa': '#LaPampa',
  'catamarca': '#Catamarca',
  'la rioja': '#LaRioja',
  'santa cruz': '#SantaCruz',
  'tierra del fuego': '#TierraDelFuego',
  'formosa': '#Formosa',
  'chaco': '#Chaco',
  'san luis': '#SanLuis',
  'la plata': '#LaPlata',
  'rosario': '#Rosario',
  'mar del plata': '#MarDelPlata',
  'bariloche': '#Bariloche',
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate 2-3 relevant hashtags from an article title.
 *
 * Always includes `#ArgentinaRadar` as the primary tag, plus 1-2
 * contextual tags based on keyword matching against the title.
 *
 * @param title - The article headline.
 * @returns Array of hashtag strings (e.g. `["#ArgentinaRadar", "#EconomíaArgentina"]`).
 */
export function generateHashtags(title: string): string[] {
  const lower = title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const found: string[] = [];

  // Check keyword map
  for (const entry of KEYWORD_HASHTAG_MAP) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      if (!found.includes(entry.hashtag)) {
        found.push(entry.hashtag);
      }
    }
  }

  // Check location map (province/city names)
  for (const [name, tag] of Object.entries(LOCATION_MAP)) {
    if (lower.includes(name)) {
      if (!found.includes(tag)) {
        found.push(tag);
      }
    }
  }

  // Deduplicate: always #ArgentinaRadar first, then 1-2 contextual tags
  const result = ['#ArgentinaRadar', ...found.filter((t) => t !== '#ArgentinaRadar')];
  return result.slice(0, 3);
}

/**
 * Append auto-generated hashtags to a text, keeping it within a character limit.
 *
 * @param text      - The base post text.
 * @param title     - The article title (for keyword extraction).
 * @param maxLength - Maximum allowed length (default: 300 for Bluesky).
 * @returns Text with hashtags appended, truncated if needed.
 */
export function appendHashtags(text: string, title: string, maxLength: number = 300): string {
  const tags = generateHashtags(title);
  const tagStr = `\n\n${tags.join(' ')}`;

  // Text + tags fits → append
  if (text.length + tagStr.length <= maxLength) {
    return text + tagStr;
  }

  // Text fits but not with all tags → try fewer
  if (text.length <= maxLength) {
    const singleTag = `\n\n${tags[0]}`;
    if (text.length + singleTag.length <= maxLength) {
      return text + singleTag;
    }
    // No tags fit — return plain text
    return text;
  }

  // Text exceeds limit even without tags — truncate and add first tag
  const room = maxLength - tags[0].length - 2;
  const truncated = text.slice(0, Math.max(room, 0));
  return `${truncated}\n\n${tags[0]}`;
}
