export { prisma } from "./client.js";
export type {
  News,
  Source,
  Event,
  NewsEvent,
  Entity,
  EventEntity,
  Location,
  Trend,
  Tweet,
  Category,
  AiCost,
  User,
  Session,
  Role,
  KPI,
  SystemMetric,
  DailyStats,
  Subscription,
  Pattern,
} from "@prisma/client";

// ── Dual-Write Adapter ────────────────────────────────────
export { DualWriteAdapter, resetModeCache } from "./dual-write.js";
export type { WriteMode, NewsStatus } from "./dual-write.js";
export type {
  NewsInsertInput,
  EventInsertInput,
  TweetInsertInput,
  SqliteLocation,
} from "./mapping.js";
export {
  upsertSource,
  upsertCategory,
  upsertLocation,
  mapNewsToPostgres,
  mapEventToPostgres,
  mapTweetToPostgres,
  addNewsEventRelation,
  parseSqliteLocation,
  parseSqliteSources,
} from "./mapping.js";

// ── Health ────────────────────────────────────────────────
export {
  checkPostgresHealth,
  checkSqliteHealth,
  getDualWriteStatus,
  setLastError,
  getLastError,
} from "./health.js";
export type { HealthStatus } from "./health.js";
