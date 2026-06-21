/**
 * Night Owl — Job barrel export
 *
 * Every job module exports a `run(data?)` function.
 * This barrel makes it easy to add new jobs without touching the dispatcher.
 */

export type JobFn = (data?: unknown) => Promise<void>;

export { runBackfill } from './backfill.js';
export { runDigest } from './digest.js';
export { runPattern } from './pattern.js';
export { runOptimizer } from './optimizer.js';
export { runPredictive } from './predictive.js';
export { runCleanup } from './cleanup.js';
export { runHealth } from './health.js';
