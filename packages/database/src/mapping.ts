import { Prisma } from "@prisma/client";
import { prisma } from "./client.js";

// ──────────────────────────────────────────────────────────
//  Type aliases for the flat data going into the adapter
// ──────────────────────────────────────────────────────────

export interface SqliteLocation {
  lat: number;
  lng: number;
  province?: string;
  city?: string | null;
}

export interface NewsInsertInput {
  id: string;
  title: string;
  summary?: string | null;
  source: string;
  sourceType?: string;
  sourceUrl?: string;
  sources?: string[];
  url: string;
  category?: string | null;
  publishedAt?: string | null;
  content?: string | null;
  location?: SqliteLocation | null;
}

export interface EventInsertInput {
  id: string;
  title: string;
  summary?: string | null;
  impactScore?: number;
  mediaConsensus?: string;
  location?: SqliteLocation | null;
  newsIds?: string[];
}

export interface TweetInsertInput {
  id: string;
  eventId: string;
  tweetId: string;
  text: string;
  postedAt?: string;
  impactScore?: number;
}

// ──────────────────────────────────────────────────────────
//  Mapping helpers
// ──────────────────────────────────────────────────────────

/**
 * Ensure a Source exists in PostgreSQL — upsert by name.
 */
export async function upsertSource(
  name: string,
  type = "rss",
  url?: string,
): Promise<{
  id: string;
  name: string;
  type: string;
  url: string;
  reliability: number;
}> {
  return prisma.source.upsert({
    where: { name },
    create: { name, type, url: url ?? `https://${name}` },
    update: { type, url: url ?? `https://${name}` },
  });
}

/**
 * Ensure a Category exists — upsert by name.
 */
export async function upsertCategory(
  name: string,
): Promise<{ id: string; name: string; slug: string }> {
  return prisma.category.upsert({
    where: { name },
    create: { name, slug: name.toLowerCase().replace(/\s+/g, "-") },
    update: {},
  });
}

/**
 * Ensure a Location exists — upsert by unique (name, province).
 * Falls back to a generated name when province is missing.
 */
export async function upsertLocation(
  location: SqliteLocation,
): Promise<{
  id: string;
  name: string;
  province: string;
  lat: number;
  lng: number;
}> {
  const name =
    location.city ?? location.province ?? `${location.lat},${location.lng}`;
  const province = location.province ?? "Desconocida";

  return prisma.location.upsert({
    where: { name_province: { name, province } },
    create: { name, province, lat: location.lat, lng: location.lng },
    update: { lat: location.lat, lng: location.lng },
  });
}

/**
 * Map a flat NewsInsertInput into a Prisma News create payload.
 * Resolves Source and Category upserts along the way.
 */
export async function mapNewsToPostgres(
  data: NewsInsertInput,
): Promise<Prisma.NewsCreateArgs> {
  const source = await upsertSource(
    data.source,
    data.sourceType,
    data.sourceUrl,
  );

  let categoryId: string | undefined;
  if (data.category) {
    const cat = await upsertCategory(data.category);
    categoryId = cat.id;
  }

  return {
    data: {
      id: data.id,
      title: data.title,
      summary: data.summary ?? null,
      url: data.url,
      sourceId: source.id,
      content: data.content ?? null,
      categoryId: categoryId ?? null,
      status: "ingested",
      publishedAt: data.publishedAt
        ? new Date(data.publishedAt)
        : new Date(),
      ingestedAt: new Date(),
    },
  };
}

/**
 * Map a flat EventInsertInput into a Prisma Event create payload.
 */
export async function mapEventToPostgres(
  data: EventInsertInput,
): Promise<Prisma.EventCreateArgs> {
  return {
    data: {
      id: data.id,
      title: data.title,
      summary: data.summary ?? null,
      impactScore: data.impactScore ?? 0,
      mediaConsensus: data.mediaConsensus ?? "low",
      location: (data.location as unknown as Prisma.InputJsonValue) ?? Prisma.DbNull,
    },
  };
}

/**
 * Map a flat TweetInsertInput into a Prisma Tweet create payload.
 */
export async function mapTweetToPostgres(
  data: TweetInsertInput,
): Promise<Prisma.TweetCreateArgs> {
  return {
    data: {
      id: data.id,
      eventId: data.eventId,
      tweetId: data.tweetId,
      text: data.text,
      postedAt: data.postedAt ? new Date(data.postedAt) : new Date(),
      impactScore: data.impactScore ?? 0,
    },
  };
}

/**
 * Create a NewsEvent relation linking a News item to an Event.
 */
export async function addNewsEventRelation(
  newsId: string,
  eventId: string,
  confidence = 1.0,
): Promise<{
  newsId: string;
  eventId: string;
  confidence: number;
}> {
  return prisma.newsEvent.create({
    data: { newsId, eventId, confidence },
  });
}

/**
 * Parse a JSON-stringified location from SQLite.
 */
export function parseSqliteLocation(
  raw: string | null | undefined,
): SqliteLocation | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.lat === "number" &&
      typeof parsed.lng === "number"
    ) {
      return {
        lat: parsed.lat,
        lng: parsed.lng,
        province: parsed.province,
        city: parsed.city ?? null,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse a JSON-stringified sources array from SQLite.
 */
export function parseSqliteSources(
  raw: string | null | undefined,
): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
