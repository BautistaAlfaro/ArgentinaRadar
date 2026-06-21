/**
 * Trend Analyzer REST Service
 *
 * Express server on port 3009 that:
 *   - POST /api/analyze          — receive entity mentions from articles, update tracker
 *   - GET  /api/trends           — top 10 trending entities with scores
 *   - GET  /api/entities/trending — alias for /api/trends
 *   - GET  /api/entities/:name   — entity detail (mentions, growth, related articles)
 *   - GET  /health               — service health
 *
 * Background job: recalculate trends every ANALYSIS_INTERVAL (default 30 min).
 */

import express from 'express';
import { PORT, ANALYSIS_INTERVAL } from './config.js';
import { EntityTracker } from './tracker.js';
import type { EntityMention } from './tracker.js';
import { calculateTrends } from './trending.js';
import { TrendStore } from './store.js';

// ─── State ───────────────────────────────────────────────────────────
const tracker = new EntityTracker();
const trendStore = new TrendStore();

// ─── Express app ─────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// ─── CORS ────────────────────────────────────────────────────────────
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  next();
});

// ─── POST /api/analyze — Receive entity mentions from articles ──
app.post('/api/analyze', (req, res) => {
  try {
    const { entities } = req.body as {
      entities?: Array<{ name: string; type: string; articleId: string; source: string }>;
    };

    if (!Array.isArray(entities) || entities.length === 0) {
      res.status(400).json({ error: 'Missing or invalid "entities" array' });
      return;
    }

    const validTypes = new Set(['person', 'place', 'organization']);
    let added = 0;

    for (const e of entities) {
      if (!e.name || !e.type || !e.articleId) {
        continue; // skip invalid entries
      }
      const mention: EntityMention = {
        name: e.name,
        type: validTypes.has(e.type) ? (e.type as 'person' | 'place' | 'organization') : 'organization',
        timestamp: new Date(),
        articleId: e.articleId,
        source: e.source ?? 'unknown',
      };
      tracker.addMention(mention);
      added++;
    }

    // Trigger a quick recalculation after ingesting
    const trends = calculateTrends(tracker);
    trendStore.setCurrent(trends);

    res.json({ received: entities.length, added });
  } catch (err) {
    res.status(500).json({ error: 'Failed to analyze entities', details: String(err) });
  }
});

// ─── GET /api/trends — Top 10 trending entities ───────────────────
app.get('/api/trends', (_req, res) => {
  try {
    const trends = trendStore.getCurrent();
    const lastUpdated = trendStore.getLastUpdated();
    res.json({ trends, lastUpdated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch trends', details: String(err) });
  }
});

// ─── GET /api/trends/political — Political figure trends ────────
app.get('/api/trends/political', (_req, res) => {
  try {
    const allMentions = tracker.getAllMentions();
    const typeByEntity = new Map<string, string>();
    for (let i = allMentions.length - 1; i >= 0; i--) {
      const m = allMentions[i];
      if (!typeByEntity.has(m.name)) typeByEntity.set(m.name, m.type);
    }

    // Get all trends and filter to person types
    const trends = trendStore.getCurrent();

    // Build per-figure detail from the tracker
    const figures = trends
      .filter((t) => (typeByEntity.get(t.name) ?? t.type) === 'person')
      .map((t) => {
        const detail = tracker.getEntityDetail(t.name);
        const curCount = t.mentions;
        const prevCount = t.previousMentions;
        const growthRate =
          prevCount > 0 ? ((curCount - prevCount) / prevCount) * 100 : 100;

        // Compute 7-day daily mention counts from history snapshots
        const history = trendStore.getHistory();
        const days: number[] = [];
        // Walk backwards through snapshots to find daily counts
        const seen = new Set<string>();
        for (let i = history.length - 1; i >= 0; i--) {
          const snapshot = history[i];
          const entry = snapshot.trends.find(
            (x) => x.name.toLowerCase() === t.name.toLowerCase(),
          );
          if (entry) {
            const dayKey = new Date(snapshot.timestamp).toISOString().slice(0, 10);
            if (!seen.has(dayKey)) {
              days.unshift(entry.mentions);
              seen.add(dayKey);
            }
          }
        }
        // Pad to 7 days if we have fewer
        while (days.length < 7) days.unshift(0);
        // Trim to last 7
        const trendChart = days.slice(-7);

        return {
          name: t.name,
          party: _guessParty(t.name),
          mentions24h: curCount,
          growthRate: Math.round(growthRate * 10) / 10,
          avgSentiment: 0, // placeholder — will come from ArticlePolitician
          trendChart,
        };
      });

    res.json({ figures, count: figures.length });
  } catch (err) {
    res.status(500).json({
      error: 'Failed to fetch political trends',
      details: String(err),
    });
  }
});

/**
 * Rough party guesser based on known political figures.
 * In a full implementation this would come from the PoliticalFigure DB table.
 */
function _guessParty(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('milei') || lower.includes('villarruel')) return 'LLA';
  if (lower.includes('macri') || lower.includes('bullrich') || lower.includes('larreta')) return 'PRO';
  if (lower.includes('kirchner') || lower.includes('massa') || lower.includes('kicillof') || lower.includes('fernández')) return 'FdT';
  if (lower.includes('bregman') || lower.includes('del caño')) return 'PTS';
  if (lower.includes('ritondo') || lower.includes('santilli')) return 'PRO';
  return 'IND';
}

// ─── GET /api/entities/trending — Alias for /api/trends ─────────
app.get('/api/entities/trending', (_req, res) => {
  res.redirect('/api/trends');
});

// ─── GET /api/entities/:name — Entity detail ─────────────────────
app.get('/api/entities/:name', (req, res) => {
  try {
    const { name } = req.params;
    const detail = tracker.getEntityDetail(name);

    if (detail.totalMentions === 0) {
      res.status(404).json({ error: `Entity "${name}" not found` });
      return;
    }

    const allMentions = tracker.getAllMentions();
    const typeByEntity = new Map<string, string>();
    for (let i = allMentions.length - 1; i >= 0; i--) {
      const m = allMentions[i];
      if (!typeByEntity.has(m.name)) typeByEntity.set(m.name, m.type);
    }

    // Compute growth rate from current vs previous windows
    const current = tracker.countByEntity(tracker.getMentionsInLast24h());
    const previous = tracker.countByEntity(tracker.getMentionsInPrevious24h());
    const curCount = current.get(name) ?? 0;
    const prevCount = previous.get(name) ?? 0;
    const growthRate = prevCount > 0 ? (curCount - prevCount) / prevCount : 1.0;

    // Collect related article IDs
    const relatedArticles = [...new Set(detail.mentions.map((m) => m.articleId))];
    const sources = [...new Set(detail.mentions.map((m) => m.source))];

    res.json({
      name,
      type: typeByEntity.get(name) ?? 'unknown',
      totalMentions: detail.totalMentions,
      mentionsLast24h: curCount,
      mentionsPrevious24h: prevCount,
      growthRate,
      relatedArticles,
      sources,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch entity details', details: String(err) });
  }
});

// ─── GET /health — Service health check ──────────────────────────
app.get('/health', (_req, res) => {
  const lastUpdated = trendStore.getLastUpdated();
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    port: PORT,
    totalMentions: tracker.getAllMentions().length,
    trendsLastUpdated: lastUpdated,
  });
});

// ─── Background recalculation job ────────────────────────────────
function recalculateTrends(): void {
  try {
    const start = Date.now();
    const trends = calculateTrends(tracker);
    trendStore.setCurrent(trends);
    console.log(`[trend-analyzer] Trends recalculated in ${Date.now() - start}ms, top: ${trends.map((t) => t.name).join(', ')}`);
  } catch (err) {
    console.error('[trend-analyzer] Trend recalculation failed:', err);
  }
}

// ─── Server start ─────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`[trend-analyzer] REST API listening on http://localhost:${PORT}`);
  console.log(`[trend-analyzer]   POST /api/analyze          — Receive entity mentions`);
  console.log(`[trend-analyzer]   GET  /api/trends            — Top 10 trending entities`);
  console.log(`[trend-analyzer]   GET  /api/trends/political  — Political figure trends`);
  console.log(`[trend-analyzer]   GET  /api/entities/trending — Alias for /api/trends`);
  console.log(`[trend-analyzer]   GET  /api/entities/:name    — Entity detail`);
  console.log(`[trend-analyzer]   GET  /health                — Service health`);
  console.log(`[trend-analyzer] Recalculating trends every ${ANALYSIS_INTERVAL}ms`);

  // Initial calculation
  recalculateTrends();
  setInterval(recalculateTrends, ANALYSIS_INTERVAL);
});

// ─── Graceful shutdown ───────────────────────────────────────────
const shutdown = () => {
  console.log('[trend-analyzer] Shutting down...');
  server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
