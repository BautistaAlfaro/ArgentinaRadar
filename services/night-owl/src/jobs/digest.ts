/**
 * Night Owl — Daily Digest Generator
 *
 * Scheduled: 02:00 ART
 *
 * Generates the daily executive summary for the Morning Briefing panel:
 *   1. Fetch today's top events  (event-detector  GET /api/events/trending)
 *   2. Fetch today's trends      (trend-analyzer   GET /api/trends)
 *   3. Fetch economic data       (economic-data    GET /api/economic)
 *   4. Fetch daily stats         (SQLite)
 *   5. Call GPT-4o-mini via OpenRouter for executive summary (≤500 chars)
 *   6. Store digest in PostgreSQL daily_digests table
 *   7. Return structured digest with HTML / Markdown
 *
 * Budget: uses the shared BudgetTracker to stay within the nightly $1.00 cap.
 */

import path from 'path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import pg from 'pg';
import type { JobFn } from './index.js';
import { BudgetTracker } from './budget.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Service URLs ────────────────────────────────────────────────────

const EVENT_SERVICE_URL   = process.env.EVENT_DETECTOR_URL   ?? 'http://localhost:3008';
const TREND_SERVICE_URL   = process.env.TREND_ANALYZER_URL   ?? 'http://localhost:3009';
const ECONOMIC_SERVICE_URL = process.env.ECONOMIC_DATA_URL   ?? 'http://localhost:3006';
const DB_PATH =
  process.env.DB_PATH ??
  path.resolve(__dirname, '..', '..', '..', '..', 'data', 'argentina-radar.db');

// ── OpenRouter (for GPT-4o-mini summary generation) ─────────────────
const OPENROUTER_API_KEY   = process.env.OPENROUTER_API_KEY ?? '';
const OPENROUTER_BASE_URL  = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
const SUMMARY_MODEL        = process.env.SUMMARY_MODEL ?? 'gpt-4o-mini';

// ── PostgreSQL (for digest persistence) ──────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL ?? '';

const { Pool } = pg;

// ── Response shapes ─────────────────────────────────────────────────

interface TrendingEvent {
  id: string;
  title: string;
  summary: string;
  impact: number;
  consensus: string;
  articleCount: number;
  category: string;
  [key: string]: unknown;
}

interface TrendItem {
  name: string;
  type: string;
  mentions: number;
  growthRate: number;
  score: number;
  [key: string]: unknown;
}

interface EconomicIndicator {
  type: string;
  value: number;
  previousValue: number | null;
  source: string;
  timestamp: string;
  [key: string]: unknown;
}

interface DailyStats {
  articlesIngested: number;
  eventsDetected: number;
  tweetsPublished: number;
  articlesGeolocated: number;
}

interface DigestRecord {
  id: string;
  date: string;
  summary: string;
  topEvents: TrendingEvent[];
  topTrends: TrendItem[];
  economicData: EconomicIndicator[];
  stats: DailyStats;
  htmlContent: string;
  markdownContent: string;
  createdAt: string;
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Safely parse JSON, returning `null` on failure. */
function safeJson<T>(raw: string | null | undefined, fallback: T | null = null): T | null {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Truncate a string to `maxChars`, appending "…" if truncated. */
function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 1) + '…';
}

// ── Fetch helpers ───────────────────────────────────────────────────

async function fetchJson<T>(url: string, label: string): Promise<T | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn(`[Digest] ${label} returned ${resp.status}`);
      return null;
    }
    return (await resp.json()) as T;
  } catch (err) {
    console.error(`[Digest] Failed to fetch ${label}:`, (err as Error).message);
    return null;
  }
}

// ── PostgreSQL schema bootstrap ──────────────────────────────────────

const CREATE_DIGESTS_TABLE = `
  CREATE TABLE IF NOT EXISTS daily_digests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date            DATE NOT NULL UNIQUE,
    summary         TEXT NOT NULL,
    top_events      JSONB NOT NULL DEFAULT '[]',
    top_trends      JSONB NOT NULL DEFAULT '[]',
    economic_data   JSONB NOT NULL DEFAULT '[]',
    stats           JSONB NOT NULL DEFAULT '{}',
    html_content    TEXT NOT NULL DEFAULT '',
    markdown_content TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

// ── HTML / Markdown formatting ──────────────────────────────────────

function formatHtml(digest: {
  summary: string;
  topEvents: TrendingEvent[];
  topTrends: TrendItem[];
  economicData: EconomicIndicator[];
  stats: DailyStats;
}): string {
  const { summary, topEvents, topTrends, economicData, stats } = digest;
  const lines: string[] = [];

  lines.push('<div class="morning-briefing">');
  lines.push('<h1>☀️ Morning Briefing</h1>');
  lines.push(`<p class="summary">${truncate(summary, 500)}</p>`);

  // Stats
  lines.push('<section class="stats">');
  lines.push('<h2>📊 Daily Stats</h2>');
  lines.push('<ul>');
  lines.push(`<li>Articles ingested: <strong>${stats.articlesIngested}</strong></li>`);
  lines.push(`<li>Events detected: <strong>${stats.eventsDetected}</strong></li>`);
  lines.push(`<li>Tweets published: <strong>${stats.tweetsPublished}</strong></li>`);
  lines.push('</ul>');
  lines.push('</section>');

  // Top events
  if (topEvents.length > 0) {
    lines.push('<section class="events">');
    lines.push('<h2>🔥 Top Events</h2>');
    lines.push('<ol>');
    for (const ev of topEvents.slice(0, 5)) {
      const impactStars = '★'.repeat(Math.min(5, Math.ceil(ev.impact / 20)));
      lines.push(`<li><strong>${escapeHtml(ev.title)}</strong> ${impactStars}<br><small>${escapeHtml(truncate(ev.summary ?? '', 120))}</small></li>`);
    }
    lines.push('</ol>');
    lines.push('</section>');
  }

  // Top trends
  if (topTrends.length > 0) {
    lines.push('<section class="trends">');
    lines.push('<h2>📈 Trending Topics</h2>');
    lines.push('<ol>');
    for (const t of topTrends.slice(0, 5)) {
      const change = t.growthRate >= 0 ? `+${(t.growthRate * 100).toFixed(0)}%` : `${(t.growthRate * 100).toFixed(0)}%`;
      lines.push(`<li><strong>${escapeHtml(t.name)}</strong> (${t.type}) — ${change}</li>`);
    }
    lines.push('</ol>');
    lines.push('</section>');
  }

  // Economic data
  if (economicData.length > 0) {
    lines.push('<section class="economic">');
    lines.push('<h2>💵 Economic Indicators</h2>');
    lines.push('<ul>');
    for (const ind of economicData) {
      const name = ind.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      lines.push(`<li><strong>${escapeHtml(name)}:</strong> ${ind.value ?? '—'}</li>`);
    }
    lines.push('</ul>');
    lines.push('</section>');
  }

  lines.push('</div>');
  return lines.join('\n');
}

function formatMarkdown(digest: {
  summary: string;
  topEvents: TrendingEvent[];
  topTrends: TrendItem[];
  economicData: EconomicIndicator[];
  stats: DailyStats;
}): string {
  const { summary, topEvents, topTrends, economicData, stats } = digest;
  const lines: string[] = [];

  lines.push('# ☀️ Morning Briefing');
  lines.push('');
  lines.push(summary);
  lines.push('');

  // Stats
  lines.push('## 📊 Daily Stats');
  lines.push('');
  lines.push(`- Articles ingested: **${stats.articlesIngested}**`);
  lines.push(`- Events detected: **${stats.eventsDetected}**`);
  lines.push(`- Tweets published: **${stats.tweetsPublished}**`);
  lines.push('');

  // Top events
  if (topEvents.length > 0) {
    lines.push('## 🔥 Top Events');
    lines.push('');
    for (const ev of topEvents.slice(0, 5)) {
      const impactStars = '★'.repeat(Math.min(5, Math.ceil(ev.impact / 20)));
      lines.push(`- **${ev.title}** ${impactStars}`);
      if (ev.summary) lines.push(`  - ${truncate(ev.summary, 120)}`);
    }
    lines.push('');
  }

  // Top trends
  if (topTrends.length > 0) {
    lines.push('## 📈 Trending Topics');
    lines.push('');
    for (const t of topTrends.slice(0, 5)) {
      const change = t.growthRate >= 0 ? `+${(t.growthRate * 100).toFixed(0)}%` : `${(t.growthRate * 100).toFixed(0)}%`;
      lines.push(`- **${t.name}** (${t.type}) — ${change}`);
    }
    lines.push('');
  }

  // Economic data
  if (economicData.length > 0) {
    lines.push('## 💵 Economic Indicators');
    lines.push('');
    for (const ind of economicData) {
      const name = ind.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      lines.push(`- **${name}:** ${ind.value ?? '—'}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Job implementation ──────────────────────────────────────────────

export const runDigest: JobFn = async (_data) => {
  const budget = new BudgetTracker();
  const startedAt = Date.now();

  console.log('═══════════════════════════════════════');
  console.log('[Job:digest] Starting daily digest generator');
  console.log('═══════════════════════════════════════');

  // ── 1. Fetch trending events ──────────────────────────────────────
  const eventsData = await fetchJson<{ events: TrendingEvent[]; count: number }>(
    `${EVENT_SERVICE_URL}/api/events/trending`,
    'trending events',
  );
  const topEvents: TrendingEvent[] = eventsData?.events ?? [];
  console.log(`[Digest] Fetched ${topEvents.length} trending events`);

  // ── 2. Fetch trending topics ──────────────────────────────────────
  const trendsData = await fetchJson<{ trends: TrendItem[]; lastUpdated: string | null }>(
    `${TREND_SERVICE_URL}/api/trends`,
    'trending topics',
  );
  const topTrends: TrendItem[] = trendsData?.trends ?? [];
  console.log(`[Digest] Fetched ${topTrends.length} trending topics`);

  // ── 3. Fetch economic data ────────────────────────────────────────
  const ecoData = await fetchJson<{ indicators: EconomicIndicator[] }>(
    `${ECONOMIC_SERVICE_URL}/api/economic`,
    'economic data',
  );
  const economicData: EconomicIndicator[] = ecoData?.indicators ?? [];
  console.log(`[Digest] Fetched ${economicData.length} economic indicators`);

  // ── 4. Fetch today's stats from SQLite ────────────────────────────
  let stats: DailyStats = { articlesIngested: 0, eventsDetected: 0, tweetsPublished: 0, articlesGeolocated: 0 };

  try {
    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    const ingestedCount = db.prepare(
      "SELECT COUNT(*) AS count FROM news_items WHERE ingested_at >= ?",
    ).get(today) as { count: number } | undefined;

    const geolocatedCount = db.prepare(
      "SELECT COUNT(*) AS count FROM news_items WHERE status IN ('geolocated','published') AND ingested_at >= ?",
    ).get(today) as { count: number } | undefined;

    const tweetsCount = db.prepare(
      "SELECT COUNT(*) AS count FROM tweet_history WHERE posted_at >= ? AND status = 'posted'",
    ).get(today) as { count: number } | undefined;

    stats = {
      articlesIngested: ingestedCount?.count ?? 0,
      eventsDetected: topEvents.length,
      tweetsPublished: tweetsCount?.count ?? 0,
      articlesGeolocated: geolocatedCount?.count ?? 0,
    };

    db.close();
  } catch (err) {
    console.warn('[Digest] SQLite stats query failed (non-fatal):', (err as Error).message);
  }

  console.log(`[Digest] Stats: ${JSON.stringify(stats)}`);

  // ── 5. Generate executive summary via GPT-4o-mini ─────────────────
  const dateStr = new Date().toLocaleDateString('es-AR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Argentina/Buenos_Aires',
  });

  let summary = 'No summary generated.';
  if (OPENROUTER_API_KEY) {
    const systemPrompt = `Eres un analista de noticias argentino. Genera un resumen ejecutivo CONCISO (máximo 500 caracteres) de la jornada informativa en Argentina. Enfócate en los eventos más relevantes, tendencias y datos económicos clave. Sé directo y profesional.`;

    const userPrompt = [
      `Fecha: ${dateStr}\n`,
      `--- EVENTOS DESTACADOS ---`,
      ...topEvents.slice(0, 5).map((e, i) => `${i + 1}. [Impacto: ${e.impact}] ${e.title} (${e.category})`),
      ``,
      `--- TENDENCIAS ---`,
      ...topTrends.slice(0, 5).map((t, i) => `${i + 1}. ${t.name} (${t.type}) — ${(t.growthRate * 100).toFixed(0)}% crecimiento`),
      ``,
      `--- INDICADORES ECONÓMICOS ---`,
      ...economicData.map((ind) => `- ${ind.type}: ${ind.value}`),
      ``,
      `--- ESTADÍSTICAS ---`,
      `- Artículos ingeridos: ${stats.articlesIngested}`,
      `- Eventos detectados: ${stats.eventsDetected}`,
      `- Tweets publicados: ${stats.tweetsPublished}`,
    ].join('\n');

    if (budget.check()) {
      try {
        const resp = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: SUMMARY_MODEL,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            max_tokens: 600,
            temperature: 0.3,
          }),
        });

        if (resp.ok) {
          const data = (await resp.json()) as {
            choices: Array<{ message: { content: string } }>;
            usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
          };
          summary = data.choices?.[0]?.message?.content?.trim() ?? summary;
          budget.record(0.0002, data.usage?.total_tokens ?? 0); // ~$0.15/1M tokens for gpt-4o-mini
          console.log(`[Digest] Summary generated (${summary.length} chars)`);
        } else {
          const errBody = await resp.text();
          console.error(`[Digest] OpenRouter returned ${resp.status}: ${errBody}`);
        }
      } catch (err) {
        console.error('[Digest] Failed to generate summary:', (err as Error).message);
      }
    } else {
      console.warn('[Digest] Budget exhausted — using fallback summary');
    }
  } else {
    console.warn('[Digest] OPENROUTER_API_KEY not set — using fallback summary');
  }

  // Truncate summary to 500 chars as required
  summary = truncate(summary, 500);

  // ── 6. Format HTML and Markdown ────────────────────────────────────
  const digestData = { summary, topEvents, topTrends, economicData, stats };
  const htmlContent = formatHtml(digestData);
  const markdownContent = formatMarkdown(digestData);

  // ── 7. Store in PostgreSQL daily_digests table ────────────────────
  const todayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  let storedDigest: DigestRecord | null = null;

  if (DATABASE_URL) {
    const pool = new Pool({ connectionString: DATABASE_URL });
    try {
      // Ensure the table exists
      await pool.query(CREATE_DIGESTS_TABLE);

      const upsertSql = `
        INSERT INTO daily_digests (date, summary, top_events, top_trends, economic_data, stats, html_content, markdown_content)
        VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8)
        ON CONFLICT (date)
        DO UPDATE SET
          summary          = EXCLUDED.summary,
          top_events       = EXCLUDED.top_events,
          top_trends       = EXCLUDED.top_trends,
          economic_data    = EXCLUDED.economic_data,
          stats            = EXCLUDED.stats,
          html_content     = EXCLUDED.html_content,
          markdown_content = EXCLUDED.markdown_content,
          created_at       = NOW()
        RETURNING id, date, summary, html_content, markdown_content, created_at
      `;

      const result = await pool.query(upsertSql, [
        todayKey,
        summary,
        JSON.stringify(topEvents),
        JSON.stringify(topTrends),
        JSON.stringify(economicData),
        JSON.stringify(stats),
        htmlContent,
        markdownContent,
      ]);

      if (result.rows.length > 0) {
        storedDigest = {
          id: result.rows[0].id,
          date: result.rows[0].date,
          summary: result.rows[0].summary,
          topEvents: safeJson<TrendingEvent[]>(result.rows[0].top_events) ?? [],
          topTrends: safeJson<TrendItem[]>(result.rows[0].top_trends) ?? [],
          economicData: safeJson<EconomicIndicator[]>(result.rows[0].economic_data) ?? [],
          stats: safeJson<DailyStats>(result.rows[0].stats) ?? stats,
          htmlContent: result.rows[0].html_content,
          markdownContent: result.rows[0].markdown_content,
          createdAt: result.rows[0].created_at,
        };
      }

      console.log(`[Digest] Stored in PostgreSQL daily_digests (date=${todayKey})`);
    } catch (err) {
      console.error('[Digest] Failed to store digest in PostgreSQL:', (err as Error).message);
    } finally {
      await pool.end();
    }
  } else {
    console.warn('[Digest] DATABASE_URL not set — digest NOT persisted to PostgreSQL');
  }

  // ── 8. Complete ───────────────────────────────────────────────────
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('═══════════════════════════════════════');
  console.log(`[Job:digest] Complete in ${elapsed}s`);
  console.log(`  Summary length: ${summary.length} chars`);
  console.log(`  Top events:     ${topEvents.length}`);
  console.log(`  Top trends:     ${topTrends.length}`);
  console.log(`  Indicators:     ${economicData.length}`);
  console.log(`  Stored in PG:   ${storedDigest ? 'yes' : 'no'}`);
  console.log(`  Budget:         $${budget.getSummary().spent.toFixed(6)} (${budget.getSummary().tokens} tokens)`);
  console.log('═══════════════════════════════════════');
};
