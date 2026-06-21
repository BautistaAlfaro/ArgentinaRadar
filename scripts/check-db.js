const Database = require('better-sqlite3');
const db = new Database('data/argentina-radar.db');

console.log('=== Pending entries (any telegram status) ===');
const allPending = db.prepare(`SELECT id, article_id, telegram_message_id, status,
  substr((SELECT title FROM news_items WHERE id = article_id), 1, 50) as title
  FROM approval_queue WHERE status='pending'`).all();
console.log(JSON.stringify(allPending, null, 2));

console.log('\n=== Multiple same-article entries ===');
const dupes = db.prepare(`SELECT article_id, count(*) c, group_concat(status) as statuses, group_concat(telegram_message_id) as tmsg
  FROM approval_queue GROUP BY article_id HAVING count(*) > 1`).all();
console.log(JSON.stringify(dupes, null, 2));

console.log('\n=== Total counts ===');
console.log('Total approval_queue:', db.prepare('SELECT count(*) c FROM approval_queue').get().c);
console.log('Total news_items:', db.prepare('SELECT count(*) c FROM news_items').get().c);
