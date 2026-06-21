import type Database from 'better-sqlite3';

/**
 * Run all schema migrations in order. Idempotent — uses IF NOT EXISTS.
 */
export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS news_items (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      summary     TEXT,
      source      TEXT NOT NULL,
      sources     TEXT NOT NULL DEFAULT '[]',
      url         TEXT NOT NULL UNIQUE,
      category    TEXT,
      published_at TEXT,
      ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
      location    TEXT,
      ai_score    TEXT,
      tweet_id    TEXT,
      status      TEXT NOT NULL DEFAULT 'ingested'
    );

    CREATE TABLE IF NOT EXISTS sources (
      name          TEXT PRIMARY KEY,
      type          TEXT NOT NULL,
      url           TEXT NOT NULL,
      category      TEXT,
      rate_limit_ms INTEGER DEFAULT 2000,
      status        TEXT NOT NULL DEFAULT 'healthy',
      last_fetched_at TEXT,
      last_error      TEXT,
      consecutive_failures INTEGER DEFAULT 0,
      css_selectors TEXT
    );

    CREATE TABLE IF NOT EXISTS tweet_history (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id TEXT NOT NULL,
      tweet_id  TEXT,
      posted_at TEXT,
      status    TEXT NOT NULL DEFAULT 'pending',
      error     TEXT,
      FOREIGN KEY (article_id) REFERENCES news_items(id)
    );

    CREATE INDEX IF NOT EXISTS idx_news_status ON news_items(status);
    CREATE INDEX IF NOT EXISTS idx_news_published_at ON news_items(published_at);
    CREATE INDEX IF NOT EXISTS idx_news_category ON news_items(category);
    CREATE INDEX IF NOT EXISTS idx_news_url_hash ON news_items(url);
  `);

  // ─── AI processing columns (added idempotently) ──────────────────
  const aiColumns = [
    'ALTER TABLE news_items ADD COLUMN embedding TEXT',
    'ALTER TABLE news_items ADD COLUMN entities TEXT',
    'ALTER TABLE news_items ADD COLUMN ai_category TEXT',
  ];

  for (const sql of aiColumns) {
    try {
      db.exec(sql);
      console.log(`[migrations] Executed: ${sql}`);
    } catch {
      // Column already exists — ignore on subsequent runs
    }
  }

  // ─── Health monitoring columns (added idempotently) ──────────────
  const healthColumns = [
    "ALTER TABLE sources ADD COLUMN last_error TEXT",
    "ALTER TABLE sources ADD COLUMN consecutive_failures INTEGER DEFAULT 0",
  ];

  for (const sql of healthColumns) {
    try {
      db.exec(sql);
      console.log(`[migrations] Executed: ${sql}`);
    } catch {
      // Column already exists
    }
  }

  // ─── Translation columns (added idempotently) ───────────────────
  const translationColumns = [
    'ALTER TABLE news_items ADD COLUMN title_en TEXT',
    'ALTER TABLE news_items ADD COLUMN summary_en TEXT',
    'ALTER TABLE news_items ADD COLUMN translated INTEGER DEFAULT 0',
    'ALTER TABLE news_items ADD COLUMN detected_language TEXT',
  ];

  for (const sql of translationColumns) {
    try {
      db.exec(sql);
      console.log(`[migrations] Executed: ${sql}`);
    } catch {
      // Column already exists
    }
  }

  // ─── Quality scoring columns (v2) ────────────────────────────────
  const qualityColumns = [
    "ALTER TABLE news_items ADD COLUMN quality_score REAL DEFAULT 0",
    "ALTER TABLE news_items ADD COLUMN engagement_score REAL DEFAULT 0",
    "ALTER TABLE news_items ADD COLUMN relevance_score REAL DEFAULT 0",
  ];

  for (const sql of qualityColumns) {
    try {
      db.exec(sql);
      console.log(`[migrations] Executed: ${sql}`);
    } catch {
      // Column already exists
    }
  }

  console.log('[migrations] Schema up to date');
}
