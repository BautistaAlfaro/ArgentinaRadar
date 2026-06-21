/**
 * TanStack Query hook for trending entities with polling.
 *
 * Fetches top trending personas, places, and organizations from the
 * trends service on port 3009. Auto-refetches every 60 seconds.
 * Supports optional province filtering (client-side).
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchTrends } from '../services/api';
import { useRadarStore } from '../stores/radarStore';
import type { TrendingEntity } from '../services/api';

interface UseTrendsOptions {
  province?: string;
}

interface UseTrendsResult {
  trends: TrendingEntity[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useTrends(options: UseTrendsOptions = {}): UseTrendsResult {
  const selectedProvince = useRadarStore((s) => s.selectedProvince);

  const {
    province = selectedProvince ?? undefined,
  } = options;

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['trends'],
    queryFn: fetchTrends,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 3,
    retryDelay: 5000,
  });

  // Client-side filter by province if specified
  const trends = useMemo(() => {
    const all = data ?? [];
    if (!province) return all;

    const provinceLower = province.toLowerCase();
    return all.filter((entity) => {
      // Match entity name directly (e.g., "Santa Fe" trend for "Santa Fe" province)
      if (entity.name.toLowerCase() === provinceLower) return true;
      // Match entity name containing province name
      if (entity.name.toLowerCase().includes(provinceLower)) return true;
      // Include if type is 'lugar' and name partially matches
      if (entity.type === 'lugar' && provinceLower.includes(entity.name.toLowerCase())) return true;
      return false;
    });
  }, [data, province]);

  return {
    trends,
    isLoading,
    isError,
    error: error as Error | null,
    refetch,
  };
}
