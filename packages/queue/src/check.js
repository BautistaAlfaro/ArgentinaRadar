#!/usr/bin/env node

/**
 * Redis connection check script.
 *
 * Usage:
 *   node packages/queue/src/check.js
 *
 * Environment:
 *   REDIS_HOST  – default localhost
 *   REDIS_PORT  – default 6379
 *   REDIS_PASSWORD – optional
 *
 * Exit codes:
 *   0 – Redis reachable and responding
 *   1 – Connection failed
 */

import Redis from 'ioredis';

const host = process.env.REDIS_HOST || 'localhost';
const port = Number(process.env.REDIS_PORT) || 6379;

const redis = new Redis({
  host,
  port,
  maxRetriesPerRequest: null,
  lazyConnect: true,
  retryStrategy: () => null,      // no automatic retries — we want a fast pass/fail
});

// Suppress the noisy connection-refused error event — we handle errors in catch
redis.on('error', () => {});

async function check() {
  try {
    await redis.connect();
    const pong = await redis.ping();
    console.log(`✅ Redis connection OK — PING: ${pong}`);

    const info = await redis.info('server');
    const versionMatch = info.match(/redis_version:(\S+)/);
    if (versionMatch) {
      console.log(`📦 Redis version: ${versionMatch[1]}`);
    }

    console.log(`📍 ${host}:${port}`);
    await redis.quit();
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ Redis connection FAILED`);
    console.error(`   Tried ${host}:${port}`);
    console.error(`   Cause: ${message}`);
    process.exit(1);
  }
}

check();
