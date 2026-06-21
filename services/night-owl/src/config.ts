/**
 * Night Owl — Configuration
 *
 * Reads environment variables with sensible defaults for development.
 */

export const config = {
  /** Service port */
  port: parseInt(process.env.PORT ?? '3011', 10),

  /** Master toggle — set to "false" to disable all scheduled jobs */
  enabled: process.env.NIGHT_OWL_ENABLED !== 'false',

  /** Maximum AI budget (USD) consumed per nightly run cycle */
  budgetPerNight: parseFloat(process.env.NIGHT_OWL_BUDGET_PER_NIGHT ?? '1.00'),

  /** Cron / display timezone */
  timezone: process.env.TIMEZONE ?? 'America/Argentina/Buenos_Aires',

  /** Redis connection */
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  },

  /** Queue name */
  queueName: 'night-owl',

  /** Event Detector service URL */
  eventDetectorUrl: process.env.EVENT_DETECTOR_URL ?? 'http://localhost:3008',

  /** Minimum events required for meaningful pattern detection */
  minEventsForPattern: 3,

  /** Cosine similarity threshold for event merging (0.0 – 1.0) */
  mergeSimilarityThreshold: 0.95,
} as const;
