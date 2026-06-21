/**
 * TanStack Query hook for economic data with polling.
 *
 * Polls the economic-data service (port 3006) every 60 seconds.
 */

import { useQuery } from '@tanstack/react-query';
import { fetchEconomicData } from '../services/api';
import type { EconomicIndicator } from '@shared/types';

export interface EnrichedIndicator extends EconomicIndicator {
  previousValue: number | null;
  partial: boolean;
  metadata: Record<string, unknown> | null;
  fetchStatus: {
    lastRun: string | null;
    lastSuccess: string | null;
    status: 'ok' | 'error';
    error: string | null;
  } | null;
}

interface EconomicDataResponse {
  indicators: EnrichedIndicator[];
  staleStatus: Array<{ type: string; stale: boolean; failures: number }>;
  serverTime: string;
}

/**
 * Fetch enriched economic indicators from the economic-data service.
 */
async function fetchEnrichedData(): Promise<EconomicDataResponse> {
  const ECON_API = 'http://localhost:3006';
  const resp = await fetch(`${ECON_API}/api/economic`);
  if (!resp.ok) {
    throw new Error(`Failed to fetch economic data: ${resp.status}`);
  }
  return resp.json();
}

/**
 * React Query hook for economic indicators with 60s polling.
 *
 * Returns inline indicators (derived from the raw API response) plus
 * the raw response for custom use.
 */
export function useEconomicData() {
  const {
    data,
    isLoading,
    isError,
    error,
    isFetching,
    refetch,
  } = useQuery<EconomicDataResponse>({
    queryKey: ['economic-data'],
    queryFn: fetchEnrichedData,
    refetchInterval: 60_000, // 60 seconds
    staleTime: 30_000,       // Consider stale after 30s
    retry: 2,
    retryDelay: 5_000,
  });

  // Derive simple lookup maps for convenient access
  const indicators = data?.indicators ?? [];

  const byType = indicators.reduce<Record<string, EnrichedIndicator>>((acc, ind) => {
    acc[ind.type] = ind;
    return acc;
  }, {});

  const dolarBlue = byType['dolar_blue'] ?? null;
  const merval = byType['merval'] ?? null;
  const riesgoPais = byType['riesgo_pais'] ?? null;
  const reservasBcra = byType['reservas_bcra'] ?? null;

  const staleStatus = data?.staleStatus ?? [];

  return {
    /** All indicators from the API */
    indicators,
    /** Lookup by type key */
    byType,
    /** Convenience accessors */
    dolarBlue,
    merval,
    riesgoPais,
    reservasBcra,
    /** Whether any indicator is stale */
    hasStaleData: staleStatus.some((s) => s.stale),
    staleStatus,
    /** Raw query state */
    isLoading,
    isError,
    error,
    isFetching,
    /** Refetch manually */
    refetch,
    /** Timestamp of last successful fetch */
    serverTime: data?.serverTime ?? null,
  };
}
