/**
 * Twitter Publisher REST Service
 *
 * Express server on port 3004:
 *   POST /api/publish/:id  — Manual publish (force-queue an article)
 *   GET  /api/tweets        — Return tweet history
 *   GET  /api/tweets/stats  — Quota usage, success/fail/dead-letter counts
 *   GET  /api/stats/daily   — Daily tweet count & remaining quota
 *   GET  /health            — Service status
 */

import express from 'express';
import Database from 'better-sqlite3';
import { config } from './config.js';
import { publishArticle, publishText } from './publisher.js';
import { getQuotaInfo, getDailyTweetCount } from './rateLimiter.js';
import { getDeadLetterQueue, getDeadLetterCount } from './deadLetter.js';
import { ERRORS } from '../../../shared/errorMessages.js';

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

// CORS for dev mode (dashboard health checks from :5173)
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') { res.sendStatus(200); return; }
  next();
});

// ─── POST /api/publish/:id — Manual publish ───────────────────────────────

app.post('/api/publish/:id', async (req, res) => {
  try {
    const articleId = req.params.id;
    const d = getDb();

    const article = d
      .prepare('SELECT * FROM news_items WHERE id = ?')
      .get(articleId) as Record<string, unknown> | undefined;

    if (!article) {
      res.status(404).json({ error: ERRORS.ARTICLE_NOT_FOUND });
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
    res.status(500).json({ error: ERRORS.PUBLISH_FAILED, details: String(err) });
  }
});

// ─── POST /api/publish-text — Publish a draft with arbitrary text ───────
// Called by hermes-bridge when a tweet draft is approved via Telegram.

app.post('/api/publish-text', async (req, res) => {
  try {
    const { article_id, text, image_url, url } = req.body;

    if (!article_id || !text) {
      res.status(400).json({ error: 'article_id y text son obligatorios' });
      return;
    }

    if (typeof text !== 'string' || text.trim().length === 0) {
      res.status(400).json({ error: 'text debe ser un texto no vacío' });
      return;
    }

    // Validate image_url if provided
    if (image_url !== undefined && typeof image_url !== 'string') {
      res.status(400).json({ error: 'image_url debe ser un texto si se proporciona' });
      return;
    }

    // Validate url if provided
    if (url !== undefined && typeof url !== 'string') {
      res.status(400).json({ error: 'url debe ser un texto si se proporciona' });
      return;
    }

    const result = await publishText(article_id, text.trim(), image_url || undefined, url || undefined);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: ERRORS.PUBLISH_FAILED, details: String(err) });
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
      .json({ error: ERRORS.DB_ERROR, details: String(err) });
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
      .json({ error: ERRORS.DB_ERROR, details: String(err) });
  }
});

// ─── GET /api/stats/daily — Daily tweet stats ─────────────────────────────

app.get('/api/stats/daily', (_req, res) => {
  try {
    const dailyCount = getDailyTweetCount();
    const dailyLimit = config.publishing.dailyLimit;
    res.json({
      postedToday: dailyCount,
      dailyLimit,
      remainingToday: Math.max(0, dailyLimit - dailyCount),
      date: new Date().toISOString().split('T')[0],
    });
  } catch (err) {
    res
      .status(500)
      .json({ error: ERRORS.DB_ERROR, details: String(err) });
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
    console.log(`[twitter-publisher]   POST /api/publish/:id   — Manual publish`);
    console.log(`[twitter-publisher]   POST /api/publish-text  — Publish approval draft`);
    console.log(`[twitter-publisher]   GET  /api/tweets        — Tweet history`);
    console.log(`[twitter-publisher]   GET  /api/tweets/stats  — Quota & stats`);
    console.log(`[twitter-publisher]   GET  /api/stats/daily   — Daily tweet stats`);
    console.log(`[twitter-publisher]   GET  /health            — Service health`);
  });
}
