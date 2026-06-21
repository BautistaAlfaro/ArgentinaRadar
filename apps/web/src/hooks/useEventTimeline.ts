/**
 * TanStack Query hook for fetching a single event's detail + articles.
 *
 * Fetches once on demand — no polling. Used by EventTimeline to show
 * the full article history behind a grouped event.
 */

import { useQuery } from '@tanstack/react-query';
import { fetchEvent } from '../services/api';
import type { EventDetail } from '../services/api';

interface UseEventTimelineResult {
  event: EventDetail | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

export function useEventTimeline(id: string | null): UseEventTimelineResult {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['event', id],
    queryFn: () => fetchEvent(id!),
    enabled: id !== null && id !== '',
    staleTime: Infinity,
    retry: 2,
    retryDelay: 3000,
  });

  return {
    event: data,
    isLoading,
    isError,
    error: error as Error | null,
  };
}
