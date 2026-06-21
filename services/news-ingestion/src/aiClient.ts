/**
 * aiClient — HTTP client for the ai-processor service
 *
 * Calls POST /api/process for embedding + NER enrichment.
 * Designed for graceful degradation: if the service is down the
 * caller gets null and should proceed without AI data.
 */

import axios from 'axios';
import { AI_PROCESSOR_URL } from './config.js';

// ─── Types ─────────────────────────────────────────────────────────

export interface AiEntity {
  name: string;
  type: string;
  tier: string;
}

export interface AiProcessorResult {
  entities: AiEntity[];
  category: string;
  embedding: number[];
  tokens_used: number;
  cost: number;
}

// ─── Client ────────────────────────────────────────────────────────

/**
 * Enrich an article via the ai-processor service.
 *
 * Returns `null` when the service is unreachable or returns a
 * non-2xx response — ingestion continues without AI enrichment.
 *
 * @param title   — article title
 * @param summary — article summary / body snippet
 * @param source  — source name (for provenance)
 */
export async function callAiProcessor(
  title: string,
  summary: string,
  source: string,
): Promise<AiProcessorResult | null> {
  try {
    const response = await axios.post<AiProcessorResult>(
      `${AI_PROCESSOR_URL}/api/process`,
      { title, summary, source },
      { timeout: 30_000 },
    );
    return response.data;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[aiClient] AI processor unavailable — continuing without AI data: ${message}`);
    return null;
  }
}
