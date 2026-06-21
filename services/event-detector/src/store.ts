/**
 * In-memory Event Store.
 *
 * Graceful degradation: all state lives in Maps. PostgreSQL (and pgvector)
 * integration will replace this once the database package is wired in.
 *
 * Store structure:
 *   events         Map<eventId, Event>
 *   articleToEvent Map<articleId, eventId>   — reverse lookup for matching
 */

import crypto from 'node:crypto';
import type { Event, NewsArticle, TimelineEntry, MediaConsensus } from './types.js';
import { calculateConsensus } from './consensus.js';
import { calculateImpact } from './scoring.js';

class EventStore {
  private events = new Map<string, Event>();
  private articleToEvent = new Map<string, string>();

  /** Create a new event from the first article. */
  createEvent(article: NewsArticle): Event {
    const now = new Date().toISOString();
    const event: Event = {
      id: crypto.randomUUID(),
      title: article.title,
      summary: article.summary,
      category: article.category,
      sources: [article.source],
      articleCount: 1,
      firstSeen: article.publishedAt,
      lastSeen: article.publishedAt,
      confidence: 1.0,
      impact: 0,
      consensus: 'low' as MediaConsensus,
      entities: [...(article.entities || [])],
      articles: [article],
      timeline: [this.makeTimelineEntry(article)],
      createdAt: now,
    };

    event.consensus = calculateConsensus(event);
    event.impact = calculateImpact(event);

    this.events.set(event.id, event);
    this.articleToEvent.set(article.id, event.id);
    return event;
  }

  /** Add a related article to an existing event and recalculate scores. */
  addArticleToEvent(eventId: string, article: NewsArticle): void {
    const event = this.events.get(eventId);
    if (!event) throw new Error(`Event ${eventId} not found`);

    // Unique sources
    if (!event.sources.includes(article.source)) {
      event.sources.push(article.source);
    }

    event.articles.push(article);
    event.articleCount = event.articles.length;
    event.lastSeen = article.publishedAt > event.lastSeen
      ? article.publishedAt
      : event.lastSeen;

    // Timeline
    event.timeline.push(this.makeTimelineEntry(article));
    event.timeline.sort(
      (a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime(),
    );

    // Merge new entities
    const knownNames = new Set(event.entities.map((e) => e.name.toLowerCase()));
    for (const entity of article.entities || []) {
      if (!knownNames.has(entity.name.toLowerCase())) {
        event.entities.push(entity);
        knownNames.add(entity.name.toLowerCase());
      }
    }

    // Recalculate scores
    event.consensus = calculateConsensus(event);
    event.impact = calculateImpact(event);

    this.articleToEvent.set(article.id, eventId);
  }

  /** Look up an event by ID. */
  getEvent(eventId: string): Event | undefined {
    return this.events.get(eventId);
  }

  /** Find the event that an article belongs to. */
  getEventByArticleId(articleId: string): Event | undefined {
    const eventId = this.articleToEvent.get(articleId);
    return eventId ? this.events.get(eventId) : undefined;
  }

  /** All articles ingested within the last `hours` hours. */
  getRecentArticles(hours: number): NewsArticle[] {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const articles: NewsArticle[] = [];
    for (const event of this.events.values()) {
      for (const article of event.articles) {
        if (new Date(article.ingestedAt).getTime() >= cutoff) {
          articles.push(article);
        }
      }
    }
    return articles;
  }

  /** Events created within the last `hours` hours. */
  getRecentEvents(hours: number): Event[] {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    return Array.from(this.events.values()).filter(
      (e) => new Date(e.createdAt).getTime() >= cutoff,
    );
  }

  /** Top N events sorted by impact score descending. */
  getTrendingEvents(limit: number): Event[] {
    return Array.from(this.events.values())
      .sort((a, b) => b.impact - a.impact)
      .slice(0, limit);
  }

  /** Every event in the store (used for listing / filtering). */
  getAllEvents(): Event[] {
    return Array.from(this.events.values());
  }

  // ── Private helpers ──────────────────────────────────────────────

  private makeTimelineEntry(article: NewsArticle): TimelineEntry {
    return {
      articleId: article.id,
      title: article.title,
      source: article.source,
      publishedAt: article.publishedAt,
    };
  }
}

/** Singleton store instance — shared across the service. */
export const store = new EventStore();
