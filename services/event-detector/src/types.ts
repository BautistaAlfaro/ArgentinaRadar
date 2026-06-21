/** Shared types for the Event Detector service. */

export interface Entity {
  name: string;
  type: 'person' | 'place' | 'organization';
  tier: number;
}

export interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  category: string;
  publishedAt: string;
  ingestedAt: string;
  embedding: number[];
  entities: Entity[];
}

export interface TimelineEntry {
  articleId: string;
  title: string;
  source: string;
  publishedAt: string;
}

export type MediaConsensus = 'high' | 'medium' | 'low';
export type MatchType = 'auto' | 'gpt_verified' | 'new';

export interface Event {
  id: string;
  title: string;
  summary: string;
  category: string;
  sources: string[];
  articleCount: number;
  firstSeen: string;
  lastSeen: string;
  confidence: number;
  impact: number;
  consensus: MediaConsensus;
  entities: Entity[];
  articles: NewsArticle[];
  timeline: TimelineEntry[];
  createdAt: string;
}

export interface DetectPayload {
  title: string;
  summary: string;
  source: string;
  url: string;
  category?: string;
  publishedAt: string;
  embedding?: number[];
}

export interface DetectResult {
  eventId: string;
  matchType: MatchType;
  confidence: number;
  event: Event;
}
