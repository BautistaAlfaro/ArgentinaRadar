import express from 'express';
import { getDb } from './db.js';
import { getTrendingTopics } from '../../../shared/trending.js';
import { clusterArticles } from '../../../shared/clustering.js';
import type { NewsItem } from '../../../shared/types/index.js';

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

  // ─── GET /api/quality/stats — quality metrics dashboard ────
  app.get('/api/quality/stats', (_req, res) => {
    try {
      const db = getDb();

      // Average quality scores over time (grouped by day, last 30 days)
      const avgScores = db.prepare(`
        SELECT DATE(ingested_at) as day,
               AVG(quality_score) as avg_quality,
               AVG(engagement_score) as avg_engagement,
               AVG(relevance_score) as avg_relevance,
               COUNT(*) as article_count
        FROM news_items
        WHERE quality_score > 0
          AND ingested_at >= datetime('now', '-30 days')
        GROUP BY DATE(ingested_at)
        ORDER BY day DESC
        LIMIT 30
      `).all() as Array<{
        day: string; avg_quality: number; avg_engagement: number;
        avg_relevance: number; article_count: number;
      }>;

      // Top 10 highest quality articles
      const topArticles = db.prepare(`
        SELECT id, title, source, category, quality_score, engagement_score, relevance_score, ingested_at
        FROM news_items
        WHERE quality_score > 0
        ORDER BY quality_score DESC
        LIMIT 10
      `).all() as Array<{
        id: string; title: string; source: string; category: string | null;
        quality_score: number; engagement_score: number; relevance_score: number;
        ingested_at: string;
      }>;

      // Source quality ranking
      const sourceRanking = db.prepare(`
        SELECT source,
               AVG(quality_score) as avg_quality,
               AVG(engagement_score) as avg_engagement,
               AVG(relevance_score) as avg_relevance,
               COUNT(*) as article_count
        FROM news_items
        WHERE quality_score > 0
        GROUP BY source
        ORDER BY avg_quality DESC
      `).all() as Array<{
        source: string; avg_quality: number; avg_engagement: number;
        avg_relevance: number; article_count: number;
      }>;

      // Summary stats
      const summary = db.prepare(`
        SELECT
          AVG(quality_score) as avg_quality,
          AVG(engagement_score) as avg_engagement,
          AVG(relevance_score) as avg_relevance,
          COUNT(*) as scored_articles,
          SUM(CASE WHEN quality_score >= 60 THEN 1 ELSE 0 END) as high_quality,
          SUM(CASE WHEN quality_score >= 40 AND quality_score < 60 THEN 1 ELSE 0 END) as medium_quality,
          SUM(CASE WHEN quality_score > 0 AND quality_score < 40 THEN 1 ELSE 0 END) as low_quality
        FROM news_items
        WHERE quality_score > 0
      `).get() as {
        avg_quality: number; avg_engagement: number; avg_relevance: number;
        scored_articles: number; high_quality: number; medium_quality: number; low_quality: number;
      };

      res.json({ avgScores, topArticles, sourceRanking, summary });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch quality stats', details: String(err) });
    }
  });

  // ─── GET /api/quality/thresholds — current quality config ──
  app.get('/api/quality/thresholds', (_req, res) => {
    res.json({
      min_quality_threshold: parseInt(process.env.MIN_QUALITY_THRESHOLD ?? '40', 10),
      min_engagement_prediction: parseInt(process.env.MIN_ENGAGEMENT_PREDICTION ?? '30', 10),
    });
  });

  // ─── GET /api/pipeline/stats — pipeline dashboard stats ──────
  app.get('/api/pipeline/stats', (_req, res) => {
    try {
      const db = getDb();

      // Pipeline status counts
      const pipelineStatuses = db.prepare(
        "SELECT status, COUNT(*) as count FROM news_items GROUP BY status"
      ).all() as Array<{ status: string; count: number }>;

      const pipeline: Record<string, number> = {};
      for (const row of pipelineStatuses) {
        pipeline[row.status] = row.count;
      }

      // Category distribution
      const categories = db.prepare(
        "SELECT category, COUNT(*) as count FROM news_items WHERE category IS NOT NULL AND category != '' GROUP BY category ORDER BY count DESC"
      ).all() as Array<{ category: string; count: number }>;

      // Approval queue status
      const approvalStatuses = db.prepare(
        "SELECT status, COUNT(*) as count FROM approval_queue GROUP BY status"
      ).all() as Array<{ status: string; count: number }>;

      const approvalQueue: Record<string, number> = {};
      for (const row of approvalStatuses) {
        approvalQueue[row.status] = row.count;
      }

      // Recent 20 articles
      const recent = db.prepare(
        "SELECT id, title, source, category, status, published_at, ingested_at FROM news_items ORDER BY ingested_at DESC LIMIT 20"
      ).all() as Array<{
        id: string; title: string; source: string;
        category: string | null; status: string;
        published_at: string | null; ingested_at: string;
      }>;

      res.json({
        pipeline,
        categories,
        approvalQueue,
        recent: recent.map((r) => ({
          id: r.id,
          title: r.title,
          source: r.source,
          category: r.category,
          status: r.status,
          publishedAt: r.published_at,
          ingestedAt: r.ingested_at,
        })),
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch pipeline stats', details: String(err) });
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

  // ─── GET /api/trending — trending topics ────────────────────────
  app.get('/api/trending', (req, res) => {
    try {
      const hoursAgo = parseInt(String(req.query.hours ?? '24'), 10);
      const db = getDb();

      const rows = db.prepare(
        `SELECT * FROM news_items
         WHERE ingested_at >= datetime('now', ?)
         ORDER BY published_at DESC`
      ).all(`-${hoursAgo} hours`) as Array<Record<string, unknown>>;

      const articles: NewsItem[] = rows.map(rowToJson) as unknown as NewsItem[];
      const topics = getTrendingTopics(articles);

      res.json({
        topics,
        totalArticles: articles.length,
        window: `${hoursAgo}h`,
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to compute trending topics', details: String(err) });
    }
  });

  // ─── GET /api/clusters — article clusters ───────────────────────
  app.get('/api/clusters', (req, res) => {
    try {
      const hoursAgo = parseInt(String(req.query.hours ?? '24'), 10);
      const threshold = parseFloat(String(req.query.threshold ?? '0.3'));
      const db = getDb();

      const rows = db.prepare(
        `SELECT * FROM news_items
         WHERE ingested_at >= datetime('now', ?)
         ORDER BY published_at DESC`
      ).all(`-${hoursAgo} hours`) as Array<Record<string, unknown>>;

      const articles: NewsItem[] = rows.map(rowToJson) as unknown as NewsItem[];
      const clusters = clusterArticles(articles, threshold);
      const multiSource = clusters.filter((c) => c.articleCount > 1);

      res.json({
        clusters: multiSource,
        totalClusters: clusters.length,
        multiSourceClusters: multiSource.length,
        window: `${hoursAgo}h`,
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to compute clusters', details: String(err) });
    }
  });

  const server = app.listen(PORT, () => {
    console.log(`[server] REST API listening on http://localhost:${PORT}`);
    console.log(`[server]   GET /api/news            — paginated news list`);
    console.log(`[server]   GET /api/news/:id         — single article`);
    console.log(`[server]   GET /api/pipeline/stats   — pipeline dashboard stats`);
    console.log(`[server]   GET /api/trending         — trending topics`);
    console.log(`[server]   GET /api/clusters         — article clusters`);
    console.log(`[server]   GET /health               — service health`);
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
    // AI enrichment (added in PR 2.3)
    embedding: row.embedding ? safeParseJson(row.embedding) : null,
    entities: row.entities ? safeParseJson(row.entities) : null,
    aiCategory: row.ai_category ?? null,
    // Quality scores (v2)
    qualityScore: row.quality_score ?? null,
    engagementScore: row.engagement_score ?? null,
    relevanceScore: row.relevance_score ?? null,
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
