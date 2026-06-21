/**
 * TanStack Query hook for political figure trends with polling.
 *
 * Fetches political figures with sentiment, mention counts, and growth
 * rates from the trend-analyzer service on port 3009. Auto-refetches
 * every 60 seconds.
 */

import { useQuery } from '@tanstack/react-query';
import { fetchPoliticalTrends } from '../services/api';
import type { PoliticalFigureTrend } from '../services/api';

interface UsePoliticalTrendsResult {
  figures: PoliticalFigureTrend[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

export function usePoliticalTrends(): UsePoliticalTrendsResult {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['political-trends'],
    queryFn: fetchPoliticalTrends,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 3,
    retryDelay: 5000,
  });

  return {
    figures: data ?? [],
    isLoading,
    isError,
    error: error as Error | null,
    refetch,
  };
}
