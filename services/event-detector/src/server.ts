/**
 * Event Detector Service — Express Server.
 *
 * Provides the REST API for event detection and retrieval:
 *   POST /api/detect        — Receive article, find or create event
 *   GET  /api/events        — Paginated event list with filters
 *   GET  /api/events/trending — Top 10 events by impact
 *   GET  /api/events/:id    — Single event with full detail
 *   GET  /health            — Service health
 *
 * Port: 3008 (configurable via PORT env var).
 */

import express from 'express';
import { config } from './config.js';
import { detectEvent } from './detector.js';
import { store } from './store.js';
import type { DetectPayload } from './types.js';

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

// ── Start ──────────────────────────────────────────────────────────

app.listen(config.port, () => {
  console.log(`[Event Detector] Listening on http://localhost:${config.port}`);
  console.log(`[Event Detector] AI Processor URL: ${config.aiProcessorUrl}`);
});
