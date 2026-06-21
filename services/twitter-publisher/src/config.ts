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

  aiFilter: {
    url: process.env.AI_FILTER_URL ?? 'http://localhost:3003',
  },

  db: {
    path:
      process.env.DB_PATH ??
      path.resolve(PROJECT_ROOT, 'data', 'argentina-radar.db'),
  },

  publishing: {
    /** Max tweets per hour (spam protection). */
    maxTweetsPerHour: 10,
    /** How often to poll the DB for new articles (ms). Default 5 minutes. */
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL ?? '300000', 10),
    /** Monthly tweet limit with safety margin (Free tier = 1500). */
    monthlyLimit: 1400,
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
