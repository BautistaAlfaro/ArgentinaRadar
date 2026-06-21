import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCES_PATH =
  process.env.SOURCES_PATH ??
  path.resolve(__dirname, '..', '..', '..', 'data', 'sources.json');

export type SourceType = 'rss' | 'scrape';
export type SourceCategory = 'politica' | 'economia' | 'sociedad' | 'deportes';

export interface CssSelectors {
  article: string;
  title: string;
  summary: string;
  link: string;
  timestamp: string;
}

export interface Source {
  name: string;
  type: SourceType;
  url: string;
  category: SourceCategory;
  rateLimitMs: number;
  cssSelectors?: CssSelectors;
}

export interface SourcesConfig {
  sources: Source[];
}

// ─── AI Processor ──────────────────────────────────────────────────
export const AI_PROCESSOR_URL: string =
  process.env.AI_PROCESSOR_URL ?? 'http://localhost:3010';

// ─── Redis / BullMQ ────────────────────────────────────────────────
export const REDIS_HOST: string = process.env.REDIS_HOST ?? 'localhost';
export const REDIS_PORT: number = parseInt(process.env.REDIS_PORT ?? '6379', 10);

/** Load and validate sources from the JSON config file. */
export function loadSources(): Source[] {
  const raw = fs.readFileSync(SOURCES_PATH, 'utf-8');
  const config: SourcesConfig = JSON.parse(raw);

  if (!Array.isArray(config.sources) || config.sources.length === 0) {
    throw new Error(`No sources found in ${SOURCES_PATH}`);
  }

  for (const s of config.sources) {
    if (!s.name || !s.type || !s.url) {
      throw new Error(`Invalid source entry: ${JSON.stringify(s)}`);
    }
    if (s.type === 'scrape' && !s.cssSelectors) {
      throw new Error(`Scrape source "${s.name}" is missing cssSelectors`);
    }
  }

  return config.sources;
}

/** Get only RSS-type sources. */
export function getRssSources(sources?: Source[]): Source[] {
  return (sources ?? loadSources()).filter((s) => s.type === 'rss');
}

/** Get only scrape-type sources. */
export function getScrapeSources(sources?: Source[]): Source[] {
  return (sources ?? loadSources()).filter((s) => s.type === 'scrape');
}
