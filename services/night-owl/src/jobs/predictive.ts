/**
 * Night Owl — Predictive Analysis Job
 *
 * Scheduled: 04:00 ART
 *
 * Predicts what will trend tomorrow by combining:
 *   1. Trending entities from trend-analyzer GET /api/trends
 *   2. Event patterns from the Pattern table (weekly/temporal/contextual)
 *   3. Likelihood scoring per entity (weekly match, contextual surge,
 *      velocity, entity importance tier)
 *   4. GPT-4o-mini call for final narrative prediction with top 5 entities
 *   5. Stores predictions in PostgreSQL predictions table
 */

import type { JobFn } from './index.js';
import { prisma } from '@argentinaradar/database';
import { BudgetTracker } from './budget.js';
import { config } from '../config.js';

// ── Constants ──────────────────────────────────────────────────────────

const TREND_SERVICE_URL = process.env.TREND_ANALYZER_URL ?? 'http://localhost:3009';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? '';
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
const PREDICTION_MODEL = process.env.PREDICTION_MODEL ?? 'gpt-4o-mini';

// ── Types ──────────────────────────────────────────────────────────────

interface TrendItem {
  name: string;
  type: string;
  mentions: number;
  growthRate: number;
  score: number;
  [key: string]: unknown;
}

interface TrendApiResponse {
  trends: TrendItem[];
  lastUpdated: string | null;
}

interface EntityScore {
  entityName: string;
  entityType: string;
  totalLikelihood: number;
  components: {
    weeklyMatch: number;
    contextualSurge: number;
    velocity: number;
    importanceTier: number;
  };
}

interface PatternRecord {
  id: string;
  type: string;
  entityName: string;
  confidence: number;
  description: string;
  metadata: Record<string, unknown>;
}

interface PredictionCandidate {
  entityName: string;
  likelihood: number;
  reason: string;
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Safe JSON parse with fallback. */
function safeJson<T>(raw: string | null | undefined, fallback: T | null = null): T | null {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; }
  catch { return fallback; }
}

/** Fetch with minimal error handling. */
async function fetchJson<T>(url: string, label: string): Promise<T | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn(`[Predictive] ${label} returned ${resp.status}`);
      return null;
    }
    return (await resp.json()) as T;
  } catch (err) {
    console.error(`[Predictive] Failed to fetch ${label}:`, (err as Error).message);
    return null;
  }
}

// ── Likelihood Engine ──────────────────────────────────────────────────

/**
 * Calculate per-entity likelihood for tomorrow based on four signals:
 *
 *   1. Weekly match   (+30%) — entity has a weekly pattern matching tomorrow's day
 *   2. Contextual surge (+20%) — entity co-occurs with a rising trend
 *   3. Velocity        (+25%) — mentions increasing in the last 24h
 *   4. Importance tier (+25%) — entity tier (1=highest)
 *
 * Each signal contributes its weight if present.  Max score = 100.
 */
function calculateLikelihood(
  trends: TrendItem[],
  patterns: PatternRecord[],
): EntityScore[] {
  const tomorrowDow = new Date(Date.now() + 86_400_000).getUTCDay(); // day of week for tomorrow
  const scores: EntityScore[] = [];

  // Build a set of trending entity names for contextual lookups
  const trendingNames = new Set(trends.map((t) => t.name.toLowerCase()));

  // Group patterns by entity
  const patternsByEntity = new Map<string, PatternRecord[]>();
  for (const p of patterns) {
    const key = p.entityName.toLowerCase();
    if (!patternsByEntity.has(key)) patternsByEntity.set(key, []);
    patternsByEntity.get(key)!.push(p);
  }

  // Also index trends by name for velocity data
  const trendByName = new Map<string, TrendItem>();
  for (const t of trends) {
    trendByName.set(t.name.toLowerCase(), t);
  }

  // Collect all candidate entities from trends + patterns
  const allEntities = new Set<string>();
  for (const t of trends) allEntities.add(t.name.toLowerCase());
  for (const p of patterns) allEntities.add(p.entityName.toLowerCase());

  for (const name of allEntities) {
    const entityPatterns = patternsByEntity.get(name) ?? [];
    const trend = trendByName.get(name);

    // 1 — Weekly match (+30%)
    let weeklyMatch = 0;
    const weeklyPatterns = entityPatterns.filter((p) => p.type === 'weekly');
    for (const wp of weeklyPatterns) {
      const meta = (wp.metadata ?? {}) as Record<string, unknown>;
      const domDow = meta.dominantDayOfWeek as number | undefined;
      if (domDow !== undefined && domDow === tomorrowDow) {
        weeklyMatch = 30 * wp.confidence; // scale by pattern confidence
        break;
      }
    }

    // 2 — Contextual surge (+20%)
    let contextualSurge = 0;
    const contextualPatterns = entityPatterns.filter((p) => p.type === 'contextual');
    for (const cp of contextualPatterns) {
      const meta = (cp.metadata ?? {}) as Record<string, unknown>;
      const coEntity = (meta.coEntityName as string ?? '').toLowerCase();
      if (coEntity && trendingNames.has(coEntity)) {
        contextualSurge = 20 * cp.confidence;
        break;
      }
    }

    // 3 — Velocity (+25%)
    let velocity = 0;
    if (trend && trend.growthRate > 0) {
      // Scale: growthRate 0→0.5 = 0→25, growthRate > 0.5 = 25
      velocity = Math.min(25, Math.round(trend.growthRate * 50));
    }

    // 4 — Importance tier (+25%)
    let importanceTier = 0;
    const temporalPatterns = entityPatterns.filter((p) => p.type === 'temporal');
    if (weeklyPatterns.length > 0 || contextualPatterns.length > 0 || temporalPatterns.length > 0) {
      importanceTier = 25; // entity has enough history
    } else if (trend) {
      importanceTier = 15; // trending but no history
    }

    const totalLikelihood = weeklyMatch + contextualSurge + velocity + importanceTier;

    scores.push({
      entityName: name,
      entityType: trend?.type ?? 'unknown',
      totalLikelihood: Math.min(100, Math.round(totalLikelihood * 100) / 100),
      components: { weeklyMatch, contextualSurge, velocity, importanceTier },
    });
  }

  return scores.sort((a, b) => b.totalLikelihood - a.totalLikelihood);
}

// ── Main job ───────────────────────────────────────────────────────────

export const runPredictive: JobFn = async (_data) => {
  const budget = new BudgetTracker();
  const startedAt = Date.now();

  console.log('═══════════════════════════════════════');
  console.log('[Job:predictive] Starting predictive analysis');
  console.log('═══════════════════════════════════════');

  // ── 1. Fetch trending entities ──────────────────────────────────────
  const trendsData = await fetchJson<TrendApiResponse>(
    `${TREND_SERVICE_URL}/api/trends`,
    'trending entities',
  );
  const trends: TrendItem[] = trendsData?.trends ?? [];
  console.log(`[Predictive] Fetched ${trends.length} trending entities`);

  if (trends.length === 0) {
    console.log('[Predictive] No trending entities found — skipping');
    return;
  }

  // ── 2. Get event patterns from Pattern table ────────────────────────
  let patterns: PatternRecord[] = [];
  try {
    const patternRows = await prisma.pattern.findMany({
      orderBy: { detectedAt: 'desc' },
      take: 200,
    });
    patterns = patternRows.map((p) => ({
      id: p.id,
      type: p.type,
      entityName: p.entityName,
      confidence: p.confidence,
      description: p.description,
      metadata: (p.metadata ?? {}) as Record<string, unknown>,
    }));
    console.log(`[Predictive] Loaded ${patterns.length} patterns from DB`);
  } catch (err) {
    console.warn('[Predictive] Failed to load patterns (non-fatal):', (err as Error).message);
  }

  // ── 3. Calculate likelihood scores per entity ───────────────────────
  const entityScores = calculateLikelihood(trends, patterns);
  const topCandidates = entityScores.slice(0, 10);
  console.log('[Predictive] Top candidates:');
  for (const c of topCandidates) {
    console.log(`  ${c.entityName} — ${c.totalLikelihood.toFixed(1)}% ` +
      `[weekly=${c.components.weeklyMatch.toFixed(1)}, surge=${c.components.contextualSurge.toFixed(1)}, ` +
      `vel=${c.components.velocity}, tier=${c.components.importanceTier}]`);
  }

  if (topCandidates.length === 0) {
    console.log('[Predictive] No viable candidates found');
    return;
  }

  // ── 4. Call GPT-4o-mini for final prediction narrative ──────────────
  const top5 = topCandidates.slice(0, 5);
  let predictionNarrative = '';
  let predictedEntities: PredictionCandidate[] = [];

  if (OPENROUTER_API_KEY && budget.check()) {
    const systemPrompt = `Eres un analista de tendencias argentino. Basado en datos de entidades y patrones, genera una predicción CONCISA (máximo 300 caracteres) sobre qué temas dominarán mañana en Argentina. Formato: "Mañana se espera: [entidad 1], [entidad 2], [entidad 3] con confianza [promedio]. [razonamiento breve]".`;

    const candidateLines = top5.map((c, i) =>
      `${i + 1}. ${c.entityName} (${c.entityType}) — likelihood: ${c.totalLikelihood.toFixed(1)}%`
    ).join('\n');

    const userPrompt = [
      `Candidatos para mañana (${new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}):`,
      candidateLines,
    ].join('\n');

    const dateStr = new Date().toLocaleDateString('es-AR', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      timeZone: 'America/Argentina/Buenos_Aires',
    });

    try {
      const resp = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: PREDICTION_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Fecha: ${dateStr}\n\n${userPrompt}` },
          ],
          max_tokens: 400,
          temperature: 0.3,
        }),
      });

      if (resp.ok) {
        const data = (await resp.json()) as {
          choices: Array<{ message: { content: string } }>;
          usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
        };
        predictionNarrative = data.choices?.[0]?.message?.content?.trim() ?? '';
        budget.record(0.00015, data.usage?.total_tokens ?? 0);
        console.log(`[Predictive] GPT prediction generated: "${predictionNarrative.slice(0, 100)}..."`);
      } else {
        const errBody = await resp.text();
        console.error(`[Predictive] OpenRouter returned ${resp.status}: ${errBody}`);
      }
    } catch (err) {
      console.error('[Predictive] Failed to generate prediction:', (err as Error).message);
    }
  } else {
    console.warn('[Predictive] OpenRouter key missing or budget exhausted — using algorithmic prediction');
  }

  // Build prediction entities list (from top candidates)
  predictedEntities = top5.map((c) => ({
    entityName: c.entityName,
    likelihood: c.totalLikelihood / 100,
    reason: c.totalLikelihood >= 70
      ? `Alta probabilidad (${c.totalLikelihood.toFixed(0)}%) — múltiples señales coincidentes`
      : c.totalLikelihood >= 40
        ? `Probabilidad media (${c.totalLikelihood.toFixed(0)}%) — señales parciales`
        : `Probabilidad baja (${c.totalLikelihood.toFixed(0)}%) — señales débiles`,
  }));

  // ── 5. Store predictions in PostgreSQL ──────────────────────────────
  let stored = 0;
  try {
    for (const p of predictedEntities) {
      await prisma.prediction.create({
        data: {
          entityName: p.entityName,
          confidence: p.likelihood,
          reason: p.reason,
        },
      });
      stored++;
    }
    console.log(`[Predictive] Stored ${stored} predictions`);
  } catch (err) {
    console.error('[Predictive] Failed to store predictions:', (err as Error).message);
  }

  // ── 6. Complete ─────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const formatPrediction =
    predictionNarrative ||
    `Mañana se espera: ${top5.slice(0, 3).map((c) => c.entityName).join(', ')} con confianza ${(top5.reduce((s, c) => s + c.totalLikelihood, 0) / top5.length / 100).toFixed(2)}`;

  console.log('═══════════════════════════════════════');
  console.log(`[Job:predictive] Complete in ${elapsed}s`);
  console.log(`  Trends analyzed:  ${trends.length}`);
  console.log(`  Patterns loaded:  ${patterns.length}`);
  console.log(`  Candidates:       ${entityScores.length}`);
  console.log(`  Predictions:      ${stored}`);
  console.log(`  Narrative:        ${formatPrediction.slice(0, 120)}`);
  console.log(`  Budget:           $${budget.getSummary().spent.toFixed(6)} (${budget.getSummary().tokens} tokens)`);
  console.log('═══════════════════════════════════════');
};
