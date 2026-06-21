import type Database from "better-sqlite3";
import { prisma } from "./client.js";
import { setLastError } from "./health.js";
import {
  mapNewsToPostgres,
  mapEventToPostgres,
  mapTweetToPostgres,
  addNewsEventRelation,
  upsertLocation,
} from "./mapping.js";
import type {
  NewsInsertInput,
  EventInsertInput,
  TweetInsertInput,
} from "./mapping.js";

// ──────────────────────────────────────────────────────────
//  Types
// ──────────────────────────────────────────────────────────

/**
 * Dual-write operating mode.
 * - `dual`: write to SQLite (primary) + PostgreSQL (async secondary)
 * - `sqlite_only`: skip PostgreSQL entirely
 * - `postgres_only`: skip SQLite (used during cut-over testing)
 */
export type WriteMode = "dual" | "sqlite_only" | "postgres_only";

export type NewsStatus =
  | "ingested"
  | "geolocated"
  | "filtered"
  | "published"
  | "discarded";

// ──────────────────────────────────────────────────────────
//  Adapter
// ──────────────────────────────────────────────────────────

/**
 * DualWriteAdapter — writes to SQLite synchronously (source-of-truth)
 * then asynchronously to PostgreSQL via Prisma.
 *
 * PostgreSQL failures are logged but never thrown — they must never
 * break the application during migration.
 */
export class DualWriteAdapter {
  private db: Database.Database;
  private mode: WriteMode;

  constructor(db: Database.Database, mode?: WriteMode) {
    this.db = db;
    this.mode = mode ?? resolveWriteMode();
  }

  /** Current operating mode. */
  getMode(): WriteMode {
    return this.mode;
  }

  /** Override the operating mode at runtime. */
  setMode(mode: WriteMode): void {
    this.mode = mode;
    console.log(`[dual-write] Mode changed to ${mode}`);
  }

  // ── Public API ──────────────────────────────────────────

  /**
   * Insert a news item. SQLite write is synchronous; PostgreSQL
   * write runs asynchronously and is NEVER awaited.
   */
  insertNews(data: NewsInsertInput): void {
    // -- SQLite (synchronous, source of truth) --
    if (this.mode !== "postgres_only") {
      this.writeSqliteNews(data);
    }

    // -- PostgreSQL (async, best-effort) --
    if (this.mode !== "sqlite_only") {
      this.writePostgresNews(data).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[dual-write] PostgreSQL insertNews failed: ${msg}`);
        setLastError(msg);
      });
    }
  }

  /**
   * Insert an event. SQLite does not yet have an events table, so this
   * writes only to PostgreSQL (and logs the event ID for traceability).
   */
  insertEvent(data: EventInsertInput): void {
    // Log event creation in SQLite for traceability
    if (this.mode !== "postgres_only") {
      console.log(
        `[dual-write] SQLite event stub: ${data.id} — "${data.title}"`,
      );
    }

    if (this.mode !== "sqlite_only") {
      this.writePostgresEvent(data).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[dual-write] PostgreSQL insertEvent failed: ${msg}`);
        setLastError(msg);
      });
    }
  }

  /**
   * Update a news item's status in both databases.
   */
  updateNewsStatus(id: string, status: NewsStatus): void {
    // -- SQLite --
    if (this.mode !== "postgres_only") {
      this.writeSqliteNewsStatus(id, status);
    }

    // -- PostgreSQL --
    if (this.mode !== "sqlite_only") {
      this.writePostgresNewsStatus(id, status).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[dual-write] PostgreSQL updateNewsStatus failed: ${msg}`,
        );
        setLastError(msg);
      });
    }
  }

  /**
   * Insert a tweet in both databases.
   */
  insertTweet(data: TweetInsertInput): void {
    // -- SQLite --
    if (this.mode !== "postgres_only") {
      this.writeSqliteTweet(data);
    }

    // -- PostgreSQL --
    if (this.mode !== "sqlite_only") {
      this.writePostgresTweet(data).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[dual-write] PostgreSQL insertTweet failed: ${msg}`);
        setLastError(msg);
      });
    }
  }

  // ── SQLite writers (synchronous) ─────────────────────────

  private writeSqliteNews(data: NewsInsertInput): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO news_items
        (id, title, summary, source, sources, url, category, published_at,
         ingested_at, location, status)
      VALUES
        (@id, @title, @summary, @source, @sources, @url, @category,
         @published_at, datetime('now'), @location, 'ingested')
    `);

    const result = stmt.run({
      id: data.id,
      title: data.title,
      summary: data.summary ?? null,
      source: data.source,
      sources: JSON.stringify(data.sources ?? [data.source]),
      url: data.url,
      category: data.category ?? null,
      published_at: data.publishedAt ?? new Date().toISOString(),
      location: data.location ? JSON.stringify(data.location) : null,
    });

    if (result.changes === 0) {
      throw new Error(
        `[dual-write] SQLite insertNews failed for ${data.id}`,
      );
    }
  }

  private writeSqliteNewsStatus(id: string, status: NewsStatus): void {
    const stmt = this.db.prepare(`
      UPDATE news_items SET status = @status WHERE id = @id
    `);

    const result = stmt.run({ id, status });

    if (result.changes === 0) {
      console.warn(
        `[dual-write] SQLite updateNewsStatus: no row found for ${id}`,
      );
    }
  }

  private writeSqliteTweet(data: TweetInsertInput): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO tweet_history
        (id, article_id, tweet_id, posted_at, status)
      VALUES
        (@id, @article_id, @tweet_id, @posted_at, @status)
    `);

    const result = stmt.run({
      id: data.id,
      article_id: data.eventId, // SQLite tweet_history uses article_id
      tweet_id: data.tweetId,
      posted_at: data.postedAt ?? new Date().toISOString(),
      status: "published",
    });

    if (result.changes === 0) {
      throw new Error(
        `[dual-write] SQLite insertTweet failed for ${data.id}`,
      );
    }
  }

  // ── PostgreSQL writers (async, best-effort) ──────────────

  private async writePostgresNews(data: NewsInsertInput): Promise<void> {
    const args = await mapNewsToPostgres(data);
    await prisma.news.create(args);

    // If the flat data includes a location, upsert it into the Location table
    if (data.location) {
      try {
        await upsertLocation(data.location);
      } catch (locErr) {
        // Location upsert failure is non-critical — log and continue
        const msg = locErr instanceof Error ? locErr.message : String(locErr);
        console.warn(`[dual-write] Location upsert skipped: ${msg}`);
      }
    }
  }

  private async writePostgresEvent(data: EventInsertInput): Promise<void> {
    const args = await mapEventToPostgres(data);
    const event = await prisma.event.create(args);

    // Link news items to this event if provided
    if (data.newsIds && data.newsIds.length > 0) {
      const relations = data.newsIds.map((newsId) =>
        addNewsEventRelation(newsId, event.id),
      );
      await Promise.all(relations);
    }

    // Upsert location if present
    if (data.location) {
      try {
        await upsertLocation(data.location);
      } catch (locErr) {
        const msg = locErr instanceof Error ? locErr.message : String(locErr);
        console.warn(`[dual-write] Event location upsert skipped: ${msg}`);
      }
    }
  }

  private async writePostgresNewsStatus(
    id: string,
    status: NewsStatus,
  ): Promise<void> {
    try {
      await prisma.news.update({
        where: { id },
        data: { status },
      });
    } catch (err) {
      // If the News record doesn't exist yet in PG (e.g. from before
      // dual-write was active), that's OK — the migration script will
      // pick it up later.
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[dual-write] PG updateNewsStatus skipped for ${id}: ${msg}`,
      );
    }
  }

  private async writePostgresTweet(data: TweetInsertInput): Promise<void> {
    const args = await mapTweetToPostgres(data);
    await prisma.tweet.create(args);
  }
}

// ──────────────────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────────────────

let cachedMode: WriteMode | null = null;

/**
 * Resolve the write mode from the environment.
 *
 * | DB_MODE env    | Result        |
 * |----------------|---------------|
 * | unset / "dual" | dual          |
 * | "sqlite"       | sqlite_only   |
 * | "postgres"     | postgres_only |
 */
function resolveWriteMode(): WriteMode {
  if (cachedMode) return cachedMode;

  const raw = (process.env.DB_MODE ?? "dual").toLowerCase().trim();
  if (raw === "sqlite" || raw === "sqlite_only") {
    cachedMode = "sqlite_only";
  } else if (raw === "postgres" || raw === "postgres_only") {
    cachedMode = "postgres_only";
  } else {
    cachedMode = "dual";
  }

  console.log(`[dual-write] Mode resolved: ${cachedMode} (DB_MODE=${raw})`);
  return cachedMode;
}

/**
 * Force re-resolve the mode on next call (useful for tests).
 */
export function resetModeCache(): void {
  cachedMode = null;
}
