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
const BOT = '8653838115:AAFBRBhHEq3VXbfgiZwV1dtNjesBYwvhUqg';

// Insert into approval_queue
db.prepare(`INSERT INTO approval_queue (article_id, status, draft_tweet, created_at)
  VALUES (?, 'pending', ?, datetime('now'))`).run(ARTICLE_ID, article.title);

// Build NanoBanana prompt
const headline = article.title.substring(0, 80);
const source = article.source.toUpperCase();
const nanoPrompt = `Professional Argentine news thumbnail. ${headline}. Dark blue (#003087) and gold (#FFD700). ${source} logo. Dramatic lighting, photorealistic, cinematic. Clean modern layout. ULTIMO MOMENTO banner.`;

// Generate image
const encoded = encodeURIComponent(nanoPrompt);
const imageUrl = `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&nologo=true&seed=` + Math.floor(Math.random() * 1000);

(async () => {
  const kb = {
    inline_keyboard: [[
      { text: '✅ Aprobar', callback_data: 'approve:' + ARTICLE_ID },
      { text: '❌ Descartar', callback_data: 'reject:' + ARTICLE_ID }
    ]]
  };

  const caption = [
    '📰 *' + article.title + '*',
    '',
    '📌 ' + article.source + ' | #ArgentinaRadar'
  ].join('\n');

  // Send photo + caption + buttons
  const r = await fetch('https://api.telegram.org/bot' + BOT + '/sendPhoto', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: 1923443777,
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
