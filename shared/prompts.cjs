/**
 * Category-specific prompt templates for Gemini image generation.
 *
 * CommonJS version for Node.js services (telegram-notifier, etc.)
 *
 * Each category has a curated scene style, mood, and visual language
 * tailored to Argentine news journalism. Designed for Bloomberg/Reuters
 * premium aesthetic: dark navy (#07111F) + electric blue (#00A3FF).
 *
 * Usage:
 *   const { buildCategoryPrompt, getCategoryConfig, NEWS_CATEGORIES } = require('../../shared/prompts.cjs');
 *
 *   const prompt = buildCategoryPrompt('economia', 'El dólar blue superó los $1400', 'Ámbito Financiero');
 *   const config = getCategoryConfig('urgente');
 */

/** @typedef {'economia'|'politica'|'deportes'|'policial'|'urgente'|'sociedad'|'general'} NewsCategory */

/** @type {NewsCategory[]} */
const NEWS_CATEGORIES = [
  'economia',
  'politica',
  'deportes',
  'policial',
  'urgente',
  'sociedad',
  'general',
];

/** @type {Object<NewsCategory, {badge:string, emoji:string, mood:string, sceneStyle:string, visualElements:string[], lighting:string, composition:string, colorAccent:string}>} */
const CATEGORY_CONFIGS = {
  economia: {
    badge: '📈 ECONOMÍA',
    emoji: '💰',
    mood: 'Serious, analytical, data-driven',
    sceneStyle: 'Financial district, stock exchange trading floor, exchange house (cueva), graphs on screens',
    visualElements: [
      'blue and green financial charts with upward/downward trends',
      'LED ticker showing ARS/USD exchange rates',
      'people lined up at exchange houses',
      'Casa Rosada economic announcement backdrop',
      'stacked Argentine peso bills',
    ],
    lighting: 'Cold dramatic lighting with deep blue undertones, rim-lit subjects',
    composition: 'Dynamic split — data visualization on one side, human element on the other',
    colorAccent: '#00A3FF',
  },
  politica: {
    badge: '🇦🇷 POLÍTICA',
    emoji: '🗳️',
    mood: 'Dramatic, consequential, national importance',
    sceneStyle: 'Congress building exterior, Casa Rosada balcony, press conference room, legislative session',
    visualElements: [
      'Argentine flags waving',
      'podium with microphone array and press credentials',
      'legislators debating in chamber',
      'official government building facades at golden hour',
      'political rally crowd silhouettes',
    ],
    lighting: 'Contrasted chiaroscuro — warm key light, cool shadows for gravitas',
    composition: 'Wide establishing shot with central authoritative figure or iconic building',
    colorAccent: '#0055FF',
  },
  deportes: {
    badge: '⚽ DEPORTES',
    emoji: '⚽',
    mood: 'Energetic, passionate, celebratory',
    sceneStyle: 'Football stadium packed with fans, action on the pitch, celebration moments',
    visualElements: [
      'crowd waving Argentine flags and colored flares',
      'players in action — goal celebration or tense moment',
      'stadium lights illuminating the pitch at night',
      'trophy or championship imagery',
      'sports journalism graphics with stats overlay',
    ],
    lighting: 'Bright stadium floodlights with high contrast, dramatic shadows on faces',
    composition: 'Dynamic action shot with motion blur, low angle for heroism',
    colorAccent: '#FF6B00',
  },
  policial: {
    badge: '🚔 POLICIAL',
    emoji: '🚔',
    mood: 'Urgent, tense, investigative',
    sceneStyle: 'Crime scene with police tape, patrol car lights, forensic team at work',
    visualElements: [
      'yellow crime scene tape (cinta policial)',
      'police cars with flashing red and blue lights',
      'forensic investigators in white suits',
      'nighttime urban street with emergency lighting',
      'security camera angle aesthetic',
    ],
    lighting: 'High-contrast noir — alternating red/blue emergency lights, deep shadows',
    composition: 'Cinematic close-up of investigation with bokeh light streaks from patrol cars',
    colorAccent: '#FF2200',
  },
  urgente: {
    badge: '🚨 URGENTE',
    emoji: '🚨',
    mood: 'Urgent, breaking, time-critical',
    sceneStyle: 'Breaking news studio, live broadcast setup, urgent press conference, emergency scene',
    visualElements: [
      'BREAKING NEWS red banner overlay',
      'news anchor desk with urgent expression',
      'live feed frame with countdown timer',
      'emergency vehicles with flashing lights',
      'dramatic sky — storm, sunset, or smoke',
    ],
    lighting: 'High-impact — alternating red alert washes and cool blue, pulsing urgency',
    composition: 'Centered bold composition with diagonal energy lines, red accents framing the subject',
    colorAccent: '#FF0044',
  },
  sociedad: {
    badge: '🌎 SOCIEDAD',
    emoji: '🌎',
    mood: 'Human, warm, community-focused',
    sceneStyle: 'Everyday Argentine life — street scenes, hospital, school, marketplace, protest or celebration',
    visualElements: [
      'people in daily routines at Plaza de Mayo or subte',
      'hospital workers or classroom scenes',
      'community gathering or neighborhood street',
      'social movement with banners and flags',
      'urban landscape at golden hour with obelisco silhouette',
    ],
    lighting: 'Natural golden hour light with warm tones, human-centric softness',
    composition: 'Eye-level documentary style, intimate framing with environmental context',
    colorAccent: '#FFB800',
  },
  general: {
    badge: '📰 GENERAL',
    emoji: '📰',
    mood: 'Professional, neutral, authoritative',
    sceneStyle: 'Newsroom environment, modern office, versatile urban backdrop',
    visualElements: [
      'clean newsroom with monitors displaying headlines',
      'modern office building or urban street',
      'professional journalism workspace',
      'neutral background with subtle Argentina imagery',
      'minimalist composition with text overlay space',
    ],
    lighting: 'Balanced studio lighting — soft key, neutral fill, subtle rim',
    composition: 'Clean centered or rule-of-thirds, professional and versatile for any news topic',
    colorAccent: '#00A3FF',
  },
};

/**
 * Clean the title for embedding in prompts.
 * @param {string} title
 * @returns {string}
 */
function sanitizeTitle(title) {
  return title
    .substring(0, 120)
    .replace(/[*_`[\]()#+-.!]/g, '')
    .trim();
}

/**
 * Build the full prompt string for a given category, title, and source.
 *
 * @param {string} category  News category key
 * @param {string} title     Article headline
 * @param {string} source    Source name (e.g. "Infobae", "Clarín")
 * @returns {string}         Full prompt string ready for Gemini image generation
 */
function buildCategoryPrompt(category, title, source) {
  const config = CATEGORY_CONFIGS[category] || CATEGORY_CONFIGS.general;
  const cleanTitle = sanitizeTitle(title);

  return `Create a professional breaking news graphic for "Argentina Radar".

STYLE:
- Bloomberg + Reuters + CNN premium journalism aesthetic
- Dark navy background (#07111F) with electric blue accents (${config.colorAccent})
- ${config.mood}
- White typography, high contrast, ultra sharp
- Photorealistic, 4K quality, cinematic depth of field
- ${config.lighting}

CATEGORY: ${config.badge}

SCENE:
A powerful editorial scene showing: ${config.sceneStyle}
Key visual elements: ${config.visualElements.join(', ')}.
The scene should feel authentic to Argentine journalism — credible, professional, and immediate.

LAYOUT:
TOP BAR:
- "Argentina Radar" logo in white, left-aligned
- Small timestamp and "${source}" top-right
- Thin ${config.colorAccent} separator line

MAIN IMAGE (70% of canvas):
- ${config.composition}
- ${config.sceneStyle}
- Professional news agency photography style

HEADLINE PANEL:
- Semi-transparent dark overlay at bottom third
- Category badge: ${config.badge}
- Large bold headline: "${cleanTitle}"

FOOTER:
- "Argentina Radar — @ArgentinaRadar" branding
- Subtle radar icon or wave motif
- Dark navy solid bar with white text

CRITICAL RULES:
- NO watermarks or logos from other media outlets
- NO blurry or unreadable text
- NO excessive lens flare or effects
- Looks like a REAL Reuters/Bloomberg news card
- Optimized for social media engagement
- Professional journalistic appearance — credible and authoritative`;
}

/**
 * Get the category config for a given category key.
 * Falls back to 'general' if the category is unknown.
 *
 * @param {string} category  News category key
 * @returns {Object}         Category configuration object
 */
function getCategoryConfig(category) {
  return CATEGORY_CONFIGS[category] || CATEGORY_CONFIGS.general;
}

module.exports = { buildCategoryPrompt, getCategoryConfig, NEWS_CATEGORIES };
