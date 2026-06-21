# Design: Night Owl — Nocturnal Automation Service

## Technical Approach

Create a new `services/night-owl/` service that runs heavyweight batch jobs during low-traffic hours (01:00–06:00 ART). It follows the existing service pattern: Node.js + Express, registered in PM2, uses BullMQ for job orchestration, and reads from both SQLite (legacy) and PostgreSQL (v2 dual-write).

The service exposes a dashboard API so the frontend can show a "Morning Briefing" panel when the user opens the app. Each nightly run produces a structured report persisted to a new `nightly_reports` table (SQLite) and `NightlyReport` model (Prisma).

## Architecture Decisions

| Decision | Option A | Option B | Choice | Rationale |
|----------|----------|----------|--------|-----------|
| Scheduler engine | `node-cron` | `setInterval` + ART clock | `node-cron` | Cron expressions are declarative, timezone-aware, and self-documenting. The existing `setInterval` pattern in `economic-data/schedulers.ts` works for simple intervals but becomes unmaintainable with 8+ jobs at different times. |
| Job runner | BullMQ workers | In-process `async` calls | BullMQ | Reuses existing Redis infra, gives retries/DLQ/observability for free, and decouples scheduling from execution. If a job fails at 3 AM it retries without blocking the next one. |
| Storage | SQLite only | SQLite + PostgreSQL dual-write | Dual-write | Matches PR 1.2 pattern. SQLite for fast local reads by the dashboard; PostgreSQL for long-term analytics. |
| AI budget | Unlimited | Per-night cap | Per-night cap ($1.00) | Night jobs can burn tokens fast on batch summarization. A cap prevents surprise bills. Jobs that would exceed the cap defer to next night. |
| Morning delivery | Push notification | Poll on app open | Poll on app open | No push infra exists. Frontend calls `GET /api/night-owl/briefing` on load; if a fresh report exists (< 6h old), it renders the Morning Briefing panel. |

## Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     Night Owl Service (:3011)                │
│                                                              │
│  node-cron scheduler (ART timezone)                         │
│       │                                                      │
│       ├── 01:00 → backfill-processor                        │
│       ├── 02:00 → daily-digest                              │
│       ├── 03:00 → pattern-detector                          │
│       ├── 03:30 → embedding-optimizer                       │
│       ├── 04:00 → predictive-analysis                       │
│       ├── 05:00 → data-cleanup                              │
│       └── 05:30 → system-health-report                      │
│       │                                                      │
│       ▼                                                      │
│  BullMQ Queue: 'night-owl' (concurrency: 1)                 │
│       │                                                      │
│       ▼                                                      │
│  Worker → calls existing services via HTTP                  │
│       │    ├── news-ingestion :3001 (read articles)          │
│       │    ├── ai-processor   :3010 (embeddings, NER, GPT)   │
│       │    ├── event-detector :3008 (read events)            │
│       │    └── trend-analyzer :3009 (read trends)            │
│       │                                                      │
│       ▼                                                      │
│  Persist → SQLite nightly_reports + PostgreSQL NightlyReport │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
              Frontend: Morning Briefing panel
              GET /api/night-owl/briefing
```

## Nightly Jobs — Schedule & Output

### 1. Backfill Processor — 01:00 ART
**What**: Find articles missing `embedding`, `entities`, or `location` and process them in batch.
**Why**: Real-time pipeline sometimes skips AI enrichment (budget exhausted, service down). Night batch catches up.
**Query**: `SELECT * FROM news_items WHERE embedding IS NULL OR entities IS NULL LIMIT 200`
**Calls**: `ai-processor POST /api/process` (batch), `geolocation POST /api/geolocate`
**Output**: `{ processed: N, embeddings: N, entities: N, locations: N }`

### 2. Daily Digest — 02:00 ART
**What**: Generate an executive summary of the previous day's events using GPT-4o.
**Why**: User wants a "what happened yesterday" briefing when opening the app in the morning.
**Input**: Top 20 events by impact from event-detector, trending entities from trend-analyzer, economic data snapshots.
**Calls**: `ai-processor POST /api/summarize` with structured prompt.
**Output**: `{ summary: string, topEvents: Event[], topTrends: Trend[], economicSnapshot: {...} }`

### 3. Historical Pattern Detector — 03:00 ART
**What**: Analyze the last 30 days of events to find recurring patterns (entity co-occurrence, cyclical topics, source bias shifts).
**Why**: Surfaces insights like "Entity X appears every Monday in political context" or "Source Y has shifted tone on topic Z."
**Algorithm**: Sliding window co-occurrence matrix + frequency analysis over 30-day event corpus.
**Output**: `{ patterns: Pattern[], anomalies: Anomaly[] }`

### 4. Embedding Optimizer — 03:30 ART
**What**: Rebuild the in-memory embedding index in event-detector. Identify and merge near-duplicate events (cosine sim > 0.95 that weren't caught in real-time).
**Why**: Over 24h, the in-memory store accumulates events that should have been merged. Night pass cleans up.
**Algorithm**: All-pairs cosine similarity on events from last 48h. Merge pairs above threshold.
**Output**: `{ merged: N, indexRebuilt: true }`

### 5. Predictive Analysis — 04:00 ART
**What**: Based on trending entities and event velocity, predict which stories will dominate the next 24h.
**Why**: Prepares the system to prioritize ingestion and alerting for predicted hot topics.
**Algorithm**: Linear extrapolation on mention growth rate (from trend-analyzer) + GPT analysis of event trajectories.
**Output**: `{ predictions: [{ entity, confidence, reasoning }] }`

### 6. Data Cleanup & Archival — 05:00 ART
**What**: Archive events older than 30 days, prune orphaned articles, compact SQLite WAL, clean BullMQ completed jobs.
**Why**: Prevents unbounded growth of in-memory stores and SQLite file.
**Operations**:
- Move events > 30d to `archived_events` table
- `PRAGMA wal_checkpoint(TRUNCATE)` on SQLite
- `VACUUM` on SQLite (weekly only — Sundays)
- Delete BullMQ jobs older than 7 days
**Output**: `{ archivedEvents: N, prunedArticles: N, dbSizeBefore, dbSizeAfter }`

### 7. System Health Report — 05:30 ART
**What**: Collect health from all 10 services, check DB sizes, queue depths, AI budget usage, and source reliability.
**Why**: Single-pane-of-glass status when the user opens the app.
**Calls**: `GET /health` on every service, SQLite stats, Redis `INFO`.
**Output**: `{ services: [{name, status, uptime, memory}], queues: [{name, waiting, active, failed}], aiBudget: {used, remaining}, sources: {healthy, degraded} }`

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `services/night-owl/src/index.ts` | Create | Entry point — starts Express + cron scheduler |
| `services/night-owl/src/server.ts` | Create | Express API: `/api/night-owl/briefing`, `/api/night-owl/reports`, `/health` |
| `services/night-owl/src/scheduler.ts` | Create | Cron registration for all 7 jobs with ART timezone |
| `services/night-owl/src/jobs/backfill.ts` | Create | Backfill processor job |
| `services/night-owl/src/jobs/dailyDigest.ts` | Create | Daily digest generation via GPT |
| `services/night-owl/src/jobs/patternDetector.ts` | Create | Historical pattern detection |
| `services/night-owl/src/jobs/embeddingOptimizer.ts` | Create | Embedding index rebuild + event merge |
| `services/night-owl/src/jobs/predictiveAnalysis.ts` | Create | Next-day prediction engine |
| `services/night-owl/src/jobs/dataCleanup.ts` | Create | Archival + SQLite maintenance |
| `services/night-owl/src/jobs/healthReport.ts` | Create | Multi-service health aggregation |
| `services/night-owl/src/db.ts` | Create | SQLite connection + nightly_reports migration |
| `services/night-owl/src/config.ts` | Create | Env config: port, cron tz, AI budget cap |
| `services/night-owl/src/types.ts` | Create | Shared types: NightlyReport, JobResult |
| `services/night-owl/package.json` | Create | Dependencies: node-cron, axios, better-sqlite3 |
| `config/pm2.config.cjs` | Modify | Add `night-owl` entry on port 3011 |
| `packages/queue/src/types.ts` | Modify | Add `NightOwl = 'night-owl'` to QueueName enum |
| `packages/queue/src/queues.ts` | Modify | Add NightOwl queue config (concurrency: 1) |
| `packages/database/prisma/schema.prisma` | Modify | Add `NightlyReport` model |

## Interfaces / Contracts

```typescript
// services/night-owl/src/types.ts

export interface NightlyReport {
  id: string;
  date: string;              // ISO date (YYYY-MM-DD)
  jobName: string;           // 'backfill' | 'digest' | 'patterns' | ...
  status: 'success' | 'partial' | 'failed';
  startedAt: string;
  completedAt: string;
  durationMs: number;
  result: Record<string, unknown>;  // Job-specific output
  error?: string;
}

export interface MorningBriefing {
  date: string;
  generatedAt: string;
  digest: {
    summary: string;
    topEvents: Array<{ id: string; title: string; impact: number }>;
    topTrends: Array<{ name: string; score: number; growth: number }>;
    economicSnapshot: Record<string, unknown>;
  };
  predictions: Array<{
    entity: string;
    confidence: number;
    reasoning: string;
  }>;
  patterns: Array<{
    type: string;
    description: string;
    confidence: number;
  }>;
  systemHealth: {
    servicesOk: number;
    servicesTotal: number;
    queueBacklog: number;
    aiBudgetRemaining: number;
  };
  cleanup: {
    archivedEvents: number;
    dbSizeMb: number;
  };
}
```

```prisma
// New model in schema.prisma
model NightlyReport {
  id          String   @id @default(uuid())
  date        DateTime
  jobName     String
  status      String   // "success" | "partial" | "failed"
  startedAt   DateTime
  completedAt DateTime
  durationMs  Int
  result      Json
  error       String?

  @@index([date])
  @@index([jobName, date])
}
```

## Frontend Integration — Morning Briefing Panel

When the user opens the app, the frontend calls `GET http://localhost:3011/api/night-owl/briefing`. If a report from the last 6 hours exists, the API returns a `MorningBriefing` object. The frontend renders:

1. **Executive Summary** — GPT-generated paragraph of yesterday's key events
2. **Top Events** — Cards with impact scores and consensus badges
3. **Predictions** — "Watch today" section with predicted hot topics
4. **Patterns Discovered** — Interesting historical insights
5. **System Status** — Green/red indicators for all services
6. **Cleanup Stats** — "Archived 142 events, DB: 234 MB"

If no report exists (service was down), the panel shows "No nightly report available" with a link to the system health endpoint.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Each job function with mocked HTTP clients | Vitest + mock axios responses |
| Unit | Cron schedule correctness (ART timezone) | Verify next-run times for known dates |
| Integration | Full job pipeline against test SQLite DB | In-memory SQLite, seed with fixture articles |
| Integration | Morning Briefing API response shape | Supertest against Express app |
| E2E | PM2 start → cron fires → report persisted → API returns it | Manual + script trigger via `POST /api/night-owl/trigger/:job` |

## Migration / Rollout

1. **Phase 1**: Deploy service with all jobs. Add `POST /api/night-owl/trigger/:job` endpoint for manual testing during the day.
2. **Phase 2**: Enable cron schedules. Monitor first 3 nights via PM2 logs.
3. **Phase 3**: Add frontend Morning Briefing panel.
4. **Phase 4**: Add alerting — if nightly run fails, push to Hermes Bridge for Slack/Telegram notification.

No data migration required — new tables are additive.

## Open Questions

- [ ] Should the AI budget cap be shared across night-owl and the real-time pipeline, or separate?
- [ ] Do we want to persist pattern/anomaly results to a dedicated table for historical tracking, or keep them in the nightly_reports JSON blob?
- [ ] Should embedding-optimizer also rebuild the pgvector IVFFlat index (requires raw SQL on PostgreSQL)?
- [ ] Weekend schedule: run all jobs, or skip digest/predictions on Saturday night → Sunday?
