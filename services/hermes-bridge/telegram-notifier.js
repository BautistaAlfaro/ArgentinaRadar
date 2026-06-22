/**
 * Telegram Approval Notifier — ArgentinaRadar
 * 
 * Polls approval_queue, generates nanoBanana news thumbnails,
 * sends to Telegram with inline approve/reject buttons, and
 * handles callbacks to publish on Bluesky with images.
 * 
 * Also serves as the Telegram bot command handler (menu, stats, etc.)
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', 'config', '.env') });
const { API } = require('../../shared/apiConfig.cjs');
const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const { addAlert, removeAlert, listAlerts, PROVINCES } = require('./alerts');
const { sendMorningBriefing, checkAndSendBriefing } = require('./morning-briefing.js');
const scheduleManager = require('../../shared/scheduleManager');
const { buildCategoryPrompt } = require('../../shared/prompts.cjs');
const fs = require('fs');
const { MSG } = require('../../shared/messages.es');

// ─── OpenRouter Image Generation (Gemini) ─────────────────────────────

async function generateImageViaOpenRouter(prompt, articleId) {
  if (!OPENROUTER_KEY || OPENROUTER_KEY === 'your_openrouter_key') return null;

  // Check cache first if articleId provided
  if (articleId) {
    const cached = readImageFromCache(articleId);
    if (cached) return cached;
  }

  try {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENROUTER_KEY}` },
      body: JSON.stringify({
        model: 'google/gemini-3-pro-image',
        messages: [{ role: 'user', content: prompt }],
        modalities: ['image', 'text'],
        max_tokens: 4096,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const img = data.choices?.[0]?.message?.images?.[0];
    if (!img?.image_url?.url) return null;
    // Convert base64 data URL to Buffer for upload
    const b64 = img.image_url.url.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(b64, 'base64');
    console.log('[gemini] Generated image:', (buffer.length / 1024).toFixed(0) + 'KB');

    // Save to cache if articleId provided
    if (articleId) saveImageToCache(articleId, buffer);

    return { buffer, mimeType: 'image/png' };
  } catch (e) {
    console.warn('[gemini] Image generation failed:', e.message);
    return null;
  }
}

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'mistralai/mistral-nemo';

async function enhancePrompt(title, source, category) {
  if (!OPENROUTER_KEY || OPENROUTER_KEY === 'your_openrouter_key') return null;
  try {
    const catBadge = category === 'urgente' ? '🚨 URGENTE' : category === 'politica' ? '🇦🇷 POLÍTICA' :
      category === 'economia' ? '📈 ECONOMÍA' : category === 'deportes' ? '⚽ DEPORTES' : '🌎 INTERNACIONAL';
    
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENROUTER_KEY}` },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [{
          role: 'system',
          content: `You are an expert news graphics designer. Create a SINGLE PARAGRAPH image generation prompt for a breaking news graphic titled "Argentina Radar".
STYLE: Dark navy background (#07111F), electric blue accents (#00A3FF), Bloomberg/Reuters premium journalism aesthetic, dramatic lighting, photorealistic, 4K quality.
Include: category badge "${catBadge}", headline, realistic editorial scene. NO watermarks, NO logos from other outlets. Output ONLY the prompt, no explanation.`
        }, {
          role: 'user',
          content: `Create an image generation prompt for this news:\nTitle: "${title}"\nSource: ${source}\nCategory: ${catBadge}\n\nGenerate a one-paragraph prompt describing the scene.`
        }],
        max_tokens: 300, temperature: 0.7
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const prompt = data.choices?.[0]?.message?.content?.trim();
    if (prompt) console.log('[openrouter] Enhanced prompt for', title.slice(0, 40));
    return prompt || null;
  } catch (e) {
    console.warn('[openrouter] Prompt enhancement failed:', e.message);
    return null;
  }
}

// ─── Markdown escaping helpers ────────────────────────────────────────
function escapeMd(t) { return (t || '').replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1'); }
function b(t) { return '*' + escapeMd(t) + '*'; }
function i(t) { return '_' + escapeMd(t) + '_'; }
function link(d, u) { return '[' + escapeMd(d) + '](' + (u || '') + ')'; }

// ─── Image Cache ────────────────────────────────────────────────────────

function ensureImageCacheDir() {
  if (!fs.existsSync(IMAGE_CACHE_DIR)) {
    fs.mkdirSync(IMAGE_CACHE_DIR, { recursive: true });
  }
}

function getImageCachePath(articleId) {
  return path.join(IMAGE_CACHE_DIR, `${articleId}.png`);
}

function readImageFromCache(articleId) {
  try {
    const cachePath = getImageCachePath(articleId);
    if (fs.existsSync(cachePath)) {
      const stats = fs.statSync(cachePath);
      if (Date.now() - stats.mtimeMs < 7 * 24 * 60 * 60 * 1000) {
        const buffer = fs.readFileSync(cachePath);
        console.log(`[cache] HIT ${articleId.slice(0, 8)} (${(buffer.length / 1024).toFixed(0)}KB)`);
        return { buffer, mimeType: 'image/png' };
      }
      console.log(`[cache] EXPIRED ${articleId.slice(0, 8)} — older than 7 days`);
    }
    return null;
  } catch (e) {
    console.warn(`[cache] Read error ${articleId.slice(0, 8)}: ${e.message}`);
    return null;
  }
}

function saveImageToCache(articleId, buffer) {
  try {
    ensureImageCacheDir();
    const cachePath = getImageCachePath(articleId);
    fs.writeFileSync(cachePath, buffer);
    console.log(`[cache] SAVED ${articleId.slice(0, 8)} (${(buffer.length / 1024).toFixed(0)}KB)`);
  } catch (e) {
    console.warn(`[cache] Write error ${articleId.slice(0, 8)}: ${e.message}`);
  }
}

const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'argentina-radar.db');
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) { console.error('FATAL: TELEGRAM_BOT_TOKEN no configurado'); process.exit(1); }
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const POLL_INTERVAL = 10000; // 10 seconds

const db = new Database(DB_PATH);

// ─── Image Provider Config ───────────────────────────────────────────

const IMAGE_PROVIDER = (process.env.IMAGE_PROVIDER || 'auto').toLowerCase();
const IMAGE_CACHE_DIR = path.resolve(__dirname, '..', '..', 'data', 'images');

// ─── NanoBanana Prompt Builder ──────────────────────────────────────────

/**
 * Build a rich NanoBanana-style image prompt for Pollinations.ai.
 * 
 * Style: Only Fonseca (dramático, alto contraste) + MDZ Online (limpio, periodístico).
 * Colors: dark blue #003087 + gold #FFD700. Horizontal 16:9 news thumbnail.
 */
function buildNanoBananaPrompt(title, source, category) {
  const headline = title.substring(0, 120).replace(/[*_`[\]()#+-.!]/g, '');
  const scene = title.substring(0, 150).replace(/[*_`[\]()#+-.!]/g, '');
  const catBadge = category === 'urgente' ? '🚨 URGENTE' : category === 'politica' ? '🇦🇷 POLÍTICA' :
    category === 'economia' ? '📈 ECONOMÍA' : category === 'deportes' ? '⚽ DEPORTES' : '🌎 INTERNACIONAL';
  
  // Base template — used when OpenRouter fails or is unavailable
  return `Create a professional breaking news graphic for "Argentina Radar".

STYLE:
- Modern newsroom design
- Bloomberg + Reuters + CNN aesthetic
- Premium journalism look
- Dark navy background (#07111F)
- Electric blue accents (#00A3FF)
- White typography
- High contrast
- Clean composition
- Realistic press photography
- Ultra sharp
- 4K quality

LAYOUT:

TOP BAR:
- Argentina Radar logo
- Small timestamp
- Thin blue separator line

MAIN IMAGE:
- Occupies 70% of the canvas
- Realistic editorial photograph showing: ${scene}
- Professional news agency style
- Cinematic lighting
- Authentic and credible

HEADLINE PANEL:
- Semi-transparent dark overlay
- Category badge: ${catBadge}
- Large bold headline: "${headline}"

FOOTER:
- Argentina Radar branding
- @ArgentinaRadar
- Subtle radar icon

IMPORTANT:
- No watermarks
- No logos from other media outlets
- No blurry text
- No excessive effects
- Professional journalistic appearance
- Looks like a real Reuters/Bloomberg news card
- Optimized for social media engagement`;
}

// Async version that uses OpenRouter to enhance the prompt
async function buildEnhancedPrompt(title, source, category) {
  const enhanced = await enhancePrompt(title, source, category);
  return enhanced || buildNanoBananaPrompt(title, source, category);
}

// ─── Bluesky Tweet Formatter ────────────────────────────────────────────

/**
 * Keyword → hashtag map for Argentine news context.
 */
const HASHTAG_KEYWORDS = [
  { keywords: ['dólar', 'dolar', 'inflación', 'inflacion', 'fmi', 'blue', 'bcra', 'economía', 'economia'], tag: '#EconomíaArgentina' },
  { keywords: ['milei', 'presidente', 'gobierno', 'casa rosada', 'congreso', 'elecciones', 'política', 'politica'], tag: '#PolíticaAR' },
  { keywords: ['messi', 'selección', 'seleccion', 'fútbol', 'futbol', 'scaloneta', 'river', 'boca'], tag: '#FútbolArgentino' },
  { keywords: ['clima', 'tormenta', 'lluvia', 'temporal', 'alerta'], tag: '#ClimaAR' },
  { keywords: ['tecnología', 'tecnologia', 'vaca muerta', 'litio', 'energía', 'energia', 'petróleo', 'petroleo'], tag: '#TecnologíaAR' },
  { keywords: ['sociedad', 'salud', 'educación', 'educacion', 'derechos'], tag: '#SociedadAR' },
  { keywords: ['seguridad', 'policial', 'delito', 'robo', 'homicidio', 'detenido'], tag: '#SeguridadAR' },
  { keywords: ['internacional', 'mundo', 'eeuu', 'china', 'brasil', 'europa'], tag: '#InternacionalAR' },
  { keywords: ['justicia', 'juez', 'tribunal', 'corte suprema', 'fallo'], tag: '#JusticiaAR' },
  { keywords: ['campo', 'agro', 'soja', 'trigo', 'maíz', 'maiz', 'ganadería', 'ganaderia'], tag: '#CampoAR' },
];

const LOCATION_HASHTAGS = {
  'buenos aires': '#BuenosAires', 'caba': '#CABA', 'capital federal': '#CABA',
  'córdoba': '#Córdoba', 'cordoba': '#Córdoba', 'santa fe': '#SantaFe',
  'mendoza': '#Mendoza', 'tucumán': '#Tucumán', 'tucuman': '#Tucumán',
  'entre ríos': '#EntreRíos', 'entre rios': '#EntreRíos', 'salta': '#Salta',
  'neuquén': '#Neuquén', 'neuquen': '#Neuquén', 'la plata': '#LaPlata',
  'rosario': '#Rosario', 'mar del plata': '#MarDelPlata',
};

/**
 * Generate 2-3 relevant hashtags from an article title.
 */
function generateHashtags(title) {
  const lower = title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const found = [];

  for (const entry of HASHTAG_KEYWORDS) {
    if (entry.keywords.some(kw => lower.includes(kw)) && !found.includes(entry.tag)) {
      found.push(entry.tag);
    }
  }

  for (const [name, tag] of Object.entries(LOCATION_HASHTAGS)) {
    if (lower.includes(name) && !found.includes(tag)) {
      found.push(tag);
    }
  }

  return ['#ArgentinaRadar', ...found.filter(t => t !== '#ArgentinaRadar')].slice(0, 3);
}

// ─── Rewrite API ─────────────────────────────────────────────────────────

const AI_API = process.env.AI_API || API.ai;
const REWRITE_HEADLINES = process.env.REWRITE_HEADLINES === 'true';

/**
 * Optionally rewrite a headline via the AI Processor /api/rewrite endpoint.
 * Falls back to the original title if the API is unavailable or rewriting
 * is disabled via the REWRITE_HEADLINES env var.
 */
async function maybeRewriteHeadline(title, source, category) {
  if (!REWRITE_HEADLINES) return title;
  try {
    const resp = await fetch(`${AI_API}/api/rewrite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, source, category }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return title;
    const data = await resp.json();
    return data.rewritten_title || title;
  } catch (e) {
    console.warn(`[rewrite] API unavailable — using original title: ${e.message}`);
    return title;
  }
}

/**
 * Format article text for Bluesky (300 char limit).
 * 
 * Format: 🇦🇷 {headline} | 📰 {source} | {category_emoji}
 *         #Hashtags
 * 
 * Auto-generates 2-3 hashtags from the article title.
 * Accepts an optional rewrittenTitle to use instead of the original.
 */
function formatBlueskyTweet(title, source, category, rewrittenTitle) {
  const useTitle = rewrittenTitle || title;
  const catEmoji = category === 'urgente' ? '🚨' : category === 'politica' ? '🗳️' :
    category === 'economia' ? '💰' : category === 'deportes' ? '⚽' :
    category === 'policial' ? '🚔' : category === 'sociedad' ? '🌎' : '📰';
  
  // Generate hashtags from original title (keywords are better for matching)
  const hashtags = generateHashtags(title);
  const tagsStr = hashtags.join(' ');
  
  // Build suffix: source + emoji only (no manual category tag — hashtags replace it)
  const suffix = `\n\n📌 ${source} | ${catEmoji}`;
  const tagLine = `\n${tagsStr}`;
  
  // Total overhead: suffix + tagLine
  const header = '🇦🇷 ';
  const overhead = header.length + suffix.length + tagLine.length;
  const maxHeadline = 300 - overhead;
  
  // Smart truncation: cut at last space before limit
  let headline = useTitle.trim();
  if (headline.length > maxHeadline) {
    headline = headline.substring(0, Math.max(maxHeadline - 3, 0));
    const lastSpace = headline.lastIndexOf(' ');
    if (lastSpace > maxHeadline * 0.7 && lastSpace > 0) headline = headline.substring(0, lastSpace);
    headline += '...';
  }
  
  return `${header}${headline}${suffix}${tagLine}`;
}

// ─── Bluesky Publish Helper ───────────────────────────────────────────

/**
 * Publish a post to Bluesky via the twitter-publisher service.
 * @param {string} articleId
 * @param {string} text
 * @param {string|null} imageUrl
 * @param {string|null} url
 * @returns {Promise<{success: boolean, error: string|null}>}
 */
async function publishToBluesky(articleId, text, imageUrl, url) {
  // 🔒 GUARD: never publish without generated image
  if (!imageUrl) {
    console.warn(`[bluesky] 🚫 Skipped ${articleId.slice(0, 8)} — no image`);
    return { success: false, error: 'Sin imagen generada — publicación bloqueada' };
  }
  const doPub = async (label) => {
      const resp = await fetch(`${API.publisher}/api/publish-text`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ article_id: articleId, text, image_url: imageUrl || null, url: url || null }),
      signal: AbortSignal.timeout(15000),
    });
    const result = await resp.json();
    if (result.success) { console.log(`[bluesky] ✅ Published ${articleId.slice(0, 8)}${label}`); return { success: true, error: null }; }
    console.warn(`[bluesky] ❌ Failed ${articleId.slice(0, 8)}${label}: ${result.error || 'unknown'}`);
    return { success: false, error: result.error || 'Error desconocido' };
  };
  try {
    const first = await doPub('');
    if (first.success) return first;
    console.warn('[bluesky] ❌ Error al publicar en Bluesky. Reintentando...');
    await new Promise(r => setTimeout(r, 3000));
    return await doPub(' (retry)');
  } catch (e) {
    console.warn(`[bluesky] Error de red ${articleId.slice(0, 8)}: ${e.message}. Reintentando...`);
    await new Promise(r => setTimeout(r, 3000));
    try { return await doPub(' (retry)'); } catch (e2) {
      console.error(`[bluesky] ❌ Error al publicar en Bluesky tras reintento: ${e2.message}`);
      return { success: false, error: e2.message };
    }
  }
}

// ─── Telegram API helpers ───────────────────────────────────────────────

async function sendToTelegram(text, keyboard, retries = 1) {
  for (let a = 0; a <= retries; a++) {
    try {
      const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: parseInt(CHAT_ID), text, parse_mode: 'Markdown', reply_markup: keyboard || undefined }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await resp.json();
      if (data.ok) return data;
      console.error('[telegram] API error (attempt ' + (a + 1) + '/3):', data.description);
    } catch (e) {
      console.error('[telegram] Network error (attempt ' + (a + 1) + '/3):', e.message);
    }
    if (a < retries) await new Promise(r => setTimeout(r, 2000));
  }
  return null;
}

async function sendPhoto(caption, imageUrl, keyboard) {
  const body = JSON.stringify({
    chat_id: parseInt(CHAT_ID),
    photo: imageUrl,
    caption: caption,
    parse_mode: 'Markdown',
    reply_markup: keyboard || undefined,
  });
  try {
    const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body,
    });
    return await resp.json();
  } catch (e) {
    console.error('Telegram photo error:', e.message);
    return null;
  }
}

async function checkPendingApprovals() {
  try {
    const pending = db.prepare(
      `SELECT aq.id, aq.article_id, aq.draft_tweet, n.title, n.source, n.category, n.url
       FROM approval_queue aq 
       JOIN news_items n ON aq.article_id = n.id 
       WHERE aq.status = 'pending' AND (aq.telegram_message_id IS NULL OR aq.telegram_message_id = 0)
       LIMIT 3`
    ).all();

    if (pending.length === 0) return;

    console.log(`Found ${pending.length} pending approvals`);

    for (const entry of pending) {
      // 🔒 DEDUP: delete any other pending entries for the same article
      db.prepare(
        `DELETE FROM approval_queue WHERE article_id = ? AND id != ? AND status = 'pending'`
      ).run(entry.article_id, entry.id);

      // Build prompt + image URL
      const category = entry.category || 'general';

      // Pre-cache Gemini image if configured (ready for when article is approved)
      const geminiPrompt = buildCategoryPrompt(category, entry.title, entry.source);
      if (IMAGE_PROVIDER === 'gemini' || IMAGE_PROVIDER === 'auto') {
        generateImageViaOpenRouter(geminiPrompt, entry.article_id).catch(() => {});
      }

      const nanoPrompt = await buildEnhancedPrompt(entry.title, entry.source, category);
      const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(nanoPrompt)}?width=1080&height=1350&nologo=true&seed=${Math.floor(Math.random() * 1000)}`;

      // Save image_url for later Bluesky publish
      db.prepare('UPDATE approval_queue SET image_url = ?, image_prompt = ? WHERE id = ?')
        .run(imageUrl, nanoPrompt, entry.id);

      // Build category badge
      const catMeta = {
        urgente:   { emoji: '🚨', label: '*URGENTE*' },
        politica:  { emoji: '🗳️', label: 'Política' },
        economia:  { emoji: '💰', label: 'Economía' },
        deportes:  { emoji: '⚽', label: 'Deportes' },
        policial:  { emoji: '🚔', label: 'Policial' },
        sociedad:  { emoji: '🌎', label: 'Sociedad' },
      };
      const m = catMeta[category] || { emoji: '📰', label: 'General' };
      const catBadge = `${m.emoji} ${m.label}`;

      const caption = [
        `${catBadge} | *${entry.title}*`,
        ``,
        `📌 ${entry.source} | #ArgentinaRadar`,
      ].join('\n');

      const keyboard = {
        inline_keyboard: [[
          { text: MSG.BTN_APPROVE, callback_data: `approve:${entry.article_id}` },
          { text: MSG.BTN_SCHEDULE, callback_data: `schedule:${entry.article_id}` },
          { text: MSG.BTN_REJECT, callback_data: `reject:${entry.article_id}` },
        ], [
          { text: MSG.BTN_SOURCE, url: entry.url },
        ]]
      };

      const result = await sendPhoto(caption, imageUrl, keyboard);
      
      if (result && result.ok && result.result?.message_id) {
        db.prepare(
          'UPDATE approval_queue SET telegram_message_id = ? WHERE id = ?'
        ).run(result.result.message_id, entry.id);
        
        console.log(`🖼️  Sent approval for ${entry.article_id.slice(0, 8)} (msg ${result.result.message_id})`);
      } else {
        console.error('Failed to send:', JSON.stringify(result?.description || result));
      }

      // Rate limit: 2 seconds between sends (images take longer)
      await new Promise(r => setTimeout(r, 2000));
    }
  } catch (e) {
    console.error('Check error:', e.message);
  }
}

// ─── Trending / Clusters helpers ───────────────────────────────────────

const NEWS_SERVICE_URL = API.news;

async function fetchTrending() {
  try {
    const resp = await fetch(`${NEWS_SERVICE_URL}/api/trending?hours=24`, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

async function fetchClusters() {
  try {
    const resp = await fetch(`${NEWS_SERVICE_URL}/api/clusters?hours=24`, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

// ─── Menus ────────────────────────────────────────────────────────────

const MAIN_MENU = {
  inline_keyboard: [
    [{ text: '🚨 Breaking News', callback_data: 'menu:breaking' }],
    [{ text: '📈 Trending', callback_data: 'menu:trending' }],
    [{ text: '🔔 Alertas', callback_data: 'menu:alerts' }],
    [
      { text: '📰 Revisión Pendiente', callback_data: 'menu:pending' },
      { text: '📊 Estadísticas', callback_data: 'menu:stats' },
    ],
    [
      { text: '🔍 Buscar Noticia', callback_data: 'menu:search' },
      { text: '🔗 Ver Bluesky', url: 'https://bsky.app/profile/sitearsdevs.bsky.social' },
    ],
    [
      { text: '⚙️ Servicios', callback_data: 'menu:services' },
      { text: MSG.BTN_SCHEDULE, callback_data: 'menu:scheduler' },
    ],
    [
      { text: '📋 Últimas 24hs', callback_data: 'menu:today' },
      { text: '❓ Ayuda', callback_data: 'menu:help' },
    ],
  ]
};

// ─── Message editing helper ────────────────────────────────────────────
async function editMessageText(chatId, messageId, text, keyboard) {
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: 'Markdown', reply_markup: keyboard || undefined })
  });
}

// ─── Command helpers: search / today / fuentes ────────────────────────

function searchArticles(term) {
  const like = `%${term}%`;
  return db.prepare(
    `SELECT id, title, source, url, category FROM news_items
     WHERE title LIKE ? ORDER BY ingested_at DESC LIMIT 5`
  ).all(like);
}

function todayArticles() {
  return db.prepare(
    `SELECT id, title, source, url FROM news_items
     WHERE ingested_at >= datetime('now','-1 day')
     ORDER BY CAST(ai_score AS REAL) DESC, ingested_at DESC LIMIT 5`
  ).all();
}

function sourceStats() {
  return db.prepare(
    `SELECT source, COUNT(*) c FROM news_items GROUP BY source ORDER BY c DESC`
  ).all();
}

// ─── Article info display ────────────────────────────────────────────

async function showArticleInfo(chatId, messageId, articleId) {
  const article = db.prepare('SELECT id, title, source, url, category, status FROM news_items WHERE id = ?').get(articleId);
  if (!article) {
    return editMessageText(chatId, messageId, '❌ *Artículo no encontrado*', {
      inline_keyboard: [[{ text: MSG.BTN_BACK, callback_data: 'menu:pending' }]]
    });
  }

  const text = `📰 *${article.title}*\n\n📌 *Fuente:* ${article.source}\n🏷️ *Categoría:* ${article.category || 'general'}\n🔗 [Ver artículo](${article.url})`;

  const buttons = [];
  const isPending = db.prepare(
    "SELECT id FROM approval_queue WHERE article_id = ? AND status = 'pending' LIMIT 1"
  ).get(articleId);

  if (isPending) {
    buttons.push([
      { text: MSG.BTN_APPROVE, callback_data: `approve:${article.id}` },
      { text: MSG.BTN_REJECT, callback_data: `reject:${article.id}` },
      { text: MSG.BTN_SOURCE, url: article.url },
    ]);
  } else {
    buttons.push([{ text: MSG.BTN_SOURCE, url: article.url }]);
  }
  buttons.push([{ text: MSG.BTN_BACK, callback_data: 'menu:pending' }]);

  return editMessageText(chatId, messageId, text, { inline_keyboard: buttons });
}

function statsKeyboard() {
  const total = db.prepare('SELECT COUNT(*) c FROM news_items').get().c;
  const pending = db.prepare("SELECT COUNT(*) c FROM approval_queue WHERE status = 'pending'").get().c;
  const approved = db.prepare("SELECT COUNT(*) c FROM approval_queue WHERE status = 'approved'").get().c;
  const published = db.prepare("SELECT COUNT(*) c FROM news_items WHERE status = 'published'").get().c;
  return {
    text: `📊 *ArgentinaRadar Stats*\n\n` +
      `📰 Artículos totales: *${total}*\n` +
      `⏳ Pendientes: *${pending}*\n` +
      `✅ Aprobados: *${approved}*\n` +
      `🚀 Publicados: *${published}*`,
    keyboard: { inline_keyboard: [[{ text: MSG.BTN_BACK, callback_data: 'menu:main' }]] }
  };
}

function pendingKeyboard(page = 0) {
  const limit = 5;
  const offset = page * limit;
  const total = db.prepare(
    "SELECT COUNT(*) c FROM approval_queue WHERE status = 'pending' AND telegram_message_id IS NOT NULL AND telegram_message_id > 0"
  ).get().c;

  const pending = db.prepare(
    `SELECT aq.article_id, n.title, n.source FROM approval_queue aq
     JOIN news_items n ON aq.article_id = n.id
     WHERE aq.status = 'pending' AND aq.telegram_message_id IS NOT NULL AND aq.telegram_message_id > 0
     ORDER BY aq.rowid DESC LIMIT ? OFFSET ?`
  ).all(limit, offset);

  const buttons = pending.map(p => [{
    text: `📰 ${(p.title || '').substring(0, 40)}`,
    callback_data: `info:${p.article_id}`
  }]);

  // Navigation row: Más (if has more pages) + Actualizar
  const navRow = [];
  const hasMore = (offset + limit) < total;
  if (hasMore) {
    navRow.push({ text: MSG.BTN_MORE, callback_data: `pg:${page + 1}` });
  }
  navRow.push({ text: MSG.BTN_REFRESH, callback_data: `refresh:${page}` });
  if (navRow.length) buttons.push(navRow);

  buttons.push([{ text: MSG.BTN_BACK, callback_data: 'menu:main' }]);

  const start = total > 0 ? offset + 1 : 0;
  const end = Math.min(offset + limit, total);

  return {
    text: pending.length
      ? `📋 *${total} noticias pendientes* (${start}-${end} de ${total})`
      : '✅ *No hay noticias pendientes*',
    keyboard: { inline_keyboard: buttons }
  };
}

// ─── Breaking News ────────────────────────────────────────────────────

/**
 * Generate a simple unique ID for breaking articles.
 */
function generateBreakingId() {
  return `breaking_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Handle /breaking command: parse, save, generate image, publish, confirm.
 */
async function handleBreakingCommand(title, source, chatId) {
  const articleId = generateBreakingId();
  const category = 'urgente';

  // 1. Insert into news_items
  db.prepare(`
    INSERT INTO news_items (id, title, source, sources, url, category, published_at, status)
    VALUES (?, ?, ?, '[]', ?, ?, datetime('now'), 'published')
  `).run(articleId, title, source, `https://breaking/${articleId}`, category);

  // 2. Insert into approval_queue as auto-approved
  const queueId = `q_${articleId.slice(0, 12)}`;
  const rewrittenTitle = await maybeRewriteHeadline(title, source, category);
  const draftTweet = formatBlueskyTweet(title, source, category, rewrittenTitle);
  db.prepare(`
    INSERT OR IGNORE INTO approval_queue (id, article_id, draft_tweet, status, reviewed_at)
    VALUES (?, ?, ?, 'approved', datetime('now'))
  `).run(queueId, articleId, draftTweet);

  // 3. Generate image using configured provider
  const prompt = buildCategoryPrompt(category, title, source);

  // Try Gemini for cache (non-blocking — doesn't delay the fast path)
  if (IMAGE_PROVIDER === 'gemini' || IMAGE_PROVIDER === 'auto') {
    generateImageViaOpenRouter(prompt, articleId).catch(() => {});
  }

  // Generate Pollinations URL for immediate Bluesky publish
  const nanoPrompt = await buildEnhancedPrompt(title, source, category);
  const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(nanoPrompt)}?width=1080&height=1350&nologo=true&seed=${Math.floor(Math.random() * 1000)}`;

  // 4. Publish to Bluesky (reuse the common helper)
  const result = await publishToBluesky(articleId, draftTweet, imageUrl, `https://breaking/${articleId}`);
  const publishSuccess = result.success;

  // 5. Send confirmation
  const confirmText = publishSuccess
    ? `🚨 *Breaking publicado en Bluesky!*\n\n📰 *${title}*\n📌 ${source}`
    : `⚠️ *Breaking registrado* (error al publicar en Bluesky)\n\n📰 *${title}*\n📌 ${source}`;

  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: confirmText, parse_mode: 'Markdown' }),
  });

  console.log(`🚨 Breaking published: ${title.slice(0, 50)}`);
}

// ─── Command / Message handler ────────────────────────────────────────

async function handleMenuAction(action, chatId, messageId) {
  const editMsg = (text, kb) => editMessageText(chatId, messageId, text, kb);

  if (action === 'main') {
          await editMsg(MSG.MENU_MAIN, MAIN_MENU);
  } else if (action === 'stats') {
    const s = statsKeyboard();
    await editMsg(s.text, s.keyboard);
  } else if (action === 'pending') {
    const p = pendingKeyboard(0);
    await editMsg(p.text, p.keyboard);
  } else if (action === 'breaking') {
    const articles = todayArticles();
    if (!articles.length) {
      return editMsg(MSG.MENU_BREAKING_EMPTY, {
        inline_keyboard: [[{ text: MSG.BTN_BACK, callback_data: 'menu:main' }]]
      });
    }
    const lines = articles.map((a, i) => `${i + 1}. [${a.title.substring(0, 60)}](${a.url}) — *${a.source}*`);
    await editMsg(`${MSG.MENU_BREAKING_HEADER}\n\n${lines.join('\n\n')}`, {
      inline_keyboard: [[{ text: MSG.BTN_BACK, callback_data: 'menu:main' }]]
    });
  } else if (action === 'search') {
    await editMsg(
      MSG.MENU_SEARCH_HELP,
      { inline_keyboard: [[{ text: MSG.BTN_BACK, callback_data: 'menu:main' }]] }
    );
  } else if (action === 'today') {
    const articles = todayArticles();
    if (!articles.length) {
      return editMsg(MSG.MENU_TODAY_EMPTY, {
        inline_keyboard: [[{ text: MSG.BTN_BACK, callback_data: 'menu:main' }]]
      });
    }
    const buttons = articles.map(a => [{
      text: `📰 ${(a.title || '').substring(0, 40)} — ${a.source}`,
      callback_data: `info:${a.id}`
    }]);
    buttons.push([{ text: MSG.BTN_BACK, callback_data: 'menu:main' }]);
    await editMsg(MSG.MENU_TODAY_HEADER, { inline_keyboard: buttons });
  } else if (action === 'scheduler') {
    const posts = scheduleManager.getScheduledPosts();
    const pendingCount = posts.filter(p => p.status === 'scheduled').length;
    const publishedCount = posts.filter(p => p.status === 'published').length;
    const failedCount = posts.filter(p => p.status === 'failed').length;
    const nextPosts = posts
      .filter(p => p.status === 'scheduled')
      .slice(0, 3)
      .map(p => {
        const time = new Date(p.scheduled_for).toLocaleString('es-AR', {
          hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short'
        });
        return `  ⏳ #${p.id} — ${time}`;
      });

    await editMsg(
      '⏰ *Programación de Publicaciones*\n\n' +
      `📊 *Resumen*\n` +
      `⏳ Pendientes: ${pendingCount}\n` +
      `✅ Publicados: ${publishedCount}\n` +
      `❌ Fallidos: ${failedCount}\n\n` +
      (nextPosts.length ? `📅 *Próximos*\n${nextPosts.join('\n')}\n\n` : '') +
      '📌 *Comandos*\n' +
      '• `/schedule HH:MM <id>` — programar\n' +
      '• `/schedule list` — ver todas\n' +
      '• `/schedule cancel <id>` — cancelar\n' +
      '• `/schedule now <id>` — publicar ya',
      { inline_keyboard: [[{ text: MSG.BTN_BACK, callback_data: 'menu:main' }]] }
    );
  } else if (action === 'services') {
    await editMsg(
      MSG.MENU_SERVICES,
      { inline_keyboard: [[{ text: MSG.BTN_BACK, callback_data: 'menu:main' }]] }
    );
      } else if (action === 'trending') {
        const trending = await fetchTrending();
        if (!trending || !trending.topics || trending.topics.length === 0) {
          await editMsg(MSG.MENU_TRENDING_EMPTY, {
            inline_keyboard: [[{ text: MSG.BTN_BACK, callback_data: 'menu:main' }]]
          });
        } else {
          const lines = trending.topics.map((t, i) => {
            const score = t.trendingScore.toFixed(0);
            return `${i + 1}. *${t.topic}*\n   📰 ${t.articleCount} artículos · ${t.sourceCount} fuentes · 🏷️ ${t.category}\n   🔥 Score: ${score}`;
          });
          await editMsg(`${MSG.MENU_TRENDING_HEADER}\n\n${lines.slice(0, 10).join('\n\n')}`, {
            inline_keyboard: [[{ text: MSG.BTN_BACK, callback_data: 'menu:main' }]]
          });
        }
      } else if (action === 'alerts') {
    const alerts = listAlerts(chatId);
    if (alerts.length === 0) {
      await editMsg(
        MSG.MENU_ALERTS_EMPTY,
        { inline_keyboard: [[{ text: MSG.BTN_BACK, callback_data: 'menu:main' }]] }
      );
    } else {
      const lines = alerts.map((a, i) =>
        `${i + 1}. ${a.type === 'province' ? '📍' : '🔤'} *${a.keyword}* (${a.type})`
      );
      await editMsg(
        `${MSG.MENU_ALERTS_LIST(alerts.length)}\n\n${lines.join('\n')}\n\n${MSG.MENU_ALERTS_HELP}`,
        { inline_keyboard: [[{ text: MSG.BTN_BACK, callback_data: 'menu:main' }]] }
      );
    }
    } else if (action === 'help') {
    await editMsg(
      MSG.MENU_HELP,
      { inline_keyboard: [[{ text: MSG.BTN_BACK, callback_data: 'menu:main' }]] }
    );
  }
}

// ─── Update processing (commands + callbacks) ─────────────────────────

// Process incoming callbacks from Telegram
let lastUpdateId = -1;

async function checkCallbacks() {
  try {
    const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=15`);
    const data = await resp.json();
    
    if (!data.ok || !data.result || data.result.length === 0) return;
    
    for (const update of data.result) {
      lastUpdateId = update.update_id;

      // ── Handle text commands ──
      const msg = update.message;
      if (msg && msg.text) {
        const txt = msg.text.trim();
        const sendMsg = (text, kb) => fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: msg.chat.id, text, parse_mode: 'Markdown', reply_markup: kb || undefined })
        });

        if (txt === '/start' || txt === '/menu') {
          await sendMsg('🤖 *ArgentinaRadar Bot*\n\nSeleccioná una opción:', MAIN_MENU);
        } else if (txt === '/panel') {
          await handlePanelCommand(msg.chat.id);
        } else if (txt === '/stats') {
          const s = statsKeyboard();
          await sendMsg(s.text, s.keyboard);
        } else if (txt === '/fuentes') {
          const sources = sourceStats();
          if (!sources.length) {
            await sendMsg('📡 *Fuentes RSS*\n\nNo hay fuentes registradas.', { inline_keyboard: [[{ text: MSG.BTN_BACK, callback_data: 'menu:main' }]] });
          } else {
            const lines = sources.map(s => `${s.source}: ${s.c}`);
            await sendMsg(`📡 *Fuentes RSS — Artículos indexados*\n\n${lines.join(' | ')}`, {
              inline_keyboard: [[{ text: MSG.BTN_BACK, callback_data: 'menu:main' }]]
            });
          }
        } else if (txt === '/today') {
          const articles = todayArticles();
          if (!articles.length) {
            await sendMsg('📋 *Últimas 24hs*\n\nNo hay artículos en las últimas 24 horas.', {
              inline_keyboard: [[{ text: MSG.BTN_BACK, callback_data: 'menu:main' }]]
            });
          } else {
            const buttons = articles.map(a => [{
              text: `📰 ${(a.title || '').substring(0, 40)} — ${a.source}`,
              callback_data: `info:${a.id}`
            }]);
            buttons.push([{ text: MSG.BTN_BACK, callback_data: 'menu:main' }]);
            await sendMsg('📋 *Últimas 24hs — Mejor puntuadas*\n\nSeleccioná un artículo:', { inline_keyboard: buttons });
          }
        } else if (txt.startsWith('/search ')) {
          const term = txt.slice(8).trim();
          if (!term) {
            await sendMsg('🔍 *Buscar Noticia*\n\nUsá: `/search <término>`\nEj: `/search inflación`');
          } else {
            const results = searchArticles(term);
            if (!results.length) {
              await sendMsg(`🔍 *Sin resultados*\n\nNo se encontraron noticias para "${term}".`, {
                inline_keyboard: [[{ text: MSG.BTN_BACK, callback_data: 'menu:main' }]]
              });
            } else {
              const buttons = results.map(r => [{
                text: `📰 ${(r.title || '').substring(0, 40)} — ${r.source}`,
                callback_data: `info:${r.id}`
              }]);
              buttons.push([{ text: MSG.BTN_BACK, callback_data: 'menu:main' }]);
              await sendMsg(`🔍 *Resultados para:* "${term}"\n\nSeleccioná un artículo:`, { inline_keyboard: buttons });
            }
          }
        } else if (txt === '/search') {
          await sendMsg('🔍 *Buscar Noticia*\n\nUsá: `/search <término>`\nEj: `/search inflación`');
        } else if (txt.startsWith('/breaking')) {
          const breakingText = txt.replace('/breaking', '').trim();
          const pipeIdx = breakingText.lastIndexOf('|');
          let brTitle, brSource;
          if (pipeIdx > 0) {
            brTitle = breakingText.substring(0, pipeIdx).trim();
            brSource = breakingText.substring(pipeIdx + 1).trim();
          } else {
            brTitle = breakingText;
            brSource = 'Breaking';
          }

          if (!brTitle) {
            await sendMsg('❌ Formato: `/breaking Título de la noticia | fuente`');
          } else {
            await handleBreakingCommand(brTitle, brSource, msg.chat.id);
          }
        } else if (txt === '/briefing') {
          await sendMsg('☀️ Generando morning briefing...');
          const ok = await sendMorningBriefing(msg.chat.id);
          if (!ok) {
            // sendMorningBriefing already sent a "no articles" message
          }
        } else if (txt.startsWith('/schedule')) {
          const args = txt.replace('/schedule', '').trim();

          if (!args || args === 'help') {
            await sendMsg(
              '⏰ *Programar Publicaciones*\n\n' +
              '• `/schedule HH:MM <article_id>` — programar un artículo para hoy\n' +
              '  Ej: `/schedule 14:30 abc123def`\n' +
              '• `/schedule list` — ver publicaciones programadas\n' +
              '• `/schedule cancel <id>` — cancelar una publicación\n' +
              '• `/schedule now <article_id>` — publicar inmediatamente\n' +
              '• También podés usar el botón "⏰ Programar" en cualquier aprobación.',
              { inline_keyboard: [[{ text: MSG.BTN_BACK, callback_data: 'menu:main' }]] }
            );
          } else if (args === 'list') {
            const posts = scheduleManager.getScheduledPosts();
            if (posts.length === 0) {
              await sendMsg('📭 *No hay publicaciones programadas.*', {
                inline_keyboard: [[{ text: MSG.BTN_BACK, callback_data: 'menu:main' }]]
              });
            } else {
              const lines = posts.map((p, i) => {
                const id = p.id;
                const statusEmoji = p.status === 'scheduled' ? '⏳' :
                  p.status === 'published' ? '✅' :
                  p.status === 'failed' ? '❌' : '🚫';
                const time = new Date(p.scheduled_for).toLocaleString('es-AR', {
                  hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short'
                });
                return `${i + 1}. #${id} ${statusEmoji} ${time} — ${(p.text || '').substring(0, 40)}`;
              });
              await sendMsg(`⏰ *Publicaciones Programadas (${posts.length})*\n\n${lines.join('\n')}`, {
                inline_keyboard: [[{ text: MSG.BTN_BACK, callback_data: 'menu:main' }]]
              });
            }
          } else if (args.startsWith('cancel ')) {
            const id = parseInt(args.slice('cancel '.length).trim(), 10);
            if (isNaN(id)) {
              await sendMsg('❌ Usá: `/schedule cancel <id>` — Ej: `/schedule cancel 1`');
            } else if (scheduleManager.cancelSchedule(id)) {
              await sendMsg(`✅ *Publicación #${id} cancelada.*`);
            } else {
              await sendMsg(`❌ No se encontró la publicación #${id} o ya fue procesada.`);
            }
          } else if (args.startsWith('now ')) {
            const articleIdDirect = args.slice('now '.length).trim();
            if (!articleIdDirect) {
              await sendMsg('❌ Usá: `/schedule now <article_id>`');
            } else {
              // Publish immediately — same flow as approve
              const aq = db.prepare('SELECT image_url FROM approval_queue WHERE article_id = ? AND status = ? ORDER BY rowid DESC LIMIT 1').get(articleIdDirect, 'pending');
              const article = db.prepare('SELECT title, source, category, url FROM news_items WHERE id = ?').get(articleIdDirect);
              if (!article) {
                await sendMsg(`❌ *Artículo no encontrado:* \`${articleIdDirect}\``);
              } else {
                await sendMsg(`⏰ Publicando *${(article.title || '').substring(0, 60)}* en Bluesky...`);
                // Mark as approved
                db.prepare('UPDATE approval_queue SET status = ?, reviewed_at = datetime("now") WHERE article_id = ?')
                  .run('approved', articleIdDirect);
                db.prepare('UPDATE news_items SET status = ? WHERE id = ?').run('published', articleIdDirect);
                // Publish
                const rewrittenTitle = typeof maybeRewriteHeadline === 'function'
                  ? await maybeRewriteHeadline(article.title, article.source, article.category)
                  : article.title;
                const tweetText = formatBlueskyTweet(article.title, article.source, article.category, rewrittenTitle);
                const pubResult = await publishToBluesky(articleIdDirect, tweetText, aq?.image_url, article.url);
                if (pubResult.success) {
                  await sendMsg(`✅ *Publicado en Bluesky!*\n\n📰 ${article.title}\n📌 ${article.source}`);
                } else {
                  await sendMsg(`❌ *Error al publicar:* ${pubResult.error}`);
                }
              }
            }
          } else if (/^\d{1,2}:\d{2}\s+\S+/.test(args)) {
            // Format: HH:MM article_id [image_url] [url]
            const parts = args.split(/\s+/);
            const timeStr = parts[0];
            const articleIdDirect = parts[1];
            const extraUrl = parts[2] || null;

            // Validate time format
            const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/);
            if (!timeMatch) {
              await sendMsg('❌ Formato de hora inválido. Usá HH:MM (ej: 14:30)');
            } else {
              const hours = parseInt(timeMatch[1], 10);
              const minutes = parseInt(timeMatch[2], 10);
              if (hours > 23 || minutes > 59) {
                await sendMsg('❌ Hora inválida. Usá formato 24h (ej: 14:30)');
              } else {
                const articleInfo = db.prepare('SELECT title, source, category, url FROM news_items WHERE id = ?').get(articleIdDirect);
                if (!articleInfo) {
                  // Allow scheduling without existing article (e.g. for manual posts)
                  const scheduledFor = new Date();
                  scheduledFor.setHours(hours, minutes, 0, 0);
                  if (scheduledFor <= new Date()) {
                    scheduledFor.setDate(scheduledFor.getDate() + 1); // next day if time passed
                  }
                  const id = scheduleManager.schedulePost(
                    articleIdDirect,
                    articleIdDirect, // text = articleId as fallback
                    scheduledFor,
                    null,
                    extraUrl
                  );
                  await sendMsg(`⏰ *Programado* para las ${timeStr} (ID: #${id})`);
                } else {
                  // Use the article info to schedule
                  const rewrittenTitle = typeof maybeRewriteHeadline === 'function'
                    ? await maybeRewriteHeadline(articleInfo.title, articleInfo.source, articleInfo.category)
                    : articleInfo.title;
                  const tweetText = formatBlueskyTweet(articleInfo.title, articleInfo.source, articleInfo.category, rewrittenTitle);
                  const aqImg = db.prepare('SELECT image_url FROM approval_queue WHERE article_id = ? ORDER BY rowid DESC LIMIT 1').get(articleIdDirect);
                  const scheduledFor = new Date();
                  scheduledFor.setHours(hours, minutes, 0, 0);
                  if (scheduledFor <= new Date()) {
                    scheduledFor.setDate(scheduledFor.getDate() + 1);
                  }
                  const id = scheduleManager.schedulePost(
                    articleIdDirect,
                    tweetText,
                    scheduledFor,
                    aqImg?.image_url || null,
                    articleInfo.url
                  );
                  await sendMsg(
                    `⏰ *Programado* para las ${timeStr}\n\n📰 ${articleInfo.title}\n📌 ${articleInfo.source}\n🆔 Programación: #${id}`,
                    { inline_keyboard: [[{ text: MSG.BTN_BACK, callback_data: 'menu:main' }]] }
                  );
                }
              }
            }
          } else {
            await sendMsg('❌ Comando no reconocido. Usá `/schedule` para ver las opciones.');
          }
        } else if (txt === '/trending') {
          const trending = await fetchTrending();
          if (!trending || !trending.topics || trending.topics.length === 0) {
            await sendMsg('📈 *Trending Topics*\n\nNo hay suficientes datos para calcular tendencias en las últimas 24hs.', {
              inline_keyboard: [[{ text: MSG.BTN_BACK, callback_data: 'menu:main' }]]
            });
          } else {
            const lines = trending.topics.map((t, i) => {
              const score = t.trendingScore.toFixed(0);
              return `${i + 1}. *${t.topic}*\n   📰 ${t.articleCount} artículos · ${t.sourceCount} fuentes · 🏷️ ${t.category}\n   🔥 Score: ${score}`;
            });
            await sendMsg(`📈 *Trending Topics — Últimas 24hs*\n\n${lines.slice(0, 10).join('\n\n')}`, {
              inline_keyboard: [[{ text: MSG.BTN_BACK, callback_data: 'menu:main' }]]
            });
          }
        } else if (txt.startsWith('/similar ')) {
          const term = txt.slice(9).trim();
          if (!term) {
            await sendMsg('🔍 *Búsqueda Semántica*\n\nUsá: `/similar <término>`\nEj: `/similar dólar blue`\n\n_Busca artículos semánticamente similares usando embeddings._');
          } else {
            try {
              const resp = await fetch(`${NEWS_SERVICE_URL}/api/search?q=${encodeURIComponent(term)}&limit=5`, {
                signal: AbortSignal.timeout(10000),
              });
              if (!resp.ok) {
                await sendMsg(`⚠️ Error en búsqueda semántica: HTTP ${resp.status}`);
              } else {
                const data = await resp.json();
                if (!data.results || data.results.length === 0) {
                  await sendMsg(`🔍 *Sin resultados semánticos*\n\nNo se encontraron artículos similares para "${term}".`, {
                    inline_keyboard: [[{ text: MSG.BTN_BACK, callback_data: 'menu:main' }]]
                  });
                } else {
                  const lines = data.results.map((r, i) => {
                    const simPct = Math.round(r.similarity * 100);
                    return `${i + 1}. [${r.title.substring(0, 50)}](${r.url}) — *${r.source}*\n   🔗 Similitud: ${simPct}%`;
                  });
                  await sendMsg(`🔍 *Búsqueda semántica:* "${term}"\n\n${lines.join('\n\n')}`, {
                    inline_keyboard: [[{ text: MSG.BTN_BACK, callback_data: 'menu:main' }]]
                  });
                }
              }
            } catch (e) {
              await sendMsg(`⚠️ Error en búsqueda semántica: ${e.message}`);
            }
          }
        } else if (txt === '/similar') {
          await sendMsg('🔍 *Búsqueda Semántica*\n\nUsá: `/similar <término>`\nEj: `/similar dólar blue`\n\n_Busca artículos semánticamente similares usando embeddings._');
        } else if (txt.startsWith('/alert')) {
          const args = txt.replace('/alert', '').trim();
          const chatId = msg.chat.id;

          if (!args) {
            await sendMsg(
              '🔔 *Alertas*\n\n' +
              '• `/alert add <palabra>` — agregar alerta por palabra clave\n' +
              '• `/alert add provincia <nombre>` — alerta por provincia\n' +
              '• `/alert remove <palabra>` — eliminar alerta\n' +
              '• `/alert list` — ver alertas activas\n\n' +
              'Provincias disponibles: ' + PROVINCES.join(', '),
              { inline_keyboard: [[{ text: MSG.BTN_BACK, callback_data: 'menu:main' }]] }
            );
          } else if (args.startsWith('add provincia ')) {
            const province = args.slice('add provincia '.length).trim();
            const normalized = PROVINCES.find(
              p => p.toLowerCase() === province.toLowerCase()
            );

            if (!normalized) {
              await sendMsg(
                `❌ *Provincia no válida.*\n\nProvincias disponibles:\n${PROVINCES.join(', ')}`,
                { inline_keyboard: [[{ text: MSG.BTN_BACK, callback_data: 'menu:main' }]] }
              );
            } else if (addAlert(normalized, 'province', chatId)) {
              await sendMsg(`✅ *Alerta agregada:* 📍 ${normalized} (provincia)`);
            } else {
              await sendMsg(`ℹ️ Ya tenés una alerta activa para "${normalized}".`);
            }
          } else if (args.startsWith('add ')) {
            const keyword = args.slice('add '.length).trim();
            if (!keyword || keyword.length < 2) {
              await sendMsg('❌ La palabra clave debe tener al menos 2 caracteres.');
            } else if (addAlert(keyword, 'keyword', chatId)) {
              await sendMsg(`✅ *Alerta agregada:* 🔤 "${keyword}"`);
            } else {
              await sendMsg(`ℹ️ Ya tenés una alerta activa para "${keyword}".`);
            }
          } else if (args.startsWith('remove ')) {
            const keyword = args.slice('remove '.length).trim();
            if (removeAlert(keyword, chatId)) {
              await sendMsg(`✅ *Alerta eliminada:* "${keyword}"`);
            } else {
              await sendMsg(`❌ No se encontró una alerta activa para "${keyword}".`);
            }
          } else if (args === 'list') {
            const alerts = listAlerts(chatId);
            if (alerts.length === 0) {
              await sendMsg('🔔 No tenés alertas configuradas.');
            } else {
              const lines = alerts.map((a, i) =>
                `${i + 1}. ${a.type === 'province' ? '📍' : '🔤'} *${a.keyword}*`
              );
              await sendMsg(`🔔 *Alertas activas (${alerts.length})*\n\n${lines.join('\n')}`);
            }
          } else {
            await sendMsg('❌ Comando no reconocido. Usá `/alert` para ver las opciones.');
          }
        }
        continue;
      }

      // ── Handle callback queries ──
      const cb = update.callback_query;
      if (!cb) continue;

      const cbData = cb.data || '';

      // Menu navigation callbacks
      if (cbData.startsWith('menu:')) {
        const action = cbData.split(':')[1];
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: cb.id })
        });
        await handleMenuAction(action, cb.message.chat.id, cb.message.message_id);
        continue;
      }

      // Pending list pagination callbacks
      if (cbData.startsWith('pg:')) {
        const page = parseInt(cbData.split(':')[1], 10);
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: cb.id })
        });
        const p = pendingKeyboard(page);
        await editMessageText(cb.message.chat.id, cb.message.message_id, p.text, p.keyboard);
        continue;
      }

      if (cbData.startsWith('refresh:')) {
        const page = parseInt(cbData.split(':')[1], 10);
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: cb.id })
        });
        const p = pendingKeyboard(page);
        await editMessageText(cb.message.chat.id, cb.message.message_id, p.text, p.keyboard);
        continue;
      }

      // Article info callback (from pending list / search / today results)
      if (cbData.startsWith('info:')) {
        const articleId = cbData.split(':')[1];
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: cb.id })
        });
        await showArticleInfo(cb.message.chat.id, cb.message.message_id, articleId);
        continue;
      }

      // Schedule callback — show instructions when "⏰ Programar" is clicked
      if (cbData.startsWith('schedule:')) {
        const scheduleArticleId = cbData.split(':')[1];
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callback_query_id: cb.id,
            text: 'Usá /schedule HH:MM article_id para programar. Ej: /schedule 14:30 ' + scheduleArticleId.slice(0, 8),
            show_alert: false,
          }),
        });
        continue;
      }

      // Panel callbacks — unified control panel
      if (cbData.startsWith('panel:')) {
        const panelAction = cbData.slice(6);
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: cb.id })
        });
        await handlePanelCallback(panelAction, cb.message.chat.id, cb.message.message_id);
        continue;
      }

      // Article approve/reject callbacks
      const [action, articleId] = cb.data.split(':');
      
      // ⚡ Answer IMMEDIATELY — before any DB or Bluesky work
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: cb.id,
          text: action === 'approve' ? '✅ Aprobado — publicando en Bluesky' : '❌ Descartado',
        }),
      });
      
        if (action === 'approve') {
        // Get article info + image_url + category
        const aq = db.prepare('SELECT image_url FROM approval_queue WHERE article_id = ? AND status = ? ORDER BY rowid DESC LIMIT 1').get(articleId, 'pending');
        const article = db.prepare('SELECT title, source, category, url FROM news_items WHERE id = ?').get(articleId);
        
        // Mark as approved
        db.prepare('UPDATE approval_queue SET status = ?, reviewed_at = datetime("now") WHERE article_id = ?')
          .run('approved', articleId);
        db.prepare('UPDATE news_items SET status = ? WHERE id = ?').run('published', articleId);
        
        // Update Telegram message — remove action buttons, show approved
        if (cb.message) {
          await editMessageText(cb.message.chat.id, cb.message.message_id,
            `✅ *Aprobado*\n\n📰 ${article?.title || ''}\n📌 ${article?.source || ''}`,
            { inline_keyboard: [[{ text: MSG.BTN_SOURCE, url: article?.url || '' }]] }
          );
        }

        // Publish to Bluesky with Gemini-generated image
        if (article) {
          const rewrittenTitle = await maybeRewriteHeadline(article.title, article.source, article.category);
          const tweetText = formatBlueskyTweet(article.title, article.source, article.category, rewrittenTitle);
          
          // Generate image using configured provider
          const prompt = buildCategoryPrompt(article.category, article.title, article.source);
          let blueskyImg = null;

          if (IMAGE_PROVIDER === 'gemini' || IMAGE_PROVIDER === 'auto') {
            blueskyImg = await generateImageViaOpenRouter(prompt, articleId);
          }
          if (!blueskyImg && (IMAGE_PROVIDER === 'pollinations' || IMAGE_PROVIDER === 'auto')) {
            // Fallback to Pollinations image URL (already stored in DB)
            console.log(`[bluesky] Using Pollinations image for ${articleId.slice(0, 8)}`);
          }

          if (blueskyImg) {
            // Upload Gemini image directly to Bluesky as blob
            try {
              const { BskyAgent } = require('@atproto/api');
              const agent = new BskyAgent({ service: 'https://bsky.social' });
              await agent.login({ identifier: 'sitearsdevs.bsky.social', password: process.env.BSKY_APP_PASSWORD });
              const blob = await agent.uploadBlob(blueskyImg.buffer, { encoding: blueskyImg.mimeType });
              // Post with image embed directly
              const rt = new (require('@atproto/api').RichText)({ text: tweetText.slice(0, 300) });
              await rt.detectFacets(agent);
              await agent.post({ text: rt.text, facets: rt.facets, embed: { $type: 'app.bsky.embed.images', images: [{ image: blob.data.blob, alt: article.title.slice(0, 100) }] } });
              console.log(`[bluesky] ✅ Published with Gemini image — ${articleId.slice(0, 8)}`);
            } catch (e) {
              console.warn(`[bluesky] Gemini publish failed, falling back: ${e.message}`);
              await publishToBluesky(articleId, tweetText, aq?.image_url, article.url);
            }
          } else {
            // Fallback to Pollinations image URL
            await publishToBluesky(articleId, tweetText, aq?.image_url, article.url);
          }
        }
        
        console.log(`Approved: ${articleId}`);
      } else if (action === 'reject') {
        db.prepare('UPDATE approval_queue SET status = ?, reviewed_at = datetime("now") WHERE article_id = ?')
          .run('rejected', articleId);
        
        // Update Telegram message — show rejected status
        if (cb.message) {
          const article = db.prepare('SELECT title, source, url FROM news_items WHERE id = ?').get(articleId);
          await editMessageText(cb.message.chat.id, cb.message.message_id,
            `❌ *Descartado*\n\n📰 ${article?.title || ''}\n📌 ${article?.source || ''}`,
            { inline_keyboard: [[{ text: MSG.BTN_SOURCE, url: article?.url || '' }]] }
          );
        }
        
        console.log(`Rejected: ${articleId}`);
      }
    }
  } catch (e) {
    console.error('Callback error:', e.message);
  }
}

// ─── Scheduled tasks ──────────────────────────────────────────────────

/**
 * Track last briefing time check to avoid running DB queries every cycle.
 * Only checks the clock every ~60s.
 */
let lastBriefingCheck = 0;
const BRIEFING_CHECK_INTERVAL = 60000; // 60 seconds

async function checkScheduledBriefing() {
  const now = Date.now();
  if (now - lastBriefingCheck < BRIEFING_CHECK_INTERVAL) return;
  lastBriefingCheck = now;

  const date = new Date();
  const hour = date.getHours();
  const min = date.getMinutes();

  // Daily at 8:00 AM (within 2-minute window to avoid missing the slot)
  if (hour === 8 && min < 2) {
    console.log('[scheduler] 8:00 AM — checking morning briefing...');
    await checkAndSendBriefing();
  }
}

// ─── Core Service Auto-Recovery ──────────────────────────────────────────

/**
 * In-memory tracking of core service downtime for /panel display.
 *
 * @type {Object<string, { firstDown: number | null, alerted: boolean }>}
 */
const serviceDowntime = {};

let lastCoreCheck = 0;
const CORE_CHECK_INTERVAL = 300000; // 5 minutes
const DOWNTIME_ALERT_THRESHOLD = 600000; // 10 minutes

const CORE_SERVICES = [
  { name: 'news-ingestion', port: 3001 },
  { name: 'publisher',      port: 3004 },
  { name: 'admin',          port: 3012 },
];

/**
 * Check core services every 5 minutes. If a service has been down for more
 * than 10 consecutive minutes, send a Telegram alert.
 *
 * Tracks state in-memory in `serviceDowntime` for /panel queries.
 * Never throws — all errors are caught and logged.
 */
async function checkCoreServicesHealth() {
  const now = Date.now();
  if (now - lastCoreCheck < CORE_CHECK_INTERVAL) return;
  lastCoreCheck = now;

  for (const svc of CORE_SERVICES) {
    try {
      const resp = await fetch(`http://127.0.0.1:${svc.port}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        // Service is healthy — reset tracking
        if (serviceDowntime[svc.name]?.firstDown !== null) {
          const downMs = now - serviceDowntime[svc.name]?.firstDown;
          console.log(`[recovery] ${svc.name} is back online after ${Math.round(downMs / 1000)}s`);
        }
        serviceDowntime[svc.name] = { firstDown: null, alerted: false };
      } else {
        // Service responded but with error status
        if (!serviceDowntime[svc.name] || serviceDowntime[svc.name].firstDown === null) {
          serviceDowntime[svc.name] = { firstDown: now, alerted: false };
        }
      }
    } catch {
      // Service is unreachable
      if (!serviceDowntime[svc.name] || serviceDowntime[svc.name].firstDown === null) {
        serviceDowntime[svc.name] = { firstDown: now, alerted: false };
      }
    }

    // Check if we need to send an alert
    const tracked = serviceDowntime[svc.name];
    if (tracked && tracked.firstDown !== null && !tracked.alerted) {
      const downDuration = now - tracked.firstDown;
      if (downDuration >= DOWNTIME_ALERT_THRESHOLD) {
        tracked.alerted = true;
        const minutes = Math.round(downDuration / 60000);
        console.log(`[recovery] ⚠️ ${svc.name} down for ${minutes} min — sending alert`);

        try {
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: parseInt(CHAT_ID),
              text: `⚠️ *Auto-Recovery — ${svc.name}*\n\nEl servicio lleva más de ${minutes} minutos sin responder.\n📌 Puerto: ${svc.port}\n🔧 Se requiere intervención manual.`,
              parse_mode: 'Markdown',
            }),
            signal: AbortSignal.timeout(10000),
          });
        } catch (e) {
          console.error(`[recovery] Failed to send alert: ${e.message}`);
        }
      }
    }
  }
}

/**
 * Get the current service downtime map for /panel display.
 * @returns {Object<string, { status: string, downSince: number | null, downMinutes: number, alerted: boolean }>}
 */
function getServiceDowntimeStatus() {
  const now = Date.now();
  const result = {};
  for (const svc of CORE_SERVICES) {
    const tracked = serviceDowntime[svc.name];
    const isDown = tracked && tracked.firstDown !== null;
    result[svc.name] = {
      status: isDown ? 'down' : 'running',
      port: svc.port,
      downSince: tracked?.firstDown ?? null,
      downMinutes: isDown ? Math.round((now - tracked.firstDown) / 60000) : 0,
      alerted: tracked?.alerted ?? false,
    };
  }
  return result;
}

// ─── Schedule Processor ────────────────────────────────────────────────

/**
 * Poll every cycle for due scheduled posts and publish them.
 * Failed publishes are auto-retried with exponential backoff
 * (30s, 2min, 5min, max 3 retries) via the schedule manager.
 */
let lastSchedulerLog = 0;

async function processScheduledPosts() {
  try {
    const due = scheduleManager.getDuePosts();
    if (due.length === 0) {
      // Log once every 5 minutes to avoid noise
      const now = Date.now();
      if (now - lastSchedulerLog > 300000) {
        console.log('[schedule-processor] No due posts — waiting...');
        lastSchedulerLog = now;
      }
      return;
    }

    console.log(`[schedule-processor] Found ${due.length} due post(s)`);

    for (const post of due) {
      // Get article info for context
      const article = db.prepare('SELECT title, source, category FROM news_items WHERE id = ?').get(post.article_id);

      // Publish to Bluesky
      const pubResult = await publishToBluesky(
        post.article_id,
        post.text,
        post.image_url,
        post.url
      );

      if (pubResult.success) {
        scheduleManager.markPublished(post.id);

        // Also update approval_queue and news_items if they exist
        db.prepare('UPDATE approval_queue SET status = ?, reviewed_at = datetime("now") WHERE article_id = ? AND status = ?')
          .run('approved', post.article_id, 'pending');
        db.prepare('UPDATE news_items SET status = ? WHERE id = ? AND status != ?')
          .run('published', post.article_id, 'published');

        console.log(`[schedule-processor] ✅ Published scheduled post #${post.id}`);
      } else {
        scheduleManager.markFailedAndRetry(post.id, pubResult.error || 'Unknown error');
        console.log(`[schedule-processor] ❌ Failed scheduled post #${post.id}: ${pubResult.error}`);
      }

      // Small delay between posts to avoid rate limits
      await new Promise(r => setTimeout(r, 2000));
    }
  } catch (e) {
    console.error('[schedule-processor] Error:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PANEL SYSTEM — Unified Control Panel (/panel command)
// ═══════════════════════════════════════════════════════════════════════════

function timeSince(date) {
  const s = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'min';
  const h = Math.floor(m / 60);
  if (h < 48) return h + 'h';
  return Math.floor(h / 24) + 'd';
}

function getSystemInfo() {
  const cpus = os.cpus();
  const t = os.totalmem(), f = os.freemem();
  const u = t - f, memPct = ((u / t) * 100).toFixed(1);
  const up = process.uptime();
  const cpuPct = Math.min(100, ((os.loadavg()[0] / cpus.length) * 100)).toFixed(0);
  return { cpuPct, memUsed: (u / 1e9).toFixed(1), memTotal: (t / 1e9).toFixed(1), memPct, uptimeStr: Math.floor(up / 3600) + 'h ' + Math.floor((up % 3600) / 60) + 'm', cpuCores: cpus.length };
}

async function checkSvc(n, p) {
  try { const r = await fetch('http://127.0.0.1:' + p + '/health', { signal: AbortSignal.timeout(3000) }); return { n, p, s: r.ok ? 'ok' : 'deg' }; } catch { return { n, p, s: 'down' }; }
}

function getPipelineStats() {
  const q = s => db.prepare(s).get().c;
  const t = q('SELECT COUNT(*)c FROM news_items');
  const ing = q("SELECT COUNT(*)c FROM news_items WHERE status='ingested'");
  const pa = q("SELECT COUNT(*)c FROM news_items WHERE status='pending_approval'");
  const ap = q("SELECT COUNT(*)c FROM approval_queue WHERE status='approved'");
  const pe = q("SELECT COUNT(*)c FROM approval_queue WHERE status='pending'");
  const pub = q("SELECT COUNT(*)c FROM news_items WHERE status IN('published','auto_published')");
  const dis = q("SELECT COUNT(*)c FROM news_items WHERE status='discarded'");
  const src = q('SELECT COUNT(DISTINCT source)c FROM news_items');
  const last = db.prepare('SELECT ingested_at FROM news_items ORDER BY ingested_at DESC LIMIT 1').get();
  const tap = q("SELECT COUNT(*)c FROM approval_queue WHERE status='approved' AND date(reviewed_at)=date('now')");
  const ttot = q("SELECT COUNT(*)c FROM approval_queue WHERE date(created_at)=date('now')");
  const tpub = q("SELECT COUNT(*)c FROM news_items WHERE status IN('published','auto_published') AND date(published_at)=date('now')");
  let sc = 0;
  try { sc = scheduleManager.getScheduledPosts().filter(p => p.status === 'scheduled').length; } catch (e) {}
  return { total: t, ingested: ing, pendingApproval: pa, approved: ap, pending: pe, published: pub, discarded: dis, sources: src, lastArticle: last ? last.ingested_at : null, todayApproved: tap, todayTotal: ttot, todayPublished: tpub, scheduledCount: sc };
}

function panelText(s, sys) {
  const ta = s.lastArticle ? timeSince(new Date(s.lastArticle.replace(' ', 'T') + 'Z')) : 'nunca';
  const pct = s.todayTotal > 0 ? Math.round((s.todayApproved / s.todayTotal) * 100) : 0;
  return '🤖 *ARGENTINA RADAR — Panel de Control*\n\n'
    + '📡 INGESTIÓN ' + (s.lastArticle ? '🟢' : '🟡') + '\n  ' + s.total + ' artículos | ' + s.sources + ' fuentes | Último: hace ' + ta + '\n\n'
    + '🧠 AI 🟢\n  Modelo: qwen2.5:7b · Threshold: 5.0 · Calidad min: 40\n\n'
    + '✅ APROBACIÓN ' + (s.pending > 0 ? '🟡' : '🟢') + '\n  Pendientes: ' + s.pending + ' | Hoy: ' + s.todayApproved + '/' + s.todayTotal + ' (' + pct + '%)\n\n'
    + '🚀 PUBLICACIÓN 🟢\n  Bluesky: OK · Programados: ' + s.scheduledCount + ' · Publicados hoy: ' + s.todayPublished + '\n\n'
    + '📊 MONITOREO 🟢\n  CPU: ' + sys.cpuPct + '% | RAM: ' + sys.memUsed + 'GB/' + sys.memTotal + 'GB (' + sys.memPct + '%) | Uptime: ' + sys.uptimeStr + '\n\n'
    + '⚙️ CONFIGURACIÓN';
}

function panelKB(s) {
  return { inline_keyboard: [
    [{ text: '🔄 Forzar refresh', callback_data: 'panel:ing-refresh' }, { text: '⏸️ Pausa', callback_data: 'panel:ing-pause' }],
    [{ text: '⚙️ Threshold', callback_data: 'panel:ai-threshold' }, { text: '🔁 Reprocesar', callback_data: 'panel:ai-reprocess' }],
    [{ text: '📋 Pendientes', callback_data: 'panel:approval' }, { text: '⚡ Auto-aprobar', callback_data: 'panel:approval-auto' }],
    [{ text: '📤 Publicar', callback_data: 'panel:publish-draft' }, { text: '⏰ Programados', callback_data: 'panel:publish-scheduled' }],
    [{ text: '🩺 Health', callback_data: 'panel:health-detail' }, { text: '📈 Stats', callback_data: 'panel:stats-detail' }],
    [{ text: '📡 Fuentes (' + s.sources + ')', callback_data: 'panel:cfg-sources' }, { text: '🔔 Alertas', callback_data: 'panel:cfg-alerts' }],
    [{ text: '💾 Backup', callback_data: 'panel:cfg-backup' }, { text: '🔄 Reiniciar', callback_data: 'panel:cfg-restart' }],
    [{ text: '🔙 Menú', callback_data: 'menu:main' }, { text: '🔄 Refrescar', callback_data: 'panel:main' }],
  ]};
}

async function handlePanelCommand(chatId) {
  try { const [s, sys] = await Promise.all([getPipelineStats(), getSystemInfo()]); await sendToTelegram(panelText(s, sys), panelKB(s)); } catch (e) { console.error('[panel]', e.message); }
}

async function handlePanelCallback(a, chatId, msgId) {
  const em = (t, k) => editMessageText(chatId, msgId, t, k);
  try {
    switch (a) {
      case 'main': { const [s, sys] = await Promise.all([getPipelineStats(), getSystemInfo()]); await em(panelText(s, sys), panelKB(s)); break; }
      case 'ingestion': { const s = getPipelineStats(); const la = db.prepare('SELECT title,source,ingested_at FROM news_items ORDER BY ingested_at DESC LIMIT 5').all(); const r = la.map(a => '• ' + escapeMd(a.title.substring(0, 60)) + ' — ' + escapeMd(a.source)).join('\n'); const ta = s.lastArticle ? timeSince(new Date(s.lastArticle.replace(' ', 'T') + 'Z')) : 'N/A'; await em('📡 *Panel de INGESTIÓN*\n\nTotal: ' + b('' + s.total) + ' arts | Fuentes: ' + b('' + s.sources) + ' | Última: ' + b(ta) + '\n\n📰 *Últimos*\n' + r, { inline_keyboard: [[{ text: '🔄 Forzar refresh', callback_data: 'panel:ing-refresh' }], [{ text: '⏸️ Pausar', callback_data: 'panel:ing-pause' }], [{ text: '🔙 Volver', callback_data: 'panel:main' }]] }); break; }
      case 'ai': { const s = getPipelineStats(); await em('🧠 *Panel de IA*\n\n⚙️ Modelo: qwen2.5:7b · Threshold: 5.0\n\n✅ Aprobados: ' + b('' + s.approved) + '\n⏳ Pendientes: ' + b('' + s.pendingApproval) + '\n❌ Descartados: ' + b('' + s.discarded), { inline_keyboard: [[{ text: '⚙️ Threshold', callback_data: 'panel:ai-threshold' }, { text: '🤖 Modelo', callback_data: 'panel:ai-model' }], [{ text: '🔁 Reprocesar', callback_data: 'panel:ai-reprocess' }], [{ text: '🔙 Volver', callback_data: 'panel:main' }]] }); break; }
      case 'approval': { const s = getPipelineStats(); const pa = db.prepare("SELECT n.id,n.title,n.source FROM approval_queue aq JOIN news_items n ON aq.article_id=n.id WHERE aq.status='pending' ORDER BY aq.created_at DESC LIMIT 10").all(); const pt = pa.length ? pa.map((a, i) => (i + 1) + '. ' + b(a.title.substring(0, 50)) + ' — ' + escapeMd(a.source)).join('\n') : '✅ Sin pendientes.'; const bl = Math.min(s.todayTotal, 20); const al = bl > 0 ? Math.round((s.todayApproved / Math.max(s.todayTotal, 1)) * bl) : 0; const bar = '█'.repeat(al) + '░'.repeat(Math.max(bl - al, 0)); const pct = s.todayTotal > 0 ? Math.round((s.todayApproved / s.todayTotal) * 100) : 0; await em('✅ *Panel de APROBACIÓN*\n\n📊 *Hoy*\nAprob: ' + b('' + s.todayApproved) + '/' + s.todayTotal + '\n' + bar + ' ' + pct + '%\n\n⏳ Pendientes: ' + b('' + s.pending) + '\n\n📋 ' + pt, { inline_keyboard: [...(pa.length ? [[{ text: '📋 Ver pendientes', callback_data: 'menu:pending' }]] : []), [{ text: '⚡ Auto-aprobar todas', callback_data: 'panel:approval-auto' }], [{ text: '🔙 Volver', callback_data: 'panel:main' }]] }); break; }
      case 'publish': { const s = getPipelineStats(); let st = 'Sin programaciones.'; try { const as = scheduleManager.getScheduledPosts().filter(p => p.status === 'scheduled').slice(0, 5); if (as.length) st = as.map(p => '• #' + p.id + ' ' + new Date(p.scheduled_for).toLocaleString('es-AR', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) + ' — ' + escapeMd(p.text.substring(0, 40))).join('\n'); } catch (e) {} await em('🚀 *Panel de PUBLICACIÓN*\n\nBluesky: 🟢 OK\nPublicados hoy: ' + b('' + s.todayPublished) + '\nProgramados: ' + b('' + s.scheduledCount) + '\n\n📅 ' + st, { inline_keyboard: [[{ text: '📤 Publicar borrador', callback_data: 'panel:publish-draft' }], [{ text: '⏰ Programados', callback_data: 'panel:publish-scheduled' }], [{ text: '🔄 Reintentar fallidos', callback_data: 'panel:publish-retry' }], [{ text: '🔙 Volver', callback_data: 'panel:main' }]] }); break; }
      case 'monitor': { const sys = getSystemInfo(); const ps = [{ n: 'news-ingestion', p: 3001 }, { n: 'geo', p: 3002 }, { n: 'publisher', p: 3004 }, { n: 'ai', p: 3013 }, { n: 'admin', p: 3012 }, { n: 'frontend', p: 5173 }]; const res = await Promise.all(ps.map(p => checkSvc(p.n, p.p))); const svc = res.map(r => (r.s === 'ok' ? '🟢' : r.s === 'deg' ? '🟡' : '🔴') + ' ' + r.n + ' (' + r.p + ')').join('\n'); await em('📊 *Panel de MONITOREO*\n\n🖥️ CPU: ' + sys.cpuPct + '% (' + sys.cpuCores + 'c) | RAM: ' + sys.memUsed + 'GB/' + sys.memTotal + 'GB (' + sys.memPct + '%) | Up: ' + sys.uptimeStr + '\n\n🌐 *Servicios*\n' + svc, { inline_keyboard: [[{ text: '🩺 Health check', callback_data: 'panel:health-detail' }], [{ text: '📈 Stats', callback_data: 'panel:stats-detail' }], [{ text: '🔙 Volver', callback_data: 'panel:main' }]] }); break; }
      case 'config': { const s = getPipelineStats(); const al = listAlerts(chatId); await em('⚙️ *Panel de CONFIGURACIÓN*\n\n📡 Fuentes: ' + b('' + s.sources) + '\n🔔 Alertas: ' + b('' + al.length) + '\n💾 Backup DB\n🔄 Reiniciar servicios', { inline_keyboard: [[{ text: '📡 Fuentes (' + s.sources + ')', callback_data: 'panel:cfg-sources' }], [{ text: '🔔 Alertas (' + al.length + ')', callback_data: 'panel:cfg-alerts' }], [{ text: '💾 Backup DB', callback_data: 'panel:cfg-backup' }], [{ text: '🔄 Reiniciar', callback_data: 'panel:cfg-restart' }], [{ text: '🤖 Cambiar modelo', callback_data: 'panel:ai-model' }], [{ text: '🔙 Volver', callback_data: 'panel:main' }]] }); break; }
      case 'ing-refresh': { await em('⏳ Forzando refresh RSS...', { inline_keyboard: [] }); try { const r = await fetch('http://127.0.0.1:3012/api/admin/actions/refresh-rss', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000) }); const data = await r.json().catch(() => ({})); if (data.success) await em('✅ ' + escapeMd(data.message || 'RSS refresh completado.'), { inline_keyboard: [[{ text: '🔄 Panel', callback_data: 'panel:main' }]] }); else await em('⚠️ ' + escapeMd(data.message || 'Refresh solicitado.'), { inline_keyboard: [[{ text: '🔄 Panel', callback_data: 'panel:main' }]] }); } catch (e) { await em('⚠️ ' + escapeMd(e.message), { inline_keyboard: [[{ text: '🔙 Panel', callback_data: 'panel:main' }]] }); } break; }
      case 'ing-pause': { await em('⏸️ *Pausa*\n\nPara pausar: `pm2 stop news-ingestion`\nPara reanudar: `pm2 start news-ingestion`', { inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'panel:ingestion' }]] }); break; }
      case 'ai-threshold': { await em('⚙️ *Threshold*\n\nActual: 5.0 | Calidad min: 40\n\nEditá `config/.env`:\nAI_THRESHOLD=5.0\nMIN_QUALITY_THRESHOLD=40\n\nLuego `pm2 restart ai-processor`', { inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'panel:ai' }]] }); break; }
      case 'ai-model': { await em('🤖 *Modelo AI*\n\nActual: qwen2.5:7b\n\nOpciones:\n• qwen2.5:7b\n• llama3\n• llama3.1\n• openrouter\n\nEditá AI_MODEL en config/.env y reiniciá.', { inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'panel:ai' }]] }); break; }
      case 'ai-reprocess': { await em('⏳ Reprocesando...', { inline_keyboard: [] }); try { const r = await fetch('http://127.0.0.1:3001/api/pipeline/stats', { signal: AbortSignal.timeout(8000) }); if (r.ok) await em('✅ Reprocesamiento en curso.', { inline_keyboard: [[{ text: '🔄 Panel', callback_data: 'panel:main' }]] }); else throw new Error('HTTP ' + r.status); } catch (e) { await em('⚠️ ' + escapeMd(e.message), { inline_keyboard: [[{ text: '🔙 Panel', callback_data: 'panel:main' }]] }); } break; }
      case 'approval-auto': { const pc = db.prepare("SELECT COUNT(*)c FROM approval_queue WHERE status='pending'").get().c; if (!pc) { await em('✅ Sin pendientes.', { inline_keyboard: [[{ text: '🔙 Panel', callback_data: 'panel:main' }]] }); break; } await em('⚠️ *Auto-aprobar ' + pc + ' noticias?*\nSe publicarán en Bluesky.\n\n_No se puede deshacer._', { inline_keyboard: [[{ text: '✅ Sí', callback_data: 'panel:approval-auto-x' }, { text: '❌ No', callback_data: 'panel:approval' }]] }); break; }
      case 'approval-auto-x': { await em('⏳ Procesando...', { inline_keyboard: [] }); const pp = db.prepare("SELECT aq.id qid,aq.article_id,aq.image_url,n.title,n.source,n.category,n.url FROM approval_queue aq JOIN news_items n ON aq.article_id=n.id WHERE aq.status='pending' ORDER BY aq.created_at ASC").all(); let ok = 0, fail = 0; for (const e of pp) { try { db.prepare("UPDATE approval_queue SET status='approved',reviewed_at=datetime('now') WHERE id=?").run(e.qid); db.prepare("UPDATE news_items SET status='published' WHERE id=?").run(e.article_id); const rw = await maybeRewriteHeadline(e.title, e.source, e.category); const tw = formatBlueskyTweet(e.title, e.source, e.category, rw); (await publishToBluesky(e.article_id, tw, e.image_url, e.url)).success ? ok++ : fail++; } catch (e2) { fail++; } await new Promise(r => setTimeout(r, 1000)); } await em('✅ *Auto-aprobación completa*\n\n✅ ' + ok + '\n❌ ' + fail + '\nTotal: ' + pp.length, { inline_keyboard: [[{ text: '🔙 Panel', callback_data: 'panel:main' }]] }); break; }
      case 'publish-draft': { await em('📤 *Publicar borrador*\n\nUsá:\n• `/schedule now <id>` — publicar ya\n• `/schedule HH:MM <id>` — programar', { inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'panel:publish' }]] }); break; }
      case 'publish-scheduled': { try { const posts = scheduleManager.getScheduledPosts(); if (!posts.length) { await em('📭 Sin programaciones.', { inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'panel:publish' }]] }); break; } const lines = posts.map((p, i) => { const emo = p.status === 'scheduled' ? '⏳' : p.status === 'published' ? '✅' : p.status === 'failed' ? '❌' : '🚫'; const t = new Date(p.scheduled_for).toLocaleString('es-AR', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }); return (i + 1) + '. #' + p.id + ' ' + emo + ' ' + t + ' — ' + escapeMd(p.text.substring(0, 40)); }).join('\n'); await em('⏰ *Programaciones (' + posts.length + ')*\n\n' + lines + '\n\n_Cancelar: /schedule cancel <id>_', { inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'panel:publish' }]] }); } catch (e) { await em('⚠️ ' + escapeMd(e.message), { inline_keyboard: [[{ text: '🔙 Panel', callback_data: 'panel:main' }]] }); } break; }
      case 'publish-retry': { let fl = []; try { fl = scheduleManager.getScheduledPosts().filter(p => p.status === 'failed'); } catch (e) { await em('⚠️ ' + escapeMd(e.message), { inline_keyboard: [[{ text: '🔙 Panel', callback_data: 'panel:main' }]] }); break; } if (!fl.length) { await em('✅ Sin fallidos.', { inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'panel:publish' }]] }); break; } await em('⏳ Reintentando ' + fl.length + '...', { inline_keyboard: [] }); let ret = 0; for (const p of fl) { try { const r = await publishToBluesky(p.article_id, p.text, p.image_url, p.url); if (r.success) { scheduleManager.markPublished(p.id); ret++; } else scheduleManager.markFailedAndRetry(p.id, r.error); } catch (e) { scheduleManager.markFailedAndRetry(p.id, e.message); } await new Promise(r => setTimeout(r, 1500)); } await em('🔄 *Reintento completo*\n\n✅ ' + ret + '\n❌ ' + (fl.length - ret), { inline_keyboard: [[{ text: '🔙 Panel', callback_data: 'panel:main' }]] }); break; }
      case 'health-detail': { const sys = getSystemInfo(); const ps = [{ n: 'news-ingestion', p: 3001 }, { n: 'geo', p: 3002 }, { n: 'publisher', p: 3004 }, { n: 'hermes', p: 3005 }, { n: 'ai', p: 3013 }, { n: 'admin', p: 3012 }, { n: 'frontend', p: 5173 }]; const res = await Promise.all(ps.map(p => checkSvc(p.n, p.p))); const lns = res.map(r => (r.s === 'ok' ? '🟢' : r.s === 'deg' ? '🟡' : '🔴') + ' ' + r.n + ' (' + r.p + ')').join('\n'); let dbOk = false; try { db.prepare('SELECT 1').get(); dbOk = true; } catch (e) {} await em('🩺 *Health Check*\n\n🖥️ CPU: ' + sys.cpuPct + '% | RAM: ' + sys.memPct + '% | Up: ' + sys.uptimeStr + '\n\n💾 DB: ' + (dbOk ? '🟢' : '🔴') + ' ' + DB_PATH + '\n\n🌐\n' + lns, { inline_keyboard: [[{ text: '🔄 Refrescar', callback_data: 'panel:health-detail' }], [{ text: '🔙 Panel', callback_data: 'panel:main' }]] }); break; }
      case 'stats-detail': { const s = getPipelineStats(); const cats = db.prepare("SELECT category,COUNT(*)c FROM news_items WHERE category IS NOT NULL AND category!='' GROUP BY category ORDER BY c DESC").all(); const cl = cats.map(c => escapeMd(c.category) + ': ' + b('' + c.c)).join('\n'); await em('📈 *Stats Detalladas*\n\n📊 Total: ' + b('' + s.total) + ' | Ingest: ' + b('' + s.ingested) + ' | Pend: ' + b('' + s.pendingApproval) + ' | Aprob: ' + b('' + s.approved) + ' | Pub: ' + b('' + s.published) + ' | Desc: ' + b('' + s.discarded) + '\n\n📰 *Categorías*\n' + (cl || 'sin datos'), { inline_keyboard: [[{ text: '🔄 Refrescar', callback_data: 'panel:stats-detail' }], [{ text: '🔙 Panel', callback_data: 'panel:main' }]] }); break; }
      case 'cfg-sources': { const sl = db.prepare('SELECT source,COUNT(*)c FROM news_items GROUP BY source ORDER BY c DESC').all(); await em('📡 *Fuentes (' + sl.length + ')*\n\n' + sl.map(s => escapeMd(s.source) + ': ' + s.c + ' arts').join('\n'), { inline_keyboard: [[{ text: '🔙 Config', callback_data: 'panel:config' }]] }); break; }
      case 'cfg-alerts': { const al = listAlerts(chatId); if (!al.length) await em('🔔 Sin alertas.\n\nUsá /alert add <palabra>', { inline_keyboard: [[{ text: '🔙 Config', callback_data: 'panel:config' }]] }); else await em('🔔 *Alertas (' + al.length + ')*\n\n' + al.map((a, i) => (i + 1) + '. ' + (a.type === 'province' ? '📍' : '🔤') + ' ' + b(a.keyword)).join('\n'), { inline_keyboard: [[{ text: '🔙 Config', callback_data: 'panel:config' }]] }); break; }
      case 'cfg-backup': { await em('⏳ Backupeando...', { inline_keyboard: [] }); try { const fs = require('fs'); const bd = path.join(path.dirname(DB_PATH), 'backups'); if (!fs.existsSync(bd)) fs.mkdirSync(bd, { recursive: true }); const d = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); const dest = path.join(bd, 'argentina-radar-' + d + '.db'); fs.copyFileSync(DB_PATH, dest); const sz = (fs.statSync(dest).size / 1024 / 1024).toFixed(1); await em('✅ *Backup hecho*\n\n📦 ' + sz + ' MB\n📍 `' + dest + '`', { inline_keyboard: [[{ text: '🔙 Panel', callback_data: 'panel:main' }]] }); } catch (e) { await em('⚠️ ' + escapeMd(e.message), { inline_keyboard: [[{ text: '🔙 Panel', callback_data: 'panel:main' }]] }); } break; }
      case 'cfg-restart': { await em('⚠️ *Reiniciar servicios*\n\nSe va a ejecutar:\n`pm2 restart notifier publisher`\n\n_El bot se reiniciará._', { inline_keyboard: [[{ text: '✅ Sí', callback_data: 'panel:cfg-restart-x' }, { text: '❌ No', callback_data: 'panel:config' }]] }); break; }
      case 'cfg-restart-x': { await em('⏳ Reiniciando...', { inline_keyboard: [] }); try { const { execSync } = require('child_process'); execSync('pm2 restart notifier publisher', { timeout: 15000, stdio: 'pipe', windowsHide: true }); await em('✅ *Reinicio enviado*\n\nnotifier y publisher reiniciados.', { inline_keyboard: [[{ text: '🔙 Panel', callback_data: 'panel:main' }]] }); } catch (e) { await em('⚠️ ' + escapeMd(e.message) + '\n\nReiniciá manualmente.', { inline_keyboard: [[{ text: '🔙 Panel', callback_data: 'panel:main' }]] }); } break; }
      default: { await em('❌ Acción: `' + escapeMd(a) + '`', { inline_keyboard: [[{ text: '🔙 Panel', callback_data: 'panel:main' }]] }); }
    }
  } catch (e) { console.error('[panel] err:', e.message); try { await em('⚠️ ' + escapeMd(e.message), { inline_keyboard: [[{ text: '🔙 Menú', callback_data: 'menu:main' }]] }); } catch (_) {} }
}

// Main loop
async function main() {
  console.log('Telegram Approval Notifier started');
  console.log(`Bot: @ArgRadarBot | Chat: ${CHAT_ID}`);
  console.log(`Polling every ${POLL_INTERVAL / 1000}s`);
  while (true) {
    try { await checkPendingApprovals(); } catch (e) { console.error('[main] Pending approvals:', e.message); }
    try { await checkCallbacks(); } catch (e) { console.error('[main] Callbacks:', e.message); }
    try { await checkScheduledBriefing(); } catch (e) { console.error('[main] Briefing:', e.message); }
    try { await processScheduledPosts(); } catch (e) { console.error('[main] Scheduler:', e.message); }
    try { await checkCoreServicesHealth(); } catch (e) { console.error('[main] Core services:', e.message); }
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
}

main().catch((err) => {
  console.error('[main] Fatal error:', err.message);
  console.log('[main] Reiniciando en 10 segundos...');
  setTimeout(main, 10000);
});
