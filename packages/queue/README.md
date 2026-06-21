# @argentinaradar/queue — Redis + BullMQ Setup

Job queue infrastructure for ArgentinaRadar v2, powered by **BullMQ v5** and
**ioredis v5**. Runs on Windows via Memurai, WSL2, or Docker Desktop.

## Prerequisites

- Node.js >= 18

## Install

```bash
npm install
```

## Redis Setup (choose one)

### Option A: Memurai (recommended for Windows — native, no WSL needed)

Memurai is a Redis-compatible server that runs natively on Windows (free
developer edition supports up to 1 GB).

1. Download from [memurai.com](https://www.memurai.com/)
2. Run the installer (Developer edition is free)
3. Memurai starts automatically as a Windows service
4. Verify it's running (see below)

### Option B: WSL2 Redis

If you already have WSL2 set up:

```bash
wsl sudo apt update
wsl sudo apt install redis-server -y
wsl sudo service redis-server start
```

Make sure the Redis port (6379) is accessible from Windows.

### Option C: Docker Desktop Redis

If you have Docker Desktop running on Windows:

```bash
docker run -d --name redis \
  -p 6379:6379 \
  redis:7-alpine \
  redis-server --save 60 1 --loglevel warning
```

## Verify Redis is Running

```bash
node packages/queue/src/check.js
```

Expected output:

```
✅ Redis connection OK — PING: PONG
📦 Redis version: 7.x.x
📍 localhost:6379
```

## Environment Variables

| Variable        | Default     | Description                    |
|-----------------|-------------|--------------------------------|
| `REDIS_HOST`    | `localhost` | Redis server hostname          |
| `REDIS_PORT`    | `6379`      | Redis server port              |
| `REDIS_PASSWORD`| —           | Optional AUTH password         |
| `REDIS_DB`      | `0`         | Redis database index           |

## Queue Architecture

Six typed queues, each with tuned concurrency and retry policies:

| Queue             | Concurrency | Max Retries | Backoff     | Job Types                                                    |
|-------------------|-------------|-------------|-------------|--------------------------------------------------------------|
| `ingestion`       | 3           | 5           | exponential | `fetch-rss`, `scrape-source`                                 |
| `geolocation`     | 5           | 3           | exponential | `geolocate-article`                                          |
| `ai-processing`   | 2           | 3           | exponential | `filter-article`, `extract-entities`, `generate-embedding`   |
| `event-detection` | 2           | 3           | exponential | `detect-event`, `score-impact`, `summarize-event`            |
| `twitter-publish` | 1           | 5           | exponential | `publish-event`                                               |
| `trend-analysis`  | 1           | 2           | exponential | `analyze-trends`                                              |

## Usage

```typescript
import {
  createRedisConnection,
  createQueues,
  createWorker,
  closeRedisConnection,
  closeQueues,
  closeWorkers,
  QueueName,
} from '@argentinaradar/queue';

// 1. Connection
const connection = createRedisConnection();

// 2. Queues
const queues = createQueues(connection);

// 3. Workers
const worker = createWorker(
  QueueName.Ingestion,
  async (job) => {
    if (job.name === 'fetch-rss') {
      // handle fetch-rss
    }
  },
  { connection },
);

// 4. Add a job
await queues[QueueName.Ingestion].add('fetch-rss', {
  url: 'https://example.com/rss',
  sourceId: 'src-1',
});

// 5. Graceful shutdown
process.on('SIGTERM', async () => {
  await closeWorkers([worker]);
  await closeQueues(queues);
  await closeRedisConnection(connection);
});
```

## Dead Letter Queue (DLQ)

When a job exhausts all retry attempts, the worker invokes the dead letter
handler. By default it logs the failure with job metadata. Override by
passing a custom `DeadLetterHandler` to `createWorker`.
