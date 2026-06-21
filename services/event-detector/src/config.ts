/**
 * Environment-based configuration for the Event Detector service.
 *
 * All values have sensible defaults for development.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const config = {
  /** URL of the ai-processor service (embeddings, GPT verification). */
  aiProcessorUrl: process.env.AI_PROCESSOR_URL || 'http://localhost:3013',

  /** HTTP port for this service. */
  port: parseInt(process.env.PORT || '3008', 10),

  /** Path to the shared SQLite database (for the fallback loop). */
  dbPath: process.env.DB_PATH || path.resolve(__dirname, '..', '..', '..', 'data', 'argentina-radar.db'),

  /** Interval (ms) for the fallback DB polling loop that catches missed articles. */
  fallbackPollIntervalMs: parseInt(process.env.FALLBACK_POLL_INTERVAL ?? '300000', 10),

  /** Cosine similarity thresholds for event matching. */
  similarityThreshold: {
    /** >= this → automatic match, no GPT needed. */
    autoMatch: 0.90,
    /** >= this but < autoMatch → GPT verification required. */
    gptVerify: 0.85,
  },
};
