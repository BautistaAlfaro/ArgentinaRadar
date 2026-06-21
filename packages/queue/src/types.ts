// ─── Queue names ───────────────────────────────────────────────────────────
export enum QueueName {
  Ingestion      = 'ingestion',
  Geolocation    = 'geolocation',
  AiProcessing   = 'ai-processing',
  EventDetection = 'event-detection',
  TwitterPublish = 'twitter-publish',
  TrendAnalysis  = 'trend-analysis',
}

// ─── Data payloads per job type ────────────────────────────────────────────
export interface FetchRssData {
  url: string;
  sourceId: string;
}

export interface ScrapeSourceData {
  sourceId: string;
  url: string;
}

export interface GeolocateArticleData {
  articleId: string;
  content: string;
}

export interface FilterArticleData {
  articleId: string;
  title: string;
  content: string;
}

export interface ExtractEntitiesData {
  articleId: string;
  content: string;
}

export interface GenerateEmbeddingData {
  articleId: string;
  content: string;
}

export interface DetectEventData {
  articleIds: string[];
}

export interface ScoreImpactData {
  eventId: string;
}

export interface SummarizeEventData {
  eventId: string;
  articleIds: string[];
}

export interface PublishEventData {
  eventId: string;
  summary: string;
}

export interface AnalyzeTrendsData {
  timeframe: '24h' | '7d' | '30d';
}

// ─── Job type unions per queue ─────────────────────────────────────────────
export type IngestionJobs =
  | { name: 'fetch-rss';       data: FetchRssData }
  | { name: 'scrape-source';   data: ScrapeSourceData };

export type GeolocationJobs =
  | { name: 'geolocate-article'; data: GeolocateArticleData };

export type AiProcessingJobs =
  | { name: 'filter-article';       data: FilterArticleData }
  | { name: 'extract-entities';     data: ExtractEntitiesData }
  | { name: 'generate-embedding';   data: GenerateEmbeddingData };

export type EventDetectionJobs =
  | { name: 'detect-event';    data: DetectEventData }
  | { name: 'score-impact';    data: ScoreImpactData }
  | { name: 'summarize-event'; data: SummarizeEventData };

export type TwitterPublishJobs =
  | { name: 'publish-event'; data: PublishEventData };

export type TrendAnalysisJobs =
  | { name: 'analyze-trends'; data: AnalyzeTrendsData };

// ─── Mapped queue → job union ──────────────────────────────────────────────
export interface QueueJobMap {
  [QueueName.Ingestion]:      IngestionJobs;
  [QueueName.Geolocation]:    GeolocationJobs;
  [QueueName.AiProcessing]:   AiProcessingJobs;
  [QueueName.EventDetection]: EventDetectionJobs;
  [QueueName.TwitterPublish]: TwitterPublishJobs;
  [QueueName.TrendAnalysis]:  TrendAnalysisJobs;
}

// ─── Worker / config types ─────────────────────────────────────────────────
export interface QueueConfig {
  concurrency: number;
  attempts: number;
  backoffDelay: number;
  backoffType?: 'fixed' | 'exponential';
}

export type QueueConfigMap = Record<QueueName, QueueConfig>;

// ─── Default remove policies ───────────────────────────────────────────────
export const JOB_REMOVE_POLICY = {
  removeOnComplete: { count: 100, age: 86_400 },       // 24 h
  removeOnFail:     { count: 50,  age: 604_800 },       // 7 d
} as const;
