/**
 * Twitter Publisher configuration.
 *
 * Reads environment variables set by PM2 or the shell.
 * A .env file at the project root is optional (loaded via --env-file or dotenv).
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Resolve project root ───────────────────────────────────
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

export type Config = typeof config;

export const config = {
  twitter: {
    apiKey: process.env.TWITTER_API_KEY ?? '',
    apiSecret: process.env.TWITTER_API_SECRET ?? '',
    accessToken: process.env.TWITTER_ACCESS_TOKEN ?? '',
    accessSecret: process.env.TWITTER_ACCESS_SECRET ?? '',
  },

  server: {
    port: parseInt(process.env.PORT ?? '3004', 10),
  },

  aiProcessor: {
    url: process.env.AI_PROCESSOR_URL ?? 'http://localhost:3013',
  },

  eventDetector: {
    url: process.env.EVENT_DETECTOR_URL ?? 'http://localhost:3008',
  },

  db: {
    path:
      process.env.DB_PATH ??
      path.resolve(PROJECT_ROOT, 'data', 'argentina-radar.db'),
  },

  bluesky: {
    enabled: process.env.BSKY_ENABLED !== 'false',
    identifier: process.env.BSKY_IDENTIFIER || 'argentinaradar.bsky.social',
    password: process.env.BSKY_APP_PASSWORD || '',
  },

  publishing: {
    /** How often to poll for new events (ms). Default 5 minutes. */
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL ?? '300000', 10),
    /** Monthly tweet limit with safety margin (Free tier = 1500). */
    monthlyLimit: 1400,
    /** Daily tweet limit for events. */
    dailyLimit: parseInt(process.env.DAILY_TWEET_LIMIT ?? '50', 10),
    /** Minimum cooldown between event tweets (ms). Default 5 minutes. */
    cooldownMs: parseInt(process.env.TWEET_COOLDOWN_MS ?? '300000', 10),
    /** Delay between individual publishes (ms). */
    interPublishDelayMs: 2000,
  },
} as const;

// ─── Validation warnings ────────────────────────────────────
const missing: string[] = [];
if (!config.twitter.apiKey) missing.push('TWITTER_API_KEY');
if (!config.twitter.apiSecret) missing.push('TWITTER_API_SECRET');
if (!config.twitter.accessToken) missing.push('TWITTER_ACCESS_TOKEN');
if (!config.twitter.accessSecret) missing.push('TWITTER_ACCESS_SECRET');

if (missing.length > 0) {
  console.warn(
    `[config] ⚠️  Missing Twitter credentials: ${missing.join(', ')}. ` +
      'Publishing to Twitter will fail until these are set.'
  );
}

// Bluesky validation
if (config.bluesky.enabled && !config.bluesky.password) {
  console.warn(
    '[config] ⚠️  Missing BSKY_APP_PASSWORD. ' +
      'Bluesky publishing will be skipped until this is set.'
  );
}
