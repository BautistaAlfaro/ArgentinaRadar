/**
 * TanStack Query hook for trending entities with polling.
 *
 * Fetches top trending personas, places, and organizations from the
 * trends service on port 3009. Auto-refetches every 60 seconds.
 */

import { useQuery } from '@tanstack/react-query';
import { fetchTrends } from '../services/api';
import type { TrendingEntity } from '../services/api';

interface UseTrendsResult {
  trends: TrendingEntity[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useTrends(): UseTrendsResult {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['trends'],
    queryFn: fetchTrends,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 3,
    retryDelay: 5000,
  });

  return {
    trends: data ?? [],
    isLoading,
    isError,
    error: error as Error | null,
    refetch,
  };
}
