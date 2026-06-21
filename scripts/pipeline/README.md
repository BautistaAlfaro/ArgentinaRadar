# Pipeline Scripts

Batch news pipeline for ArgentinaRadar. Each phase is a standalone TypeScript
script executed with `npx tsx`. They share a single SQLite database at
`data/argentina-radar.db` and communicate via the `status` column on `news_items`.

## Status Flow

```
ingested -> filtered | discarded -> pending_approval -> published
```

| Status             | Set by       | Meaning                                  |
|--------------------|--------------|------------------------------------------|
| `ingested`         | Phase 1      | Raw article, no AI processing yet        |
| `filtered`         | Phase 2      | Passed AI filter, ready for tweet draft  |
| `discarded`        | Phase 2      | Rejected by AI (spam / off-topic)        |
| `pending_approval` | Phase 3      | Tweet draft generated, awaiting approval |
| `published`        | Phase 4/5    | Tweet posted to Twitter/X                |

## Prerequisites

- Node >= 18
- `better-sqlite3` installed (already in repo)
- ai-processor service running at `http://localhost:3013` (required for phases 2 & 3)

## Running All Phases in Sequence

> Run from the **repo root**.

```powershell
# Phase 1 — Ingest new articles from RSS feeds
npx tsx scripts/pipeline/01-ingest-raw.ts

# Phase 1 with a custom per-source article cap
npx tsx scripts/pipeline/01-ingest-raw.ts --limit 25

# Phase 2 — AI filter (keep/discard) ingested articles
npx tsx scripts/pipeline/02-filter-batch.ts

# Phase 3 — Generate tweet drafts for filtered articles
npx tsx scripts/pipeline/03-generate-tweets.ts

# Phase 4 — (planned) Human approval review / Telegram bot
# Phase 5 — (planned) Post approved tweets to Twitter/X
```

### One-liner (PowerShell)

```powershell
npx tsx scripts/pipeline/01-ingest-raw.ts; `
npx tsx scripts/pipeline/02-filter-batch.ts; `
npx tsx scripts/pipeline/03-generate-tweets.ts
```

### One-liner (bash / Git Bash)

```bash
npx tsx scripts/pipeline/01-ingest-raw.ts && \
npx tsx scripts/pipeline/02-filter-batch.ts && \
npx tsx scripts/pipeline/03-generate-tweets.ts
```

## Phase Reference

### Phase 1 — `01-ingest-raw.ts`

Fetches all RSS feeds from active sources (`sources` table, `status IN ('healthy', 'active')`),
deduplicates by URL, and inserts new rows with `status='ingested'`.

Scrape-type sources are skipped (they require a headless browser).

**Options**

| Flag        | Default | Description                          |
|-------------|---------|--------------------------------------|
| `--limit N` | `10`    | Max articles to ingest per source    |

**Output example**

```
[ingest] Done. Ingested 47 new articles from 8 source(s)
```

---

### Phase 2 — `02-filter-batch.ts`

Reads up to 50 articles with `status='ingested'`, sends each to
`POST http://localhost:3013/api/process`, and applies this logic:

- `publish === true` OR `category` not in `['spam', 'offtopic']` -> `status='filtered'`
- Otherwise -> `status='discarded'`

If the ai-processor is offline, the article is skipped (status unchanged) and a warning
is printed. Run phase 2 again once the service is back up.

**Environment variables**

| Variable          | Default                    | Description             |
|-------------------|----------------------------|-------------------------|
| `AI_PROCESSOR_URL`| `http://localhost:3013`    | ai-processor base URL   |

**Output example**

```
[filter] Done. Filtered 50 articles: 38 kept, 12 discarded
```

---

### Phase 3 — `03-generate-tweets.ts`

Reads up to 20 articles with `status='filtered'` that are not yet in `approval_queue`,
generates a tweet draft for each, inserts rows into `approval_queue`, and sets
`status='pending_approval'` on the news item.

Tweet generation priority:

1. `POST /api/summarize` (if the endpoint exists)
2. `POST /api/process` -> craft tweet from entities + title
3. Manual fallback: `"[title] - [source] [url]"` truncated to 280 chars

All drafts in a single run share a `batch_id` (`batch_YYYYMMDD_HHmmss`).

> **Note**: This script also runs a migration to create the `approval_queue` table
> if it does not exist yet.

**Output example**

```
[tweets] Done. Generated 20 tweet draft(s) for batch batch_20260621_201500
```

---

### Phase 4 — Approval (planned)

Will send `pending` drafts from `approval_queue` via Telegram for human review.
Approved rows move to `status='approved'`, rejected to `status='rejected'`.

### Phase 5 — Publish (planned)

Will post `approved` drafts to Twitter/X using the twitter-publisher service,
update `approval_queue.status='published'` and `news_items.status='published'`,
and record the tweet ID.

## Database Tables Used

| Table            | Used by       | Notes                                           |
|------------------|---------------|-------------------------------------------------|
| `sources`        | Phase 1       | Read active RSS sources                         |
| `news_items`     | All phases    | Central article store                           |
| `approval_queue` | Phase 3, 4, 5 | Created by Phase 3 if absent                    |
| `tweet_history`  | Phase 5       | Written after successful post                   |

## Troubleshooting

**"No active sources found"** — Check that the `sources` table has rows with
`status='healthy'` or `status='active'` and `type='rss'`.

**"ai-processor offline"** — Start the ai-processor service on port 3013 and
re-run phase 2. Articles skipped due to downtime retain `status='ingested'` and
will be picked up on the next run.

**"No filtered articles pending"** — Phase 2 has not run yet, or all articles
were discarded. Check the DB: `SELECT count(*), status FROM news_items GROUP BY status`.
