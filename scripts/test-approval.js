const path = require('path');
const Database = require('better-sqlite3');
const db = new Database(path.resolve(__dirname, '..', 'data', 'argentina-radar.db'));

const aq = db.prepare("SELECT * FROM approval_queue WHERE status='pending' LIMIT 1").get();
if (!aq) { console.log('No pending articles'); process.exit(0); }

const article = db.prepare('SELECT * FROM news_items WHERE id = ?').get(aq.article_id);
if (!article) { console.log('Article not found'); process.exit(0); }

console.log('Article ID:', article.id);
console.log('Title:', article.title.substring(0, 80));

const BOT = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
(async () => {
  const kb = {inline_keyboard:[[
    {text: '✅ Aprobar', callback_data: 'approve:' + article.id},
    {text: '❌ Descartar', callback_data: 'reject:' + article.id}
  ]]};
  const r = await fetch('https://api.telegram.org/bot' + BOT + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: parseInt(CHAT_ID, 10),
      text: '📰 *' + article.title.substring(0, 200) + '*\n\n📌 ' + article.source + ' | #ArgentinaRadar',
      parse_mode: 'Markdown',
      reply_markup: kb
    })
  });
  const d = await r.json();
  if (d.ok) {
    console.log('Sent! message_id:', d.result.message_id);
    db.prepare('UPDATE approval_queue SET telegram_message_id = ? WHERE id = ?').run(d.result.message_id, aq.id);
    console.log('Updated DB');
  } else {
    console.log('FAIL:', d.description);
  }
})();
