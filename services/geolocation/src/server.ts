/**
 * Geolocation REST Service
 *
 * Express server on port 3002 that:
 *   - POST /api/geolocate — Accept article text, return location
 *   - GET /api/news/geolocated — Return news items with location data
 *   - Background loop: poll news-ingestion for new articles, geolocate them,
 *     store results in SQLite
 */

import express from 'express';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { geolocate } from './index.js';
import type { ExtractedLocation } from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT ?? '3002', 10);
const NEWS_SERVICE_URL = process.env.NEWS_SERVICE_URL ?? 'http://localhost:3001';
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL ?? '30000', 10);
const DB_PATH = process.env.DB_PATH ?? path.resolve(__dirname, '..', '..', '..', 'data', 'argentina-radar.db');
const EVENT_DETECTOR_URL = process.env.EVENT_DETECTOR_URL ?? 'http://localhost:3008';

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  return db;
}

const app = express();
app.use(express.json());

// ─── CORS (allow web frontend) ─────────────────────────────────────
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  next();
});

// ─── POST /api/geolocate — Extract location from article text ──
app.post('/api/geolocate', (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'Missing or invalid "text" field' });
      return;
    }
    const location = geolocate(text);
    res.json(location);
  } catch (err) {
    res.status(500).json({ error: 'Geolocation failed', details: String(err) });
  }
});

// ─── GET /api/news/geolocated — News with location data ────────
app.get('/api/news/geolocated', (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10), 200);
    const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10), 0);
    const category = req.query.category as string | undefined;
    const province = req.query.province as string | undefined;

    const d = getDb();
    const conditions: string[] = [
      "location IS NOT NULL",
      "status IN ('geolocated','filtered','published','discarded')",
    ];
    const params: unknown[] = [];

    if (category) {
      conditions.push('category = ?');
      params.push(category);
    }
    if (province) {
      conditions.push("json_extract(location, '$.province') LIKE ?");
      params.push(`%${province}%`);
    }

    const whereClause = conditions.join(' AND ');

    // Data query with ordering and pagination
    const dataSql = `SELECT * FROM news_items WHERE ${whereClause} ORDER BY published_at DESC LIMIT ? OFFSET ?`;
    const dataParams = [...params, limit, offset];
    const rows = d.prepare(dataSql).all(...dataParams) as Array<Record<string, unknown>>;

    // Count query with same filters (no pagination)
    const countSql = `SELECT COUNT(*) as count FROM news_items WHERE ${whereClause}`;
    const total = (d.prepare(countSql).get(...params) as { count: number }).count;

    const items = rows.map((row) => ({
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
    }));

    res.json({ items, total, limit, offset });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch geolocated news', details: String(err) });
  }
});

// ─── GET /health — Service health check ────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    port: PORT,
  });
});

function safeParseJson(val: unknown): unknown {
  if (typeof val !== 'string') return val;
  try {
    return JSON.parse(val);
  } catch {
    return val;
  }
}

// ─── Background polling loop ──────────────────────────────────
async function pollAndGeolocate(): Promise<void> {
  try {
    const resp = await fetch(`${NEWS_SERVICE_URL}/api/news?status=ingested&limit=50`);
    if (!resp.ok) {
      console.warn(`[geolocation] News service returned ${resp.status}`);
      return;
    }
    const data = await resp.json() as { items: Array<Record<string, unknown>> };
    if (!data.items || data.items.length === 0) return;

    console.log(`[geolocation] Processing ${data.items.length} new articles...`);
    const d = getDb();
    const updateStmt = d.prepare(
      `UPDATE news_items SET location = ?, status = 'geolocated' WHERE id = ? AND status = 'ingested'`
    );

    for (const article of data.items) {
      const title = String(article.title ?? '');
      const summary = String(article.summary ?? '');
      const text = `${title}. ${summary}`.trim();
      const location = geolocate(text);

      updateStmt.run(JSON.stringify(location), article.id);
      console.log(`  ✓ ${String(article.id).slice(0, 8)}… → ${location.province || '(unknown)'} (confidence: ${location.confidence})`);

      // ── Push to event-detector if article has embedding data ──────────
      if (article.embedding) {
        try {
          const detectResp = await fetch(`${EVENT_DETECTOR_URL}/api/detect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: article.title,
              summary: article.summary,
              source: article.source,
              url: article.url,
              publishedAt: article.publishedAt,
              embedding: article.embedding,
            }),
          });
          if (!detectResp.ok) {
            console.warn(`[geolocation] event-detector returned ${detectResp.status} for ${String(article.id).slice(0, 8)}…`);
          }
        } catch (err) {
          console.warn(`[geolocation] event-detector unreachable for ${String(article.id).slice(0, 8)}…:`, (err as Error).message);
        }
      }
    }
  } catch (err) {
    console.error('[geolocation] Poll/geolocate error:', err);
  }
}

// ─── Server start ─────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`[geolocation] REST API listening on http://localhost:${PORT}`);
  console.log(`[geolocation]   POST /api/geolocate    — Extract location from text`);
  console.log(`[geolocation]   GET  /api/news/geolocated — Geolocated news items`);
  console.log(`[geolocation]   GET  /health           — Service health`);
  console.log(`[geolocation] Polling news service at ${NEWS_SERVICE_URL} every ${POLL_INTERVAL_MS}ms`);

  // Start background polling
  pollAndGeolocate();
  setInterval(pollAndGeolocate, POLL_INTERVAL_MS);
});

// Graceful shutdown
const shutdown = () => {
  console.log('[geolocation] Shutting down...');
  server.close();
  if (db) {
    db.close();
    db = null;
  }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
