const Database = require('better-sqlite3');
const db = new Database('data/argentina-radar.db');

// Inline quality scorer
function scoreArticleQuality(title, summary, source) {
  let score = 0;
  // Title length (15-80 optimal)
  const tLen = (title || '').length;
  score += tLen >= 15 && tLen <= 80 ? 20 : tLen > 0 ? 10 : 0;
  // Title quality
  const t = title || '';
  if (t === t.toUpperCase() && tLen > 20) score += 0; else score += 20;
  if (t.includes('!!!') || t.includes('???')) score -= 10;
  // Summary
  if ((summary || '').length > 30) score += 15;
  // Source reputation
  const s = (source || '').toLowerCase();
  const reputable = ['clarin','lanacion','infobae','ambito','cronista','pagina12','tn','perfil'];
  if (reputable.includes(s)) score += 25;
  else if (s.length > 0) score += 15;
  // Has URL
  score += 5;
  return Math.min(100, Math.max(0, score));
}

function predictEngagement(article) {
  let score = 30;
  const cat = article.category || 'general';
  if (cat === 'urgente') score += 25;
  else if (cat === 'politica') score += 20;
  else if (cat === 'economia') score += 15;
  const tLen = (article.title || '').length;
  if (tLen >= 15 && tLen <= 40) score += 20;
  return Math.min(100, score);
}

const articles = db.prepare('SELECT * FROM news_items WHERE quality_score = 0 OR quality_score IS NULL').all();
console.log('Scoring ' + articles.length + ' articles...');

const update = db.prepare('UPDATE news_items SET quality_score=?, engagement_score=?, relevance_score=? WHERE id=?');
let count = 0;
for (const a of articles) {
  const q = scoreArticleQuality(a.title, a.summary, a.source);
  const e = predictEngagement(a);
  update.run(q, e, 0, a.id);
  count++;
}
console.log('Scored ' + count + ' articles');

const stats = db.prepare('SELECT AVG(quality_score) as avg_q, COUNT(*) as cnt FROM news_items WHERE quality_score IS NOT NULL').get();
console.log(JSON.stringify(stats));
db.close();
