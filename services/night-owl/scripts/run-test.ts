/**
 * Integration test runner — seeds event-detector data and runs both P1 jobs.
 * Usage from services/night-owl:  npx tsx scripts/run-test.ts
 */

import { runPattern } from '../src/jobs/pattern.js';
import { runOptimizer } from '../src/jobs/optimizer.js';

const ED = 'http://localhost:3008';

async function postDetect(
  title: string,
  source: string,
  category: string,
  entities?: Array<{ name: string; type: string; tier: number }>,
  embedding?: number[],
) {
  const body: Record<string, unknown> = {
    title,
    summary: `Resumen: ${title}`,
    source,
    url: `https://example.com/${encodeURIComponent(title.toLowerCase().replace(/\s+/g, '-'))}`,
    category,
    publishedAt: new Date().toISOString(),
    embedding: embedding ?? Array.from({ length: 8 }, () => Math.random() * 2 - 1),
  };

  const res = await fetch(`${ED}/api/detect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error(`  ✗ POST /api/detect failed (${res.status}) for "${title}"`);
    return null;
  }
  const data = await res.json() as { eventId: string };
  console.log(`  ✓ ${data.eventId.slice(0, 8)}… → "${title}"`);
  return data;
}

async function main() {
  console.log('══════════════════════════════════════════');
  console.log('  P1 Integration Test');
  console.log('══════════════════════════════════════════');

  // ── 1. Check event-detector health ──────────────────
  const health = await fetch(`${ED}/health`).then((r) => r.json()).catch(() => null);
  if (!health) {
    console.error('✗ Event-detector not running. Start it first.');
    process.exit(1);
  }
  console.log(`✓ Event-detector healthy (${health.eventCount} events)`);

  // ── 2. Seed events with entities ────────────────────
  console.log('\n── Seeding events ──');

  // Note: entities from POST /api/detect come from ai-processor, so the
  // events created here won't have entities in the event-detector store.
  // The pattern detector will find 0 entities and log accordingly.
  for (let i = 0; i < 5; i++) {
    await postDetect(`Evento de prueba ${i + 1}`, 'TestSource', 'sociedad');
  }

  // Create near-duplicate events for optimizer
  const dupEmb = [0.95, 0.94, 0.96, 0.93, 0.01, 0.02, 0.01, 0.03];
  await postDetect('Noticia original', 'SourceA', 'política', undefined, dupEmb);
  await postDetect('Noticia duplicada (misma embedding)', 'SourceB', 'política', undefined, dupEmb);
  await postDetect('Tercera copia', 'SourceC', 'política', undefined, dupEmb);

  // ── 3. Run pattern detector ─────────────────────────
  console.log('\n── Running Pattern Detector ──');
  try {
    await runPattern();
    console.log('✓ Pattern detector completed');
  } catch (err) {
    console.error('✗ Pattern detector failed:', (err as Error).message);
  }

  // ── 4. Run embedding optimizer ──────────────────────
  console.log('\n── Running Embedding Optimizer ──');
  try {
    await runOptimizer();
    console.log('✓ Embedding optimizer completed');
  } catch (err) {
    console.error('✗ Embedding optimizer failed:', (err as Error).message);
  }

  console.log('\n══════════════════════════════════════════');
  console.log('  Test complete');
  console.log('══════════════════════════════════════════');
}

main().catch(console.error);
