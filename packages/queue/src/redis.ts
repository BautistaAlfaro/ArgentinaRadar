import Redis from 'ioredis';

export interface RedisConfig {
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  enableReadyCheck?: boolean;
  maxRetriesPerRequest?: number | null;
  retryStrategy?: (times: number) => number | null;
  lazyConnect?: boolean;
}

/**
 * Create a Redis connection configured for BullMQ.
 *
 * Reads from environment variables by default, with sensible local-dev
 * defaults for Memurai / standard Redis on Windows.
 *
 * Environment variables:
 *   REDIS_HOST     – default localhost
 *   REDIS_PORT     – default 6379
 *   REDIS_PASSWORD – optional
 *   REDIS_DB       – default 0
 */
export function createRedisConnection(
  config?: RedisConfig,
): Redis {
  const {
    host = process.env.REDIS_HOST || 'localhost',
    port = Number(process.env.REDIS_PORT) || 6379,
    password = process.env.REDIS_PASSWORD,
    db = Number(process.env.REDIS_DB) || 0,
    enableReadyCheck = false,
    maxRetriesPerRequest = null,
    retryStrategy = (times: number): number | null => {
      if (times > 10) return null;            // give up after 10 attempts
      return Math.min(times * 200, 5000);      // linear backoff up to 5s
    },
    lazyConnect = false,
  } = config ?? {};

  return new Redis({
    host,
    port,
    password,
    db,
    enableReadyCheck,
    maxRetriesPerRequest,
    retryStrategy,
    lazyConnect,
  });
}

/**
 * Health check – returns true when the server responds to PING.
 */
export async function checkRedisConnection(redis: Redis): Promise<boolean> {
  try {
    if (redis.status === 'end' || redis.status === 'close') {
      await redis.connect();
    }
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

/**
 * Graceful shutdown – drain + quit the Redis connection.
 * Use this in SIGTERM / SIGINT handlers.
 */
export async function closeRedisConnection(redis: Redis): Promise<void> {
  try {
    await redis.quit();
  } catch {
    redis.disconnect(false);
  }
}
