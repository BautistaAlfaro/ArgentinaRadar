import express from 'express';
import { getDb } from './db.js';

const PORT = parseInt(process.env.PORT ?? '3001', 10);

/**
 * Start the Express REST API server.
 *
 * @param getIngestionState — callback to retrieve current ingestion stats
 * @returns the Express server instance
 */
export function startServer(
  getIngestionState?: () => { lastRun: string | null; ingestionCount: number },
) {
  const app = express();
  app.use(express.json());

  // ─── CORS (allow web frontend) ─────────────────────────────────────
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    next();
  });

  // ─── GET /api/news — paginated list of all news items ─────────
  app.get('/api/news', (req, res) => {
    try {
      const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10), 200);
      const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10), 0);
      const category = req.query.category as string | undefined;
      const status = req.query.status as string | undefined;

      let sql = 'SELECT * FROM news_items';
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (category) {
        conditions.push('category = ?');
        params.push(category);
      }
      if (status) {
        conditions.push('status = ?');
        params.push(status);
      }

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }

      sql += ' ORDER BY published_at DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const db = getDb();
      const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
      const total = (db.prepare('SELECT COUNT(*) as count FROM news_items').get() as { count: number }).count;

      const items = rows.map(rowToJson);

      res.json({ items, total, limit, offset });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch news items', details: String(err) });
    }
  });

  // ─── GET /api/news/:id — single news item ────────────────────
  app.get('/api/news/:id', (req, res) => {
    try {
      const db = getDb();
      const row = db.prepare('SELECT * FROM news_items WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;

      if (!row) {
        res.status(404).json({ error: 'Article not found' });
        return;
      }

      res.json(rowToJson(row));
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch article', details: String(err) });
    }
  });

  // ─── GET /health — service health ─────────────────────────────
  app.get('/health', (_req, res) => {
    try {
      const db = getDb();
      const totalArticles = (db.prepare('SELECT COUNT(*) as count FROM news_items').get() as { count: number }).count;
      const degradedSources = (db.prepare("SELECT COUNT(*) as count FROM sources WHERE status = 'degraded'").get() as { count: number }).count;
      const totalSources = (db.prepare('SELECT COUNT(*) as count FROM sources').get() as { count: number }).count;

      const state = getIngestionState?.();

      res.json({
        status: 'ok',
        uptime: process.uptime(),
        lastRun: state?.lastRun ?? null,
        ingestionCount: state?.ingestionCount ?? 0,
        articles: { total: totalArticles },
        sources: {
          total: totalSources,
          degraded: degradedSources,
        },
      });
    } catch (err) {
      res.status(500).json({ error: 'Health check failed', details: String(err) });
    }
  });

  const server = app.listen(PORT, () => {
    console.log(`[server] REST API listening on http://localhost:${PORT}`);
    console.log(`[server]   GET /api/news     — paginated news list`);
    console.log(`[server]   GET /api/news/:id  — single article`);
    console.log(`[server]   GET /health        — service health`);
  });

  return server;
}

/** Convert a SQLite row (snake_case keys) to camelCase JSON. */
function rowToJson(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    source: row.source,
    sources: safeParseJson(row.sources),
    url: row.url,
    category: row.category,
    publishedAt: row.published_at,
    ingestedAt: row.ingested_at,
    location: row.location ? safeParseJson(row.location) : null,
    aiScore: row.ai_score ? safeParseJson(row.ai_score) : null,
    tweetId: row.tweet_id ?? null,
    status: row.status,
  };
}

function safeParseJson(val: unknown): unknown {
  if (typeof val !== 'string') return val;
  try {
    return JSON.parse(val);
  } catch {
    return val;
  }
}
