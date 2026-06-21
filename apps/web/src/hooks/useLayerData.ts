/**
 * useLayerData — Shared hook for polling data from the alerts API.
 *
 * Wraps TanStack Query's useQuery to eliminate ad-hoc fetch-in-useEffect
 * patterns across layer components. Handles cleanup, deduplication, and
 * interval refetching.
 */

import { useQuery } from '@tanstack/react-query';

export function useLayerData<T>(url: string, intervalMs: number) {
  return useQuery<T>({
    queryKey: ['layer', url],
    queryFn: async () => {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.json();
    },
    refetchInterval: intervalMs,
    staleTime: intervalMs * 0.75, // stale before refetch to avoid gap
    retry: 2,
  });
}
