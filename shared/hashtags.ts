/**
 * Hashtag generator for ArgentinaRadar Bluesky posts.
 *
 * Extracts keywords from article titles and maps them to
 * relevant Spanish hashtags for the Argentine context.
 *
 * Provides 30+ thematic hashtag categories plus province/city
 * detection. Always generates at most 3 hashtags per call.
 *
 * @module hashtags
 */

// ---------------------------------------------------------------------------
// Keyword → Hashtag map — 30+ trending Argentine hashtag categories
// ---------------------------------------------------------------------------

const KEYWORD_HASHTAG_MAP: Array<{ keywords: string[]; hashtag: string }> = [
  // Economy & Finance
  { keywords: ['dólar', 'dolar', 'inflación', 'inflacion', 'fmi', 'blue', 'bcra', 'economía', 'economia'], hashtag: '#EconomíaArgentina' },
  { keywords: ['merval', 'bolsa', 'acciones', 'mercado', 'finanzas', 'inversión', 'inversion'], hashtag: '#MercadoAR' },
  { keywords: ['tarifas', 'subsidio', 'aumento', 'precios', 'canasta básica', 'canasta basica'], hashtag: '#PreciosAR' },
  { keywords: ['dólar blue', 'dolar blue', 'dólar ccl', 'dolar ccl', 'dólar tarjeta', 'dolar tarjeta', 'dólar qatar', 'dolar qatar'], hashtag: '#DólarBlue' },
  { keywords: ['salario', 'sueldo', 'paritaria', 'convenio colectivo', 'aumento salarial'], hashtag: '#SalariosAR' },
  { keywords: ['jubilación', 'jubilacion', 'haberes', 'anses', 'moratoria'], hashtag: '#JubiladosAR' },

  // Politics & Government
  { keywords: ['milei', 'presidente', 'gobierno', 'casa rosada', 'congreso', 'senado', 'diputados', 'elecciones', 'política', 'politica'], hashtag: '#PolíticaAR' },
  { keywords: ['decreto', 'ley', 'dnu', 'votación', 'votacion', 'sesión', 'sesion', 'bicameral'], hashtag: '#LegislativoAR' },
  { keywords: ['oposición', 'oposicion', 'kirchner', 'peronismo', 'radical', 'coalición', 'coalicion', 'frente de todos'], hashtag: '#OposiciónAR' },
  { keywords: ['provincia', 'municipio', 'gobernador', 'intendente', 'gestión', 'gestion provincial'], hashtag: '#ProvinciasAR' },

  // International Relations
  { keywords: ['internacional', 'mundo', 'eeuu', 'china', 'brasil', 'europa', 'guerra', 'exterior'], hashtag: '#ArgentinaEnElMundo' },
  { keywords: ['mercosur', 'comercio exterior', 'exportación', 'exportacion', 'importación', 'importacion', 'aduana'], hashtag: '#ComercioAR' },
  { keywords: ['fmi', 'fondo monetario', 'deuda', 'acuerdo', 'stand by', 'desembolso'], hashtag: '#FMIAR' },

  // Sports
  { keywords: ['messi', 'selección', 'seleccion', 'fútbol', 'futbol', 'scaloneta', 'river', 'boca', 'primera división'], hashtag: '#FútbolArgentino' },
  { keywords: ['mundial', 'eliminatorias', 'copa', 'sudamericana', 'libertadores', 'champions'], hashtag: '#MundialAR' },
  { keywords: ['tenis', 'basquet', 'rugby', 'hockey', 'voley', 'boxeo', 'automovilismo', 'padel'], hashtag: '#DeportesAR' },
  { keywords: ['olimpíadas', 'olimpiadas', 'juegos olímpicos', 'juegos olimpicos', 'medalla', 'podio'], hashtag: '#JJOOAR' },

  // Security & Justice
  { keywords: ['seguridad', 'policial', 'delito', 'robo', 'asalt', 'homicidio', 'detenido'], hashtag: '#SeguridadAR' },
  { keywords: ['justicia', 'juez', 'tribunal', 'corte suprema', 'fallo', 'condena', 'sentencia'], hashtag: '#JusticiaAR' },
  { keywords: ['narcotráfico', 'narco', 'drogas', 'cartel', 'mafia', 'lavado de dinero', 'narcotrafico'], hashtag: '#NarcotráficoAR' },
  { keywords: ['cárcel', 'carcel', 'preso', 'penitenciario', 'libertad', 'indulto', 'reclusión'], hashtag: '#SistemaPenalAR' },

  // Society & Culture
  { keywords: ['sociedad', 'salud', 'educación', 'educacion', 'derechos', 'universidad'], hashtag: '#SociedadAR' },
  { keywords: ['cultura', 'espectáculo', 'espectaculo', 'cine', 'teatro', 'música', 'musica', 'show', 'recital'], hashtag: '#CulturaAR' },
  { keywords: ['protesta', 'manifestación', 'manifestacion', 'marcha', 'movilización', 'movilizacion', 'paro', 'huelga'], hashtag: '#MovilizaciónAR' },

  // Weather & Environment
  { keywords: ['clima', 'tormenta', 'lluvia', 'temporal', 'alerta meteorológico', 'alerta'], hashtag: '#ClimaAR' },
  { keywords: ['sequía', 'sequia', 'inundación', 'inundacion', 'incendio', 'calor', 'ola de calor', 'helada'], hashtag: '#ClimaExtremoAR' },
  { keywords: ['ambiente', 'ecología', 'ecologia', 'naturaleza', 'biodiversidad', 'contaminación', 'contaminacion'], hashtag: '#AmbienteAR' },

  // Technology & Energy
  { keywords: ['tecnología', 'tecnologia', 'vaca muerta', 'litio', 'energía', 'energia', 'petróleo', 'petroleo', 'gas'], hashtag: '#TecnologíaAR' },
  { keywords: ['ciencia', 'investigación', 'investigacion', 'conicet', 'innovación', 'innovacion', 'desarrollo'], hashtag: '#CienciaAR' },
  { keywords: ['internet', 'conectividad', 'fibra óptica', 'fibra optica', '5g', 'digital', 'aplicación', 'startup'], hashtag: '#DigitalAR' },

  // Agriculture & Production
  { keywords: ['campo', 'agro', 'soja', 'trigo', 'maíz', 'maiz', 'ganadería', 'ganaderia'], hashtag: '#CampoAR' },
  { keywords: ['cosecha', 'granos', 'exportaciones agro', 'producción', 'produccion rural', 'alimentos'], hashtag: '#AgroAR' },

  // Health & Education
  { keywords: ['hospital', 'médico', 'medico', 'vacuna', 'enfermedad', 'pandemia', 'covid', 'salud pública'], hashtag: '#SaludAR' },
  { keywords: ['educación', 'educacion', 'colegio', 'escuela', 'docente', 'alumno', 'universidad', 'facultad'], hashtag: '#EducaciónAR' },

  // Emergency
  { keywords: ['urgente', 'último momento', 'ultimo momento', 'emergencia', 'catástrofe', 'catastrofe', 'accidente', 'tragedia'], hashtag: '#UrgenteAR' },
  { keywords: ['terremoto', 'sismo', 'explosión', 'explosion', 'derrumbe', 'alud', 'evacuación', 'evacuacion'], hashtag: '#EmergenciaAR' },

  // Transport & Infrastructure
  { keywords: ['transporte', 'subte', 'colectivo', 'tren', 'ómnibus', 'omnibus', 'avión', 'avion', 'vuelo'], hashtag: '#TransporteAR' },
  { keywords: ['ruta', 'autopista', 'camino', 'obra pública', 'obra publica', 'infraestructura', 'vialidad'], hashtag: '#ObraPúblicaAR' },

  // Tourism
  { keywords: ['turismo', 'viaje', 'vacaciones', 'hotel', 'destino', 'patagonia', 'cataratas', 'iglazú'], hashtag: '#TurismoAR' },
  { keywords: ['verano', 'invierno', 'temporada', 'playa', 'montaña', 'costa atlántica', 'costa atlantica'], hashtag: '#TemporadaAR' },
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
 * Province/city mentions add location hashtags.
 *
 * **Maximum 3 hashtags total** — enforced by the `slice(0, 3)`.
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

  // Deduplicate: always #ArgentinaRadar first, then 1-2 contextual tags.
  // Max 3 total hashtags.
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
