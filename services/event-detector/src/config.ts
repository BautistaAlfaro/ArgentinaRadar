/**
 * Environment-based configuration for the Event Detector service.
 *
 * All values have sensible defaults for development.
 */

export const config = {
  /** URL of the ai-processor service (embeddings, GPT verification). */
  aiProcessorUrl: process.env.AI_PROCESSOR_URL || 'http://localhost:3013',

  /** HTTP port for this service. */
  port: parseInt(process.env.PORT || '3008', 10),

  /** Cosine similarity thresholds for event matching. */
  similarityThreshold: {
    /** >= this → automatic match, no GPT needed. */
    autoMatch: 0.90,
    /** >= this but < autoMatch → GPT verification required. */
    gptVerify: 0.85,
  },
};
