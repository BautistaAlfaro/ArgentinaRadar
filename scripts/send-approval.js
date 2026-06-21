const Database = require('better-sqlite3');
const db = new Database('data/argentina-radar.db');

// Find article NOT yet in approval queue
const article = db.prepare(`
  SELECT * FROM news_items
  WHERE id NOT IN (SELECT article_id FROM approval_queue)
  AND source IN ('clarin', 'lanacion', 'infobae', 'c5n', 'ambito', 'cronista', 'pagina12', 'tn', 'perfil', 'canal26', 'eldestape', 'a24', 'america')
  LIMIT 1
`).get();

if (!article) { console.log('No articles found'); process.exit(1); }

const ARTICLE_ID = article.id;
const BOT = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Build rich NanoBanana prompt
const headline = article.title.substring(0, 100).replace(/[*_`[\]()#+-.!]/g, '');
const source = (article.source || 'ARGENTINA').toUpperCase();
const category = article.category || 'general';
const catMeta = {
  urgente:   { emoji: '🚨', label: 'URGENTE' },
  politica:  { emoji: '🗳️', label: 'Política' },
  economia:  { emoji: '💰', label: 'Economía' },
  deportes:  { emoji: '⚽', label: 'Deportes' },
  policial:  { emoji: '🚔', label: 'Policial' },
  sociedad:  { emoji: '🌎', label: 'Sociedad' },
};
const m = catMeta[category] || { emoji: '📰', label: 'General' };
const catEmoji = m.emoji;
const catLabel = category === 'urgente' ? `*${m.label}*` : m.label;
const nanoPrompt = [
  `Professional Argentine news thumbnail, horizontal 16:9 layout.`,
  `Headline: "${headline}".`,
  `Style: dramatic Argentine TV news ("Only Fonseca" style) — high contrast, cinematic lighting, photorealistic.`,
  `Color palette: dark navy blue (#003087) background with gold (#FFD700) accents and text.`,
  `Source badge: ${source} logo in top corner.`,
  `Elements: bold news typography, expressive faces if relevant, dramatic shadows.`,
  `Red "ULTIMO MOMENTO" banner element (subtle, professional).`,
  `No cartoon, no illustration — photorealistic news broadcast style.`,
  `Clean modern composition, professional Argentine journalism aesthetic.`
].join(' ');

// Generate image — 16:9 landscape for Bluesky
const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(nanoPrompt)}?width=1280&height=720&nologo=true&seed=` + Math.floor(Math.random() * 1000);

// Insert into approval_queue with image_url — use telegram_message_id=-1 as placeholder
// so the notifier skips it (it's being handled manually with image)
db.prepare(`INSERT INTO approval_queue (article_id, status, draft_tweet, image_url, image_prompt, telegram_message_id, created_at)
  VALUES (?, 'pending', ?, ?, ?, -1, datetime('now'))`).run(ARTICLE_ID, article.title, imageUrl, nanoPrompt);

(async () => {
  const kb = {
    inline_keyboard: [[
      { text: '✅ Aprobar', callback_data: 'approve:' + ARTICLE_ID },
      { text: '❌ Descartar', callback_data: 'reject:' + ARTICLE_ID }
    ]]
  };

  const caption = [
    `${catEmoji} ${catLabel} | *${article.title}*`,
    '',
    `📌 ${article.source} | #ArgentinaRadar`
  ].join('\n');

  // Send photo + caption + buttons
  const r = await fetch('https://api.telegram.org/bot' + BOT + '/sendPhoto', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: parseInt(CHAT_ID, 10),
      photo: imageUrl,
      caption: caption,
      parse_mode: 'Markdown',
      reply_markup: kb
    })
  });

  const d = await r.json();
  if (d.ok) {
    const msgId = d.result.message_id;
    console.log('✅ Sent! message_id:', msgId);
    console.log('   Image:', imageUrl.substring(0, 80) + '...');

    const aq = db.prepare('SELECT id FROM approval_queue WHERE article_id = ? ORDER BY rowid DESC LIMIT 1').get(ARTICLE_ID);
    db.prepare('UPDATE approval_queue SET telegram_message_id = ? WHERE id = ?').run(msgId, aq.id);
    console.log('✅ DB updated. CLICK APROBAR NOW!');
  } else {
    console.log('❌ FAIL:', JSON.stringify(d));
  }
})();
