/**
 * TanStack Query hook for news data with polling.
 *
 * Fetches geolocated news articles with optional category and province filters.
 * Auto-refetches every 30 seconds.
 */

import { useQuery } from '@tanstack/react-query';
import { fetchGeolocatedNews } from '../services/api';
import { useRadarStore } from '../stores/radarStore';
import type { NewsItem } from '@shared/types';

interface UseNewsOptions {
  category?: string;
  province?: string;
  limit?: number;
  refetchInterval?: number;
}

interface UseNewsResult {
  articles: NewsItem[];
  total: number;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Hook for fetching geolocated news with category/province filters.
 * Default refetch interval: 30 seconds.
 * Auto-filters by selectedProvince from the radar store unless explicitly overridden.
 */
export function useNews(options: UseNewsOptions = {}): UseNewsResult {
  const selectedProvince = useRadarStore((s) => s.selectedProvince);

  const {
    category,
    province,
    limit = 100,
    refetchInterval = 30000, // 30 seconds
  } = options;

  const effectiveProvince = province ?? selectedProvince ?? undefined;

  const queryKey = ['news', 'geolocated', category, effectiveProvince, limit];

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: () => fetchGeolocatedNews({ category, province: effectiveProvince, limit }),
    refetchInterval,
    staleTime: 10000,
    retry: 3,
    retryDelay: 5000,
  });

  return {
    articles: data?.items ?? [],
    total: data?.total ?? 0,
    isLoading,
    isError,
    error: error as Error | null,
    refetch,
  };
}
