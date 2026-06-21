/**
 * Source Manager — CRUD operations for RSS/Scrape source config.
 *
 * Reads/writes `data/sources.json` and provides typed helpers for
 * listing, adding, removing, and toggling sources.
 *
 * The `enabled` field defaults to `true` for sources that don't have it
 * (backward compatibility with existing configs).
 */

import fs from "fs";
import path from "path";

// ─── Types ─────────────────────────────────────────────────────────────

export interface CssSelectors {
  article: string;
  title: string;
  summary: string;
  link: string;
  timestamp: string;
}

export interface Source {
  name: string;
  type: "rss" | "scrape";
  url: string;
  category?: string;
  rateLimitMs?: number;
  enabled: boolean;
  cssSelectors?: CssSelectors;
}

export interface SourcesConfig {
  _comment?: string;
  sources: Source[];
}

export interface SourceStats {
  name: string;
  articleCount: number;
  /** ISO timestamp of the most recent article from this source */
  lastArticleAt: string | null;
}

// ─── Path resolution ───────────────────────────────────────────────────

function resolveSourcesPath(): string {
  return (
    process.env.SOURCES_PATH ??
    path.resolve(process.cwd(), "data", "sources.json")
  );
}

// ─── Read / Write ──────────────────────────────────────────────────────

/**
 * Load all sources from `data/sources.json`, normalizing `enabled` so that
 * entries without the field default to `true`.
 */
export function loadSources(): Source[] {
  const filePath = resolveSourcesPath();
  const raw = fs.readFileSync(filePath, "utf-8");
  const config: SourcesConfig = JSON.parse(raw);

  if (!Array.isArray(config.sources)) {
    throw new Error(`Invalid sources.json: missing "sources" array`);
  }

  return config.sources.map(normalizeSource);
}

/**
 * Persist a full sources array back to `data/sources.json`.
 * Preserves the `_comment` if present.
 */
export function writeSources(sources: Source[]): void {
  const filePath = resolveSourcesPath();

  // Preserve existing _comment
  let comment: string | undefined;
  try {
    const existing = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    comment = existing._comment;
  } catch {
    // ignore
  }

  const config: SourcesConfig = {
    ...(comment ? { _comment: comment } : {}),
    sources,
  };

  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Return a list of all sources (equivalent to `loadSources()`).
 */
export function listSources(): Source[] {
  return loadSources();
}

/**
 * Add a new source. Throws if a source with the same name already exists.
 */
export function addSource(source: Source): void {
  const sources = loadSources();

  if (sources.some((s) => s.name === source.name)) {
    throw new Error(`Source "${source.name}" already exists`);
  }

  sources.push(normalizeSource(source));
  writeSources(sources);
}

/**
 * Remove a source by name. Throws if not found.
 */
export function removeSource(name: string): void {
  const sources = loadSources();
  const idx = sources.findIndex((s) => s.name === name);

  if (idx === -1) {
    throw new Error(`Source "${name}" not found`);
  }

  sources.splice(idx, 1);
  writeSources(sources);
}

/**
 * Enable or disable a source by name. Throws if not found.
 */
export function toggleSource(name: string, enabled: boolean): void {
  const sources = loadSources();
  const source = sources.find((s) => s.name === name);

  if (!source) {
    throw new Error(`Source "${name}" not found`);
  }

  source.enabled = enabled;
  writeSources(sources);
}

/**
 * Normalize a source object — ensure `enabled` defaults to `true`.
 */
function normalizeSource(s: Source): Source {
  return {
    ...s,
    enabled: s.enabled !== false, // default true
  };
}
