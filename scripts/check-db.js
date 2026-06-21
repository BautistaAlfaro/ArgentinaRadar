const Database = require('better-sqlite3');
const db = new Database('data/argentina-radar.db');

console.log('=== Pending + telegram msg ===');
const pending = db.prepare(`SELECT id, article_id, status, telegram_message_id
  FROM approval_queue WHERE status='pending' AND telegram_message_id IS NOT NULL
  LIMIT 10`).all();
console.log(JSON.stringify(pending, null, 2));

console.log('\n=== All by status ===');
const stats = db.prepare(`SELECT status, count(*) cnt FROM approval_queue GROUP BY status`).all();
console.log(stats);

console.log('\n=== Fernado Gago article ===');
const gago = db.prepare(`SELECT aq.id, aq.article_id, aq.status, aq.telegram_message_id,
  n.title FROM approval_queue aq
  JOIN news_items n ON aq.article_id = n.id
  WHERE aq.article_id = '6c03ef2a3dd6de84'
  ORDER BY aq.id DESC`).all();
console.log(JSON.stringify(gago, null, 2));

console.log('\n=== Latest 5 ===');
const latest = db.prepare(`SELECT aq.id, aq.article_id, aq.status, aq.telegram_message_id,
  substr(n.title, 1, 60) as title
  FROM approval_queue aq
  JOIN news_items n ON aq.article_id = n.id
  ORDER BY aq.rowid DESC LIMIT 5`).all();
console.log(JSON.stringify(latest, null, 2));
