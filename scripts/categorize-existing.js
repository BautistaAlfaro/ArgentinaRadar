/**
 * categorize-existing.js
 *
 * Reads all news_items where category IS NULL, empty, or 'general',
 * runs the keyword-based categorizer, and updates each record.
 *
 * Reports category distribution at the end.
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.resolve(__dirname, '..', 'data', 'argentina-radar.db');
const db = new Database(DB_PATH);

// ─── Categorizer (pure JS port of shared/categorizer.ts) ──────────────

const KEYWORD_MAPS = {
  urgente: [
    'último momento', 'ultimo momento', 'urgente', 'emergencia',
    'alerta', 'explosión', 'explosion', 'terremoto', 'catástrofe', 'catastrofe',
  ],
  politica: [
    'milei', 'presidente', 'diputado', 'senador', 'congreso',
    'ley', 'decreto', 'ministro', 'gobernador', 'elección', 'eleccion',
    'votación', 'votacion',
  ],
  economia: [
    'dólar', 'dolar', 'inflación', 'inflacion', 'economía', 'economia',
    'fmi', 'bcra', 'mercado', 'finanzas', 'impuestos', 'subsidio',
    'deuda', 'pbi',
  ],
  deportes: [
    'fútbol', 'futbol', 'messi', 'selección', 'seleccion',
    'boca', 'river', 'mundial', 'liga', 'campeonato', 'gol', 'partido',
  ],
  policial: [
    'policía', 'policia', 'detenido', 'asesinato', 'robo',
    'crimen', 'delito', 'fiscal', 'justicia', 'juicio', 'cárcel', 'carcel',
  ],
  sociedad: [
    'salud', 'educación', 'educacion', 'protesta', 'marcha',
    'clima', 'temperatura', 'cultura',
  ],
};

function categorizeArticle(title, summary, _source) {
  const text = `${title} ${summary || ''}`.toLowerCase();

  let bestCategory = 'general';
  let bestScore = 0;

  for (const [category, keywords] of Object.entries(KEYWORD_MAPS)) {
    let score = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) {
        score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return bestCategory;
}

// ─── Main ─────────────────────────────────────────────────────────────

function main() {
  console.log('🔍 Categorizing existing articles...\n');

  // Fetch articles with null/empty/general category
  const articles = db.prepare(`
    SELECT id, title, summary, source, category
    FROM news_items
    WHERE category IS NULL OR category = '' OR category = 'general'
    ORDER BY ingested_at DESC
  `).all();

  console.log(`📦 Found ${articles.length} articles to categorize\n`);

  if (articles.length === 0) {
    console.log('✅ Nothing to do.');
    process.exit(0);
  }

  const updateStmt = db.prepare('UPDATE news_items SET category = ? WHERE id = ?');
  const counts = {};
  let updated = 0;

  const batch = db.transaction((items) => {
    for (const article of items) {
      const category = categorizeArticle(article.title, article.summary, article.source);
      updateStmt.run(category, article.id);
      counts[category] = (counts[category] || 0) + 1;
      updated++;
    }
  });

  batch(articles);

  console.log(`✅ Updated ${updated} articles\n`);

  // Report distribution
  console.log('📊 Category distribution:');
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  for (const [cat, cnt] of sorted) {
    console.log(`   ${cat.padEnd(12)} ${cnt}`);
  }

  // Also show full DB distribution
  console.log('\n📊 Full DB distribution:');
  const fullDist = db.prepare(
    'SELECT category, COUNT(*) as cnt FROM news_items GROUP BY category ORDER BY cnt DESC'
  ).all();
  for (const row of fullDist) {
    console.log(`   ${(row.category || 'NULL').padEnd(12)} ${row.cnt}`);
  }

  db.close();
}

main();
