/**
 * Event Detector Service — Express Server.
 *
 * Provides the REST API for event detection and retrieval:
 *   POST /api/detect              — Receive article, find or create event
 *   GET  /api/events              — Paginated event list with filters
 *   GET  /api/events/political    — Filter events by political figure + sentiment
 *   GET  /api/events/trending     — Top 10 events by impact
 *   GET  /api/events/:id          — Single event with full detail
 *   GET  /health                  — Service health
 *
 * Port: 3008 (configurable via PORT env var).
 */

import Database from 'better-sqlite3';
import express from 'express';

import { config } from './config.js';
import { detectEvent } from './detector.js';
import { store } from './store.js';
import { securityStatsStore } from './securityStore.js';
import { protestStore } from './protestStore.js';
import type { DetectPayload } from './types.js';
import type { ProtestType } from './protestStore.js';

// ── App setup ──────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// CORS — allow any origin in development
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

const startTime = Date.now();

// ── Routes ─────────────────────────────────────────────────────────

/** POST /api/detect — ingest an article and return the matched/created event. */
app.post('/api/detect', async (req, res) => {
  try {
    const body = req.body;

    if (!body.title || !body.source) {
      res.status(400).json({ error: 'title and source are required' });
      return;
    }

    const payload: DetectPayload = {
      articleId: body.article_id || body.articleId,
      title: body.title,
      summary: body.summary ?? '',
      source: body.source,
      url: body.url ?? '',
      category: body.category,
      publishedAt: body.publishedAt ?? new Date().toISOString(),
      embedding: body.embedding,
    };

    const result = await detectEvent(payload);
    res.json(result);
  } catch (err) {
    console.error('[Server] POST /api/detect failed:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** GET /api/events — paginated event list with optional filters. */
app.get('/api/events', (req, res) => {
  try {
    let events = store.getAllEvents();

    // Filter by minimum impact score
    const minImpact = parseInt(req.query.minImpact as string, 10);
    if (!Number.isNaN(minImpact) && minImpact > 0) {
      events = events.filter((e) => e.impact >= minImpact);
    }

    // Filter by consensus level
    const consensus = req.query.consensus as string;
    if (consensus && ['high', 'medium', 'low'].includes(consensus)) {
      events = events.filter((e) => e.consensus === consensus);
    }

    // Sort by impact descending
    events.sort((a, b) => b.impact - a.impact);

    // Pagination
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit as string, 10) || 20),
    );
    const total = events.length;
    const totalPages = Math.ceil(total / limit);
    const items = events.slice((page - 1) * limit, page * limit);

    res.json({
      events: items,
      pagination: { page, limit, total, totalPages },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/events/trending — top 10 events by impact (last 24 h).
 *
 * IMPORTANT: this route MUST be declared BEFORE /api/events/:id to
 * prevent Express from matching "trending" as an event ID.
 */
app.get('/api/events/trending', (_req, res) => {
  try {
    const trending = store.getTrendingEvents(10);
    res.json({ events: trending, count: trending.length });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/events/political — filter events by political figure and sentiment.
 *
 * Query params:
 *   figure         (string, optional) — Filter by political figure name.
 *   sentiment_min  (number, optional) — Minimum sentiment threshold (-1.0 to 1.0).
 *                                       e.g. -0.5 returns events where sentiment <= -0.5
 *   limit          (number, optional) — Max results (default 20).
 *
 * Returns events filtered by the presence of the given political figure in
 * their entities list, along with per-entity breakdown when available.
 *
 * IMPORTANT: this route MUST be declared BEFORE /api/events/:id to prevent
 * Express from matching "political" as an event ID.
 */
app.get('/api/events/political', (req, res) => {
  try {
    const figure = req.query.figure as string | undefined;
    const sentimentMin = parseFloat(req.query.sentiment_min as string);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit as string, 10) || 20),
    );

    let events = store.getAllEvents();

    // Filter by political figure name (case-insensitive partial match
    // against entity names in the event)
    if (figure) {
      const figureLower = figure.toLowerCase().trim();
      events = events.filter((e) =>
        e.entities.some((ent) => ent.name.toLowerCase().includes(figureLower)),
      );
    }

    // Filter by minimum sentiment threshold
    // sentiment_min = -0.5 means "show events with sentiment <= -0.5"
    if (!Number.isNaN(sentimentMin)) {
      // We check against a synthetic sentiment by averaging the entity
      // tier as a rough proxy when no per-article sentiment is stored.
      // In a full implementation, sentiment comes from ArticlePolitician.
      events = events.filter((e) => {
        const avgTier =
          e.entities.length > 0
            ? e.entities.reduce((sum, ent) => sum + ent.tier, 0) /
              e.entities.length
            : 3;
        // Map tier (1=top positive-ish, 3=low) to a -1..1 sentiment proxy
        const proxySentiment = 1.0 - (avgTier - 1) * 1.0;
        return proxySentiment <= sentimentMin;
      });
    }

    // Sort by impact descending
    events.sort((a, b) => b.impact - a.impact);
    const items = events.slice(0, limit);

    // Enrich each event with per-entity sentiment breakdown
    const enriched = items.map((event) => ({
      id: event.id,
      title: event.title,
      summary: event.summary,
      articleCount: event.articleCount,
      sources: event.sources,
      consensus: event.consensus,
      impactScore: event.impact,
      entities: event.entities.map((entity) => ({
        name: entity.name,
        type: entity.type,
        tier: entity.tier,
        // Proxy sentiment based on tier (will be replaced by real
        // ArticlePolitician data once the database is wired in)
        sentiment: Math.round((1.0 - (entity.tier - 1) * 0.5) * 100) / 100,
      })),
      province: event.location?.province ?? null,
      publishedAt: event.firstSeen,
    }));

    res.json({ events: enriched, count: enriched.length });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/events/security — Province-level security event statistics.
 *
 * Query params:
 *   province  (string, optional) — Filter by province name.
 *   category  (string, optional) — Filter by crime category.
 *   period    (string, optional) — "7d" or "30d" (default "30d").
 */
app.get('/api/events/security', (req, res) => {
  try {
    const province = req.query.province as string | undefined;
    const category = req.query.category as string | undefined;
    const period = (req.query.period as string) || '30d';

    const allEvents = store.getAllEvents();
    const stats = securityStatsStore.getProvinceSecurity(
      allEvents, province, category, period,
    );

    res.json({ stats, count: stats.length });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/events/protests — Active/Dispersed/Resolved protests.
 *
 * Query params:
 *   status    (string, optional) — "active", "dispersed", "resolved" (default "active").
 *   province  (string, optional) — Filter by province name.
 */
app.get('/api/events/protests', (req, res) => {
  try {
    const status = (req.query.status as string) || 'active';
    const province = req.query.province as string | undefined;

    const validStatuses = ['active', 'dispersed', 'resolved'];
    const filterStatus = validStatuses.includes(status)
      ? status as 'active' | 'dispersed' | 'resolved'
      : 'active';

    const protests = protestStore.getProtests({
      status: filterStatus,
      province,
    });

    res.json({ protests, count: protests.length });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/events/protests/register — Register or update a protest from a detected event.
 *
 * Body:
 *   event_id                 (string, required) — The detected event ID.
 *   protest_type             (string, required) — One of the valid protest types.
 *   route                    (string, optional) — Route name (e.g. "Ruta 3").
 *   km                       (number, optional) — Kilometre marker.
 *   location                 (string, optional) — City or landmark.
 *   estimated_duration_minutes (number, optional) — Expected duration.
 */
app.post('/api/events/protests/register', (req, res) => {
  try {
    const { event_id, protest_type, route, km, location, estimated_duration_minutes } = req.body;

    if (!event_id || !protest_type) {
      res.status(400).json({ error: 'event_id and protest_type are required' });
      return;
    }

    const validTypes = ['corte_total', 'corte_parcial', 'marcha', 'piquete', 'paro', 'movilizacion'];
    if (!validTypes.includes(protest_type)) {
      res.status(400).json({ error: `Invalid protest_type. Must be one of: ${validTypes.join(', ')}` });
      return;
    }

    const event = store.getEvent(event_id);
    if (!event) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }

    const protest = protestStore.registerProtestFromEvent(event, {
      protest_type: protest_type as ProtestType,
      route: route || null,
      km: km != null ? km : null,
      location: location || null,
      estimated_duration_minutes: estimated_duration_minutes != null ? estimated_duration_minutes : null,
    });

    res.json({ protest });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/events/protests/:id/resolve — Manually resolve a protest.
 */
app.post('/api/events/protests/:id/resolve', (req, res) => {
  try {
    const ok = protestStore.resolveProtest(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'Protest not found' });
      return;
    }
    res.json({ status: 'resolved' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/events/search — text search on event titles.
 *
 * Query params:
 *   q      (string, required) — Search term (case-insensitive substring match on title).
 *   page   (number, optional) — Page number (default 1).
 *   limit  (number, optional) — Results per page (default 20, max 100).
 *
 * IMPORTANT: this route MUST be declared BEFORE /api/events/:id to prevent
 * Express from matching "search" as an event ID.
 */
app.get('/api/events/search', (req, res) => {
  try {
    const q = (req.query.q as string || '').trim().toLowerCase();
    if (!q) {
      res.status(400).json({ error: 'Query parameter "q" is required' });
      return;
    }

    const allEvents = store.getAllEvents();
    const matched = allEvents.filter((e) => e.title.toLowerCase().includes(q));

    // Pagination
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const total = matched.length;
    const totalPages = Math.ceil(total / limit);
    const items = matched.slice((page - 1) * limit, page * limit);

    res.json({
      query: q,
      events: items,
      pagination: { page, limit, total, totalPages },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** GET /api/events/:id — single event with articles, entities, timeline. */
app.get('/api/events/:id', (req, res) => {
  try {
    const event = store.getEvent(req.params.id);
    if (!event) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }
    res.json({ event });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** GET /health — service health check. */
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    port: config.port,
    aiProcessorUrl: config.aiProcessorUrl,
    eventCount: store.getAllEvents().length,
  });
});

// ── Fallback background loop ──────────────────────────────────────
//
// Every `fallbackPollIntervalMs` (default 5 min), query the shared
// SQLite database for articles that:
//   1. Have status = 'filtered'
//   2. Have an ai_score where publish = true (PUBLISH verdict)
//   3. Have an embedding
//
// These articles are fed into detectEvent() — catching any that were
// not pushed directly by ai-filter or geolocation.
//
// The dedup check in detectEvent (via articleId) prevents double-ingestion.

async function fallbackPollLoop(): Promise<void> {
  let db: Database.Database | null = null;
  try {
    db = new Database(config.dbPath);
    db.pragma('journal_mode = WAL');

    const rows = db.prepare(`
      SELECT id, title, summary, source, url, published_at, embedding, ai_score
      FROM news_items
      WHERE status = 'filtered'
        AND embedding IS NOT NULL
        AND embedding != ''
      ORDER BY published_at ASC
      LIMIT 50
    `).all() as Array<{
      id: string; title: string; summary: string; source: string;
      url: string; published_at: string; embedding: string; ai_score: string;
    }>;

    if (rows.length === 0) return;

    let pushed = 0;
    for (const row of rows) {
      // Parse ai_score to verify it's a PUBLISH verdict
      let isPublish = false;
      try {
        const score = JSON.parse(row.ai_score);
        isPublish = score?.publish === true;
      } catch {
        continue; // malformed ai_score — skip
      }
      if (!isPublish) continue;

      // Parse embedding
      let embedding: number[] | undefined;
      try {
        embedding = JSON.parse(row.embedding) as number[];
        if (!Array.isArray(embedding) || embedding.length === 0) {
          embedding = undefined;
        }
      } catch {
        continue; // malformed embedding — skip
      }

      const payload: DetectPayload = {
        articleId: row.id,
        title: row.title,
        summary: row.summary ?? '',
        source: row.source,
        url: row.url ?? '',
        publishedAt: row.published_at ?? new Date().toISOString(),
        embedding,
      };

      try {
        await detectEvent(payload);
        pushed++;
      } catch (err) {
        console.warn(`[Fallback] detectEvent failed for ${row.id.slice(0, 8)}…:`, (err as Error).message);
      }
    }

    if (pushed > 0) {
      console.log(`[Fallback] Pushed ${pushed}/${rows.length} filtered articles into event detection`);
    }
  } catch (err) {
    console.error('[Fallback] DB polling error:', err);
  } finally {
    if (db) {
      db.close();
    }
  }
}

// ── Start ──────────────────────────────────────────────────────────

app.listen(config.port, () => {
  console.log(`[Event Detector] Listening on http://localhost:${config.port}`);
  console.log(`[Event Detector] AI Processor URL: ${config.aiProcessorUrl}`);
  console.log(`[Event Detector] DB Path (fallback): ${config.dbPath}`);
  console.log(`[Event Detector] Fallback poll interval: ${config.fallbackPollIntervalMs}ms`);
  console.log(`[Event Detector]   POST /api/detect                    — Receive article, find/create event`);
  console.log(`[Event Detector]   GET  /api/events                    — Paginated event list with filters`);
  console.log(`[Event Detector]   GET  /api/events/political          — Filter events by political figure`);
  console.log(`[Event Detector]   GET  /api/events/search             — Text search on event titles`);
  console.log(`[Event Detector]   GET  /api/events/trending           — Top 10 events by impact`);
  console.log(`[Event Detector]   GET  /api/events/security           — Province-level security stats`);
  console.log(`[Event Detector]   GET  /api/events/protests           — Active protests list`);
  console.log(`[Event Detector]   POST /api/events/protests/register  — Register/update a protest`);
  console.log(`[Event Detector]   POST /api/events/protests/:id/resolve — Resolve a protest`);
  console.log(`[Event Detector]   GET  /api/events/:id                — Single event with full detail`);
  console.log(`[Event Detector]   GET  /health                        — Service health`);

  // Start fallback poll loop
  fallbackPollLoop();
  setInterval(fallbackPollLoop, config.fallbackPollIntervalMs);
});
