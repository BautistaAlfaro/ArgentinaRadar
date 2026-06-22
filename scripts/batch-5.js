const Database = require('better-sqlite3');
const db = new Database('data/argentina-radar.db');

// Find 5 unprocessed Argentine articles
const articles = db.prepare(`
  SELECT * FROM news_items 
  WHERE id NOT IN (SELECT article_id FROM approval_queue) 
  AND source IN ('clarin','lanacion','infobae','ambito','cronista','pagina12','tn','perfil','c5n','eldestape')
  AND status IN ('ingested','pending')
  ORDER BY ingested_at DESC
  LIMIT 5
`).all();

if (articles.length === 0) {
  console.log('No articles found');
  process.exit(0);
}

console.log(`Found ${articles.length} articles:`);
articles.forEach(a => console.log(`  ${a.id.slice(0,12)} | ${a.source} | ${a.title.slice(0,70)}`));

// Insert as pending with telegram_message_id=-1 so notifier picks them up
const insert = db.prepare(`
  INSERT OR IGNORE INTO approval_queue (id, article_id, draft_tweet, status, telegram_message_id, created_at)
  VALUES (?, ?, ?, 'pending', 0, datetime('now'))
`);

let count = 0;
for (const a of articles) {
  const qid = 'batch_' + a.id.slice(0, 16);
  const draft = a.title.slice(0, 200) + ' | ' + a.source;
  insert.run(qid, a.id, draft);
  count++;
}

console.log(`Inserted ${count} into approval_queue as pending`);
db.close();
