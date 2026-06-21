/**
 * Twitter Publisher REST Service
 *
 * Express server on port 3004:
 *   POST /api/publish/:id — Manual publish (force-queue an article)
 *   GET  /api/tweets       — Return tweet history
 *   GET  /api/tweets/stats — Quota usage, success/fail/dead-letter counts
 *   GET  /health           — Service status
 */

import express from 'express';
import Database from 'better-sqlite3';
import { config } from './config.js';
import { publishArticle } from './publisher.js';
import { getQuotaInfo } from './rateLimiter.js';
import { getDeadLetterQueue, getDeadLetterCount } from './deadLetter.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PORT = config.server.port;

// ---------------------------------------------------------------------------
// DB singleton
// ---------------------------------------------------------------------------

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;
  db = new Database(config.db.path);
  db.pragma('journal_mode = WAL');
  return db;
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

// ─── POST /api/publish/:id — Manual publish ───────────────────────────────

app.post('/api/publish/:id', async (req, res) => {
  try {
    const articleId = req.params.id;
    const d = getDb();

    const article = d
      .prepare('SELECT * FROM news_items WHERE id = ?')
      .get(articleId) as Record<string, unknown> | undefined;

    if (!article) {
      res.status(404).json({ error: 'Article not found' });
      return;
    }

    // Parse location JSON
    let locationStr: string | null = null;
    if (article.location) {
      const loc =
        typeof article.location === 'string'
          ? JSON.parse(article.location)
          : article.location;
      locationStr = (loc as { city?: string; province?: string }).city ??
        (loc as { province?: string }).province ??
        null;
    }

    const result = await publishArticle(
      articleId,
      String(article.title ?? ''),
      String(article.source ?? ''),
      locationStr,
      String(article.url ?? ''),
    );

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Publish failed', details: String(err) });
  }
});

// ─── GET /api/tweets — Tweet history ──────────────────────────────────────

app.get('/api/tweets', (req, res) => {
  try {
    const limit = Math.min(
      parseInt(String(req.query.limit ?? '50'), 10),
      200,
    );
    const offset = Math.max(
      parseInt(String(req.query.offset ?? '0'), 10),
      0,
    );

    const d = getDb();
    const rows = d
      .prepare(
        'SELECT * FROM tweet_history ORDER BY COALESCE(posted_at, created_at) DESC LIMIT ? OFFSET ?'
      )
      .all(limit, offset);

    const { count: total } = d
      .prepare('SELECT COUNT(*) as count FROM tweet_history')
      .get() as { count: number };

    res.json({ items: rows, total, limit, offset });
  } catch (err) {
    res
      .status(500)
      .json({ error: 'Failed to fetch tweet history', details: String(err) });
  }
});

// ─── GET /api/tweets/stats — Quota + success/fail/dead-letter ────────────

app.get('/api/tweets/stats', (_req, res) => {
  try {
    const d = getDb();
    const quota = getQuotaInfo();

    const { count: successCount } = d
      .prepare("SELECT COUNT(*) as count FROM tweet_history WHERE status = 'success'")
      .get() as { count: number };

    const { count: failCount } = d
      .prepare(
        "SELECT COUNT(*) as count FROM tweet_history WHERE status IN ('failed', 'dead_letter')"
      )
      .get() as { count: number };

    const { count: retryingCount } = d
      .prepare("SELECT COUNT(*) as count FROM tweet_history WHERE status = 'retrying'")
      .get() as { count: number };

    const deadLetterCount = getDeadLetterCount();

    const deadLetterItems = getDeadLetterQueue().slice(0, 10);

    res.json({
      quota,
      counts: {
        success: successCount,
        failed: failCount,
        retrying: retryingCount,
        deadLetter: deadLetterCount,
      },
      recentDeadLetters: deadLetterItems,
    });
  } catch (err) {
    res
      .status(500)
      .json({ error: 'Failed to get stats', details: String(err) });
  }
});

// ─── GET /health — Service health ─────────────────────────────────────────

app.get('/health', (_req, res) => {
  const quota = getQuotaInfo();
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    port: PORT,
    quota,
  });
});

// ─── Start server (exported for index.ts) ─────────────────────────────────

export function startServer(): void {
  app.listen(PORT, () => {
    console.log(`[twitter-publisher] 🚀 REST API on http://localhost:${PORT}`);
    console.log(`[twitter-publisher]   POST /api/publish/:id — Manual publish`);
    console.log(`[twitter-publisher]   GET  /api/tweets       — Tweet history`);
    console.log(`[twitter-publisher]   GET  /api/tweets/stats — Quota & stats`);
    console.log(`[twitter-publisher]   GET  /health           — Service health`);
  });
}
