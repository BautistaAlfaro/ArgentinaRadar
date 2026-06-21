const Database = require('better-sqlite3');
const db = new Database('data/argentina-radar.db');

const d = db.prepare(`DELETE FROM approval_queue WHERE status = 'pending' AND (telegram_message_id IS NULL OR telegram_message_id = 0 OR telegram_message_id = -1)`).run();
console.log('Deleted pending:', d.changes);
console.log('Remaining total:', db.prepare('SELECT COUNT(*) c FROM approval_queue').get().c);

const remaining = db.prepare(`SELECT id, article_id, status, telegram_message_id FROM approval_queue WHERE status = 'pending'`).all();
console.log('Still pending:', remaining.length);
