/**
 * Telegram Approval Notifier — ArgentinaRadar
 * 
 * Polls approval_queue, generates NanoBanana news thumbnails,
 * sends to Telegram with inline approve/reject buttons, and
 * handles callbacks to publish on Bluesky with images.
 * 
 * Also serves as the Telegram bot command handler (menu, stats, etc.)
 */
const Database = require('better-sqlite3');
const path = require('path');
const { addAlert, removeAlert, listAlerts, PROVINCES } = require('./alerts');
const { sendMorningBriefing, checkAndSendBriefing } = require('./morning-briefing.js');
const scheduleManager = require('../../shared/scheduleManager');

const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'argentina-radar.db');
const BOT_TOKEN = '8653838115:AAFBRBhHEq3VXbfgiZwV1dtNjesBYwvhUqg';
const CHAT_ID = '1923443777';
const POLL_INTERVAL = 10000; // 10 seconds

const db = new Database(DB_PATH);

// ─── NanoBanana Prompt Builder ──────────────────────────────────────────

/**
 * Build a rich NanoBanana-style image prompt for Pollinations.ai.
 * 
 * Style: Only Fonseca (dramático, alto contraste) + MDZ Online (limpio, periodístico).
 * Colors: dark blue #003087 + gold #FFD700. Horizontal 16:9 news thumbnail.
 */
function buildNanoBananaPrompt(title, source, category) {
  const headline = title.substring(0, 100).replace(/[*_`[\]()#+-.!]/g, '');
  const sourceName = source.toUpperCase();
  const catEmoji = category === 'urgente' ? '🚨' : category === 'politica' ? '🗳️' :
    category === 'economia' ? '💰' : category === 'deportes' ? '⚽' : '📰';
  
  return [
    'Professional Argentine news thumbnail, horizontal 16:9 layout.',
    `Headline: "${headline}".`,
    'Style: dramatic Argentine TV news ("Only Fonseca" channel style) — high contrast, cinematic lighting, photorealistic.',
    `Color palette: dark navy blue (#003087) background with gold (#FFD700) accents and text.`,
    `Source badge: ${sourceName} logo in top corner.`,
    'Elements: bold news typography, expressive faces if relevant, dramatic shadows.',
    'Red "ULTIMO MOMENTO" banner element (subtle, professional).',
    'No cartoon, no illustration — photorealistic news broadcast style.',
    'Clean modern composition, professional Argentine journalism aesthetic.'
  ].join(' ');
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

const AI_API = process.env.AI_API || 'http://127.0.0.1:3013';
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
  try {
    const bskyResp = await fetch('http://127.0.0.1:3004/api/publish-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        article_id: articleId,
        text: text,
        image_url: imageUrl || null,
        url: url || null,
      }),
    });
    const result = await bskyResp.json();
    if (result.success) {
      console.log(`[bluesky] ✅ Published ${articleId.slice(0, 8)}`);
      return { success: true, error: null };
    }
    console.log(`[bluesky] ❌ Failed ${articleId.slice(0, 8)}: ${result.error || 'unknown'}`);
    return { success: false, error: result.error || 'Unknown error' };
  } catch (e) {
    console.log(`[bluesky] Network error ${articleId.slice(0, 8)}: ${e.message}`);
    return { success: false, error: e.message };
  }
}

// ─── Telegram API helpers ───────────────────────────────────────────────

async function sendToTelegram(text, keyboard) {
  const body = JSON.stringify({
    chat_id: parseInt(CHAT_ID),
    text: text,
    parse_mode: 'Markdown',
    reply_markup: keyboard || undefined,
  });

  try {
    const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
    });
    const data = await resp.json();
    return data;
  } catch (e) {
    console.error('Telegram error:', e.message);
    return null;
  }
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

      // Build NanoBanana prompt + image URL (16:9 landscape for Bluesky)
      const category = entry.category || 'general';
      const nanoPrompt = buildNanoBananaPrompt(entry.title, entry.source, category);
      const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(nanoPrompt)}?width=1280&height=720&nologo=true&seed=${Math.floor(Math.random() * 1000)}`;

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
          { text: '✅ Aprobar', callback_data: `approve:${entry.article_id}` },
          { text: '⏰ Programar', callback_data: `schedule:${entry.article_id}` },
          { text: '❌ Descartar', callback_data: `reject:${entry.article_id}` },
        ], [
          { text: '🔍 Ver fuente', url: entry.url },
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

const NEWS_SERVICE_URL = 'http://127.0.0.1:3001';

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
      { text: '⏰ Programar', callback_data: 'menu:scheduler' },
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
      inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'menu:pending' }]]
    });
  }

  const text = `📰 *${article.title}*\n\n📌 *Fuente:* ${article.source}\n🏷️ *Categoría:* ${article.category || 'general'}\n🔗 [Ver artículo](${article.url})`;

  const buttons = [];
  const isPending = db.prepare(
    "SELECT id FROM approval_queue WHERE article_id = ? AND status = 'pending' LIMIT 1"
  ).get(articleId);

  if (isPending) {
    buttons.push([
      { text: '✅ Aprobar', callback_data: `approve:${article.id}` },
      { text: '❌ Descartar', callback_data: `reject:${article.id}` },
      { text: '🔍 Ver fuente', url: article.url },
    ]);
  } else {
    buttons.push([{ text: '🔍 Ver fuente', url: article.url }]);
  }
  buttons.push([{ text: '🔙 Volver', callback_data: 'menu:pending' }]);

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
    keyboard: { inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'menu:main' }]] }
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
    navRow.push({ text: '▶️ Más', callback_data: `pg:${page + 1}` });
  }
  navRow.push({ text: '🔄 Actualizar', callback_data: `refresh:${page}` });
  if (navRow.length) buttons.push(navRow);

  buttons.push([{ text: '🔙 Volver', callback_data: 'menu:main' }]);

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

  // 3. Generate NanoBanana image
  const nanoPrompt = buildNanoBananaPrompt(title, source, category);
  const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(nanoPrompt)}?width=1280&height=720&nologo=true&seed=${Math.floor(Math.random() * 1000)}`;

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
    await editMsg('🤖 *ArgentinaRadar Bot*\n\nSeleccioná una opción:', MAIN_MENU);
  } else if (action === 'stats') {
    const s = statsKeyboard();
    await editMsg(s.text, s.keyboard);
  } else if (action === 'pending') {
    const p = pendingKeyboard(0);
    await editMsg(p.text, p.keyboard);
  } else if (action === 'breaking') {
    const articles = todayArticles();
    if (!articles.length) {
      return editMsg('🚨 *Breaking News*\n\nNo hay noticias urgentes en las últimas 24hs.', {
        inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'menu:main' }]]
      });
    }
    const lines = articles.map((a, i) => `${i + 1}. [${a.title.substring(0, 60)}](${a.url}) — *${a.source}*`);
    await editMsg(`🚨 *Breaking News — Últimas 24hs*\n\n${lines.join('\n\n')}`, {
      inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'menu:main' }]]
    });
  } else if (action === 'search') {
    await editMsg(
      '🔍 *Buscar Noticia*\n\nUsá el comando:\n`/search <término>`\n\nEjemplo: `/search inflación`',
      { inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'menu:main' }]] }
    );
  } else if (action === 'today') {
    const articles = todayArticles();
    if (!articles.length) {
      return editMsg('📋 *Últimas 24hs*\n\nNo hay artículos en las últimas 24 horas.', {
        inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'menu:main' }]]
      });
    }
    const buttons = articles.map(a => [{
      text: `📰 ${(a.title || '').substring(0, 40)} — ${a.source}`,
      callback_data: `info:${a.id}`
    }]);
    buttons.push([{ text: '🔙 Volver', callback_data: 'menu:main' }]);
    await editMsg('📋 *Últimas 24hs — Mejor puntuadas*\n\nSeleccioná un artículo:', { inline_keyboard: buttons });
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
      { inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'menu:main' }]] }
    );
  } else if (action === 'services') {
    await editMsg(
      '⚙️ *Servicios*\n\n' +
      '🔵 Bluesky Publisher: puerto 3004\n' +
      '🟢 Telegram Notifier: activo\n' +
      '🟡 Hermes Bridge: puerto 3005\n\n' +
      '_Los servicios se gestionan desde el Dashboard_',
      { inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'menu:main' }]] }
    );
      } else if (action === 'trending') {
        const trending = await fetchTrending();
        if (!trending || !trending.topics || trending.topics.length === 0) {
          await editMsg('📈 *Trending Topics*\n\nNo hay suficientes datos para calcular tendencias en las últimas 24hs.', {
            inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'menu:main' }]]
          });
        } else {
          const lines = trending.topics.map((t, i) => {
            const score = t.trendingScore.toFixed(0);
            return `${i + 1}. *${t.topic}*\n   📰 ${t.articleCount} artículos · ${t.sourceCount} fuentes · 🏷️ ${t.category}\n   🔥 Score: ${score}`;
          });
          await editMsg(`📈 *Trending Topics — Últimas 24hs*\n\n${lines.slice(0, 10).join('\n\n')}`, {
            inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'menu:main' }]]
          });
        }
      } else if (action === 'alerts') {
    const alerts = listAlerts(chatId);
    if (alerts.length === 0) {
      await editMsg(
        '🔔 *Alertas*\n\nNo tenés alertas configuradas.\n\n' +
        '• `/alert add <palabra>` — alerta por palabra clave\n' +
        '• `/alert add provincia <nombre>` — alerta por provincia\n' +
        '• `/alert remove <palabra>` — eliminar alerta\n' +
        '• `/alert list` — ver alertas activas',
        { inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'menu:main' }]] }
      );
    } else {
      const lines = alerts.map((a, i) =>
        `${i + 1}. ${a.type === 'province' ? '📍' : '🔤'} *${a.keyword}* (${a.type})`
      );
      await editMsg(
        `🔔 *Alertas activas (${alerts.length})*\n\n${lines.join('\n')}\n\n` +
        '• `/alert add <palabra>` — agregar alerta\n' +
        '• `/alert remove <palabra>` — eliminar alerta',
        { inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'menu:main' }]] }
      );
    }
    } else if (action === 'help') {
    await editMsg(
      '❓ *Ayuda*\n\n' +
      '• Las noticias llegan automáticamente para revisión\n' +
      '• ✅ Aprobar → publica en Bluesky con imagen\n' +
      '• ❌ Descartar → archiva sin publicar\n' +
      '• 🚨 `/breaking Título | fuente` → publica al instante en Bluesky\n' +
      '• ☀️ `/briefing` → morning briefing de hoy\n' +
      '• 🔔 `/alert` → gestionar alertas de palabras clave/provincias\n' +
      '• Usá /menu para ver este menú\n' +
      '• /search <término> → buscar noticias\n' +
      '• /similar <término> → búsqueda semántica con IA\n' +
      '• /today → últimas 24hs\n' +
      '• /fuentes → fuentes RSS activas',
      { inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'menu:main' }]] }
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
        } else if (txt === '/stats') {
          const s = statsKeyboard();
          await sendMsg(s.text, s.keyboard);
        } else if (txt === '/fuentes') {
          const sources = sourceStats();
          if (!sources.length) {
            await sendMsg('📡 *Fuentes RSS*\n\nNo hay fuentes registradas.', { inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'menu:main' }]] });
          } else {
            const lines = sources.map(s => `${s.source}: ${s.c}`);
            await sendMsg(`📡 *Fuentes RSS — Artículos indexados*\n\n${lines.join(' | ')}`, {
              inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'menu:main' }]]
            });
          }
        } else if (txt === '/today') {
          const articles = todayArticles();
          if (!articles.length) {
            await sendMsg('📋 *Últimas 24hs*\n\nNo hay artículos en las últimas 24 horas.', {
              inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'menu:main' }]]
            });
          } else {
            const buttons = articles.map(a => [{
              text: `📰 ${(a.title || '').substring(0, 40)} — ${a.source}`,
              callback_data: `info:${a.id}`
            }]);
            buttons.push([{ text: '🔙 Volver', callback_data: 'menu:main' }]);
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
                inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'menu:main' }]]
              });
            } else {
              const buttons = results.map(r => [{
                text: `📰 ${(r.title || '').substring(0, 40)} — ${r.source}`,
                callback_data: `info:${r.id}`
              }]);
              buttons.push([{ text: '🔙 Volver', callback_data: 'menu:main' }]);
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
              { inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'menu:main' }]] }
            );
          } else if (args === 'list') {
            const posts = scheduleManager.getScheduledPosts();
            if (posts.length === 0) {
              await sendMsg('📭 *No hay publicaciones programadas.*', {
                inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'menu:main' }]]
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
                inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'menu:main' }]]
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
                    { inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'menu:main' }]] }
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
              inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'menu:main' }]]
            });
          } else {
            const lines = trending.topics.map((t, i) => {
              const score = t.trendingScore.toFixed(0);
              return `${i + 1}. *${t.topic}*\n   📰 ${t.articleCount} artículos · ${t.sourceCount} fuentes · 🏷️ ${t.category}\n   🔥 Score: ${score}`;
            });
            await sendMsg(`📈 *Trending Topics — Últimas 24hs*\n\n${lines.slice(0, 10).join('\n\n')}`, {
              inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'menu:main' }]]
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
                    inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'menu:main' }]]
                  });
                } else {
                  const lines = data.results.map((r, i) => {
                    const simPct = Math.round(r.similarity * 100);
                    return `${i + 1}. [${r.title.substring(0, 50)}](${r.url}) — *${r.source}*\n   🔗 Similitud: ${simPct}%`;
                  });
                  await sendMsg(`🔍 *Búsqueda semántica:* "${term}"\n\n${lines.join('\n\n')}`, {
                    inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'menu:main' }]]
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
              { inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'menu:main' }]] }
            );
          } else if (args.startsWith('add provincia ')) {
            const province = args.slice('add provincia '.length).trim();
            const normalized = PROVINCES.find(
              p => p.toLowerCase() === province.toLowerCase()
            );

            if (!normalized) {
              await sendMsg(
                `❌ *Provincia no válida.*\n\nProvincias disponibles:\n${PROVINCES.join(', ')}`,
                { inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'menu:main' }]] }
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
            { inline_keyboard: [[{ text: '🔍 Ver fuente', url: article?.url || '' }]] }
          );
        }

        // Publish to Bluesky (reuse the common helper)
        if (article) {
          const rewrittenTitle = await maybeRewriteHeadline(article.title, article.source, article.category);
          const tweetText = formatBlueskyTweet(article.title, article.source, article.category, rewrittenTitle);
          await publishToBluesky(articleId, tweetText, aq?.image_url, article.url);
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
            { inline_keyboard: [[{ text: '🔍 Ver fuente', url: article?.url || '' }]] }
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

// Main loop
async function main() {
  console.log('Telegram Approval Notifier started');
  console.log(`Bot: @ArgRadarBot | Chat: ${CHAT_ID}`);
  console.log(`Polling every ${POLL_INTERVAL / 1000}s`);
  
  while (true) {
    await checkPendingApprovals();
    await checkCallbacks();
    await checkScheduledBriefing();
    await processScheduledPosts();
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
}

main().catch(console.error);
