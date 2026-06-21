/**
 * Initialize the article_clusters table in the database.
 *
 * Idempotent — safe to run multiple times (uses IF NOT EXISTS).
 *
 * Also adds a cluster_id column to news_items if it doesn't exist.
 *
 * Usage:
 *   node scripts/init-clusters-table.js
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.resolve(__dirname, '..', 'data', 'argentina-radar.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// ─── Main clusters table ─────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS article_clusters (
    id           TEXT PRIMARY KEY,
    topic        TEXT NOT NULL,
    article_ids  TEXT NOT NULL,  -- JSON array of article IDs
    source_count INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now'))
  )
`);

console.log('[init-clusters] ✅ article_clusters table ready');

// ─── Index for time-based queries ────────────────────────────────────────

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_clusters_created_at
    ON article_clusters(created_at DESC)
`);

console.log('[init-clusters] ✅ idx_clusters_created_at index ready');

// ─── Add cluster_id column to news_items if missing ──────────────────────

try {
  db.exec(`ALTER TABLE news_items ADD COLUMN cluster_id TEXT`);
  console.log('[init-clusters] ✅ Added cluster_id column to news_items');
} catch {
  // Column already exists — ignore
  console.log('[init-clusters] ℹ️  cluster_id column already exists on news_items');
}

try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_news_cluster_id ON news_items(cluster_id)`);
  console.log('[init-clusters] ✅ idx_news_cluster_id index ready');
} catch {
  console.log('[init-clusters] ℹ️  idx_news_cluster_id index already exists');
}

db.close();
console.log('[init-clusters] Done.');
