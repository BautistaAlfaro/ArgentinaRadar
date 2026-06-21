/**
 * TanStack Query hook for event data with polling.
 *
 * Fetches grouped events from the event-detector service with optional
 * filters for minimum impact score, consensus level, and province.
 * Auto-refetches every 30 seconds.
 */

import { useQuery } from '@tanstack/react-query';
import { fetchEvents } from '../services/api';
import { useRadarStore } from '../stores/radarStore';
import type { ConsensusLevel, EventItem } from '../services/api';

interface UseEventsOptions {
  impactMin?: number;
  consensus?: ConsensusLevel;
  province?: string;
  limit?: number;
  refetchInterval?: number;
  /** If true, only return events that have valid lat/lng coordinates. */
  withLocation?: boolean;
}

interface UseEventsResult {
  events: EventItem[];
  total: number;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useEvents(options: UseEventsOptions = {}): UseEventsResult {
  const selectedProvince = useRadarStore((s) => s.selectedProvince);

  const {
    impactMin,
    consensus,
    province,
    limit = 100,
    refetchInterval = 30000,
    withLocation = false,
  } = options;

  // Auto-filter by selected province from store unless explicitly overridden
  const effectiveProvince = province ?? selectedProvince ?? undefined;

  const queryKey = ['events', impactMin, consensus, effectiveProvince, limit];

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: () =>
      fetchEvents({
        impact_min: impactMin,
        consensus,
        province: effectiveProvince,
        limit,
      }),
    refetchInterval,
    staleTime: 10000,
    retry: 3,
    retryDelay: 5000,
  });

  const items = data?.items ?? [];
  const filtered = withLocation
    ? items.filter((e) => e.location?.lat != null && e.location?.lng != null)
    : items;

  return {
    events: filtered,
    total: data?.total ?? 0,
    isLoading,
    isError,
    error: error as Error | null,
    refetch,
  };
}
