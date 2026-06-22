/**
 * Admin Dashboard — Article & Approval Workflow Routes
 *
 * Provides REST endpoints for the new Dashboard Workflow (replaces Telegram).
 *
 *   GET    /api/admin/articles                — List articles with filters
 *   GET    /api/admin/articles/:id            — Single article detail
 *   POST   /api/admin/articles/:id/approve    — Approve + publish one article
 *   POST   /api/admin/articles/:id/reject     — Reject one article
 *   POST   /api/admin/articles/batch-approve  — Approve multiple articles
 *   GET    /api/admin/ai/status               — AI processor status
 *   POST   /api/admin/ai/threshold            — Update AI threshold
 *   POST   /api/admin/ai/reprocess            — Reprocess batch
 *
 * Auth is enforced by the parent router (ADMIN role required).
 */

import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

export const articlesRouter = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH =
  process.env.DB_PATH ??
  path.resolve(__dirname, '..', '..', '..', '..', 'data', 'argentina-radar.db');

const TWITTER_PUBLISHER_URL = process.env.TWITTER_PUBLISHER_URL ?? 'http://127.0.0.1:3004';
const AI_PROCESSOR_URL = process.env.AI_PROCESSOR_URL ?? 'http://127.0.0.1:3013';

/** Open a read-write connection and close it after the callback returns. */
function withDb<T>(fn: (db: Database.Database) => T): T {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

// ── Types ──────────────────────────────────────────────────────────────

interface ArticleRow {
  id: string;
  title: string;
  summary: string | null;
  source: string;
  url: string;
  category: string | null;
  published_at: string | null;
  ingested_at: string;
  location: string | null;
  ai_score: string | null;
  status: string;
  quality_score: number | null;
  engagement_score: number | null;
  relevance_score: number | null;
}

interface ApprovalQueueRow {
  id: string;
  article_id: string;
  draft_tweet: string;
  image_url: string | null;
  image_prompt: string | null;
  status: string;
  reviewed_at: string | null;
  created_at: string;
}

// ── Helpers ────────────────────────────────────────────────────────────

function safeJsonParse(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseAiScore(row: ArticleRow): Record<string, unknown> | null {
  return safeJsonParse(row.ai_score) as Record<string, unknown> | null;
}

/**
 * Publish a single article to Bluesky via the twitter-publisher service.
 */
async function publishToBluesky(
  articleId: string,
  text: string,
  imageUrl: string | null,
  url: string | null,
): Promise<{ success: boolean; error: string | null }> {
  try {
    const resp = await fetch(`${TWITTER_PUBLISHER_URL}/api/publish-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        article_id: articleId,
        text,
        image_url: imageUrl || null,
        url: url || null,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await resp.json() as { success?: boolean; error?: string };
    if (result.success) {
      return { success: true, error: null };
    }
    return { success: false, error: result.error || 'Unknown error' };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ── GET /api/admin/articles ────────────────────────────────────────────
//
// Query params: status, source, category, search, limit, offset

articlesRouter.get('/articles', (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    const source = req.query.source as string | undefined;
    const category = req.query.category as string | undefined;
    const search = req.query.search as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    const items = withDb((db) => {
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (status) {
        conditions.push('ni.status = ?');
        params.push(status);
      }
      if (source) {
        conditions.push('ni.source = ?');
        params.push(source);
      }
      if (category) {
        conditions.push('ni.category = ?');
        params.push(category);
      }
      if (search) {
        conditions.push('(ni.title LIKE ? OR ni.summary LIKE ?)');
        const like = `%${search}%`;
        params.push(like, like);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const total = (
        db.prepare(`SELECT COUNT(*) as count FROM news_items ni ${where}`).get(...params) as { count: number }
      ).count;

      const rows = db
        .prepare<unknown[], ArticleRow>(
          `SELECT ni.id, ni.title, ni.summary, ni.source, ni.url,
                  ni.category, ni.published_at, ni.ingested_at,
                  ni.location, ni.ai_score, ni.status,
                  ni.quality_score, ni.engagement_score, ni.relevance_score
           FROM news_items ni
           ${where}
           ORDER BY ni.ingested_at DESC
           LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset);

      return { total, items: rows };
    });

    // Enrich items with parsed AI scores
    const enriched = items.items.map((row) => ({
      ...row,
      ai_scores: parseAiScore(row),
    }));

    res.json({ total: items.total, items: enriched });
  } catch (err) {
    console.error('[articles] GET /articles error:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/admin/articles/sources ────────────────────────────────────
// Returns distinct source names with counts (for filter dropdowns)

articlesRouter.get('/articles/sources', (_req, res) => {
  try {
    const sources = withDb((db) => {
      return db
        .prepare<[], { source: string; count: number }>(
          `SELECT source, COUNT(*) as count
           FROM news_items
           GROUP BY source
           ORDER BY count DESC`,
        )
        .all();
    });
    res.json({ sources });
  } catch (err) {
    console.error('[articles] GET /articles/sources error:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/admin/articles/categories ─────────────────────────────────
// Returns distinct categories (for filter dropdowns)

articlesRouter.get('/articles/categories', (_req, res) => {
  try {
    const categories = withDb((db) => {
      return db
        .prepare<[], { category: string | null; count: number }>(
          `SELECT category, COUNT(*) as count
           FROM news_items
           WHERE category IS NOT NULL AND category != ''
           GROUP BY category
           ORDER BY count DESC`,
        )
        .all();
    });
    res.json({ categories });
  } catch (err) {
    console.error('[articles] GET /articles/categories error:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/admin/articles/stats ──────────────────────────────────────
// Returns aggregate stats for the workflow sidebar

articlesRouter.get('/articles/stats', (_req, res) => {
  try {
    const stats = withDb((db) => {
      const totalArts = (db.prepare('SELECT COUNT(*) as count FROM news_items').get() as { count: number }).count;
      const sourceCount = (db.prepare('SELECT COUNT(DISTINCT source) as count FROM news_items').get() as { count: number }).count;
      const pendingApproval = (db.prepare("SELECT COUNT(*) as count FROM approval_queue WHERE status = 'pending'").get() as { count: number }).count;
      const publishedToday = (db.prepare(
        "SELECT COUNT(*) as count FROM news_items WHERE status IN ('published', 'auto_published') AND date(published_at) = date('now')",
      ).get() as { count: number }).count;
      const scheduledCount = (db.prepare(
        "SELECT COUNT(*) as count FROM approval_queue WHERE status = 'approved'",
      ).get() as { count: number }).count;
      const ingestedToday = (db.prepare(
        "SELECT COUNT(*) as count FROM news_items WHERE date(ingested_at) = date('now')",
      ).get() as { count: number }).count;

      const lastRefresh = (db.prepare(
        'SELECT ingested_at FROM news_items ORDER BY ingested_at DESC LIMIT 1',
      ).get() as { ingested_at: string } | undefined)?.ingested_at ?? null;

      let aiModel = 'qwen2.5:7b';
      let aiThreshold = 5.0;
      let minQuality = 40;
      try {
        aiModel = process.env.OLLAMA_MODEL ?? 'qwen2.5:7b';
        aiThreshold = parseFloat(process.env.AI_THRESHOLD ?? '5.0');
        minQuality = parseInt(process.env.MIN_QUALITY_THRESHOLD ?? '40', 10);
      } catch { /* use defaults */ }

      return {
        totalArticles: totalArts,
        totalSources: sourceCount,
        pendingApproval,
        publishedToday,
        scheduledCount,
        ingestedToday,
        lastRefresh,
        aiModel,
        aiThreshold,
        minQuality,
      };
    });

    res.json(stats);
  } catch (err) {
    console.error('[articles] GET /articles/stats error:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/admin/articles/:id ────────────────────────────────────────
// Returns full article detail with approval queue info

articlesRouter.get('/articles/:id', (req, res) => {
  try {
    const { id } = req.params;

    const result = withDb((db) => {
      const article = db
        .prepare<[string], ArticleRow>(
          `SELECT id, title, summary, source, url, category,
                  published_at, ingested_at, location, ai_score, status,
                  quality_score, engagement_score, relevance_score
           FROM news_items WHERE id = ?`,
        )
        .get(id);

      if (!article) return null;

      const queueItem = db
        .prepare<[string], ApprovalQueueRow | undefined>(
          `SELECT id, article_id, draft_tweet, image_url, image_prompt,
                  status as queue_status, reviewed_at, created_at
           FROM approval_queue WHERE article_id = ?
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(id);

      return {
        ...article,
        ai_scores: parseAiScore(article),
        approval_queue: queueItem ?? null,
      };
    });

    if (!result) {
      res.status(404).json({ error: 'Article not found' });
      return;
    }

    res.json(result);
  } catch (err) {
    console.error('[articles] GET /articles/:id error:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/admin/articles/:id/approve ──────────────────────────────
// Approve a single article and publish to Bluesky

articlesRouter.post('/articles/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;

    const result = withDb((db) => {
      const article = db
        .prepare<[string], ArticleRow | undefined>(
          'SELECT id, title, source, category, url, status FROM news_items WHERE id = ?',
        )
        .get(id);

      if (!article) return { error: 'Article not found' };
      if (article.status === 'published' || article.status === 'auto_published') {
        return { error: 'Article already published' };
      }

      const queueItem = db
        .prepare<[string], ApprovalQueueRow | undefined>(
          `SELECT id, article_id, draft_tweet, image_url, status
           FROM approval_queue WHERE article_id = ? AND status = 'pending'
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(id);

      if (!queueItem) return { error: 'No pending approval queue item found for this article' };

      // Mark as approved in DB
      db.prepare("UPDATE approval_queue SET status = 'approved', reviewed_at = datetime('now') WHERE id = ?")
        .run(queueItem.id);
      db.prepare("UPDATE news_items SET status = 'published' WHERE id = ?")
        .run(article.id);

      return {
        success: true,
        articleId: article.id,
        title: article.title,
        approvalId: queueItem.id,
        draftTweet: queueItem.draft_tweet,
        imageUrl: queueItem.image_url,
      };
    });

    if (result.error) {
      res.status(400).json({ error: result.error });
      return;
    }

    // Publish to Bluesky (non-blocking from the response)
    const pubResult = await publishToBluesky(
      result.articleId,
      result.draftTweet,
      result.imageUrl,
      null,
    );

    console.log(`[articles] Approved ${result.articleId.slice(0, 8)} — Bluesky: ${pubResult.success ? 'OK' : pubResult.error}`);

    res.json({
      success: true,
      article_id: result.articleId,
      published: pubResult.success,
      publish_error: pubResult.error,
      message: pubResult.success
        ? `Article approved and published to Bluesky`
        : `Article approved but publish failed: ${pubResult.error}`,
    });
  } catch (err) {
    console.error('[articles] POST /articles/:id/approve error:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/admin/articles/:id/reject ───────────────────────────────
// Reject a single article

articlesRouter.post('/articles/:id/reject', (req, res) => {
  try {
    const { id } = req.params;

    const result = withDb((db) => {
      const article = db
        .prepare<[string], ArticleRow | undefined>(
          'SELECT id, title, status FROM news_items WHERE id = ?',
        )
        .get(id);

      if (!article) return { error: 'Article not found' };

      const queueItem = db
        .prepare<[string], ApprovalQueueRow | undefined>(
          `SELECT id, status FROM approval_queue
           WHERE article_id = ? AND status = 'pending'
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(id);

      if (!queueItem) return { error: 'No pending approval queue item found for this article' };

      db.prepare("UPDATE approval_queue SET status = 'rejected', reviewed_at = datetime('now') WHERE id = ?")
        .run(queueItem.id);
      db.prepare("UPDATE news_items SET status = 'discarded' WHERE id = ?")
        .run(article.id);

      return { success: true, articleId: article.id, title: article.title };
    });

    if (result.error) {
      res.status(400).json({ error: result.error });
      return;
    }

    console.log(`[articles] Rejected ${result.articleId.slice(0, 8)} — ${result.title?.slice(0, 40)}`);
    res.json({ success: true, article_id: result.articleId });
  } catch (err) {
    console.error('[articles] POST /articles/:id/reject error:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/admin/articles/batch-approve ────────────────────────────
// Approve a batch of articles (by article IDs)

articlesRouter.post('/articles/batch-approve', async (req, res) => {
  try {
    const { ids } = req.body as { ids: unknown };
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids must be a non-empty array of strings' });
      return;
    }

    const stringIds: string[] = ids.map(String);
    const placeholders = stringIds.map(() => '?').join(', ');

    const batchResult = withDb((db) => {
      // Get all pending queue items for these article IDs
      const queueItems = db
        .prepare<unknown[], { id: string; article_id: string; draft_tweet: string; image_url: string | null }>(
          `SELECT aq.id, aq.article_id, aq.draft_tweet, aq.image_url
           FROM approval_queue aq
           WHERE aq.article_id IN (${placeholders}) AND aq.status = 'pending'`,
        )
        .all(...stringIds);

      if (queueItems.length === 0) return { approved: 0, items: [] };

      const now = new Date().toISOString();
      const approveQueue = db.prepare("UPDATE approval_queue SET status = 'approved', reviewed_at = ? WHERE id = ?");
      const updateArticle = db.prepare("UPDATE news_items SET status = 'published' WHERE id = ?");

      const approveAll = db.transaction(() => {
        for (const item of queueItems) {
          approveQueue.run(now, item.id);
          updateArticle.run(item.article_id);
        }
      });

      approveAll();
      return { approved: queueItems.length, items: queueItems };
    });

    if (batchResult.approved === 0) {
      res.json({ approved: 0, message: 'No pending items found for the given IDs' });
      return;
    }

    // Publish to Bluesky asynchronously (non-blocking)
    const publishResults = await Promise.allSettled(
      batchResult.items.map((item) =>
        publishToBluesky(item.article_id, item.draft_tweet, item.image_url, null),
      ),
    );

    const published = publishResults.filter((r) => r.status === 'fulfilled' && r.value.success).length;
    const failed = publishResults.filter((r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)).length;

    console.log(`[articles] Batch approve: ${batchResult.approved} items, ${published} published, ${failed} failed`);

    res.json({
      approved: batchResult.approved,
      published,
      failed,
      message: `${batchResult.approved} items approved. ${published} published to Bluesky.`,
    });
  } catch (err) {
    console.error('[articles] POST /articles/batch-approve error:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/admin/ai/status ──────────────────────────────────────────

articlesRouter.get('/ai/status', async (_req, res) => {
  try {
    // Try to reach the AI processor for live status
    let aiStatus = 'unknown';
    let modelName = process.env.OLLAMA_MODEL ?? 'qwen2.5:7b';

    try {
      const resp = await fetch(`${AI_PROCESSOR_URL}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (resp.ok) {
        aiStatus = 'ok';
        const body = await resp.json() as { model?: string };
        if (body.model) modelName = body.model;
      } else {
        aiStatus = 'degraded';
      }
    } catch {
      aiStatus = 'down';
    }

    const threshold = parseFloat(process.env.AI_THRESHOLD ?? '5.0');
    const minQuality = parseInt(process.env.MIN_QUALITY_THRESHOLD ?? '40', 10);
    const aiProvider = process.env.AI_PROVIDER ?? 'ollama';

    res.json({
      status: aiStatus,
      provider: aiProvider,
      model: modelName,
      threshold,
      min_quality: minQuality,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[articles] GET /ai/status error:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/admin/ai/threshold ──────────────────────────────────────
// Note: This updates the runtime env — persistent change requires .env edit

articlesRouter.post('/ai/threshold', (req, res) => {
  try {
    const { threshold } = req.body as { threshold?: unknown };
    const parsed = parseFloat(String(threshold));

    if (isNaN(parsed) || parsed < 0 || parsed > 10) {
      res.status(400).json({ error: 'threshold must be a number between 0 and 10' });
      return;
    }

    // Update process.env for this session (persistent change requires config edit)
    process.env.AI_THRESHOLD = String(parsed);

    console.log(`[articles] AI threshold updated to ${parsed} (runtime only)`);
    res.json({
      success: true,
      threshold: parsed,
      message: `AI threshold updated to ${parsed}. This change is runtime-only; edit .env for persistence.`,
    });
  } catch (err) {
    console.error('[articles] POST /ai/threshold error:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/admin/ai/reprocess ──────────────────────────────────────
// Triggers reprocessing of articles via the news-ingestion service

articlesRouter.post('/ai/reprocess', async (_req, res) => {
  try {
    const NEWS_SERVICE_URL = process.env.NEWS_SERVICE_URL ?? 'http://127.0.0.1:3001';
    const limit = 50;

    const resp = await fetch(`${NEWS_SERVICE_URL}/api/admin/actions/reprocess?limit=${limit}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });

    if (resp.ok) {
      const data = await resp.json() as { message?: string; status?: string };
      res.json({
        success: true,
        message: data.message ?? data.status ?? `Reprocessing last ${limit} articles`,
      });
    } else {
      const text = await resp.text().catch(() => 'Unknown error');
      res.status(502).json({ success: false, message: `Reprocess failed: HTTP ${resp.status}: ${text.slice(0, 200)}` });
    }
  } catch (err) {
    res.status(502).json({
      success: false,
      message: `Reprocess failed: ${(err as Error).message}`,
    });
  }
});
