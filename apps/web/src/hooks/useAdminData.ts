/**
 * React Query hooks for admin dashboard data.
 *
 * Each hook fetches from the admin backend (port 3012) with mock
 * fallback and 30‑second polling for live updates.
 */

import { useQuery } from '@tanstack/react-query';
import {
  fetchKPIs,
  fetchDailyStats,
  fetchSystemMetrics,
  fetchRevenueData,
  fetchServices,
  fetchPipelineStats,
  fetchServiceHealth,
  type KPIData,
  type DailyStat,
  type SystemMetric,
  type RevenuePoint,
  type ServicesResponse,
  type PipelineStats,
  type ServiceHealth,
} from '../services/adminApi';

const POLL_INTERVAL = 30_000; // 30 seconds
const SERVICE_POLL_INTERVAL = 5_000; // 5 seconds for service status

// ─── KPIs ────────────────────────────────────────────────────────────

export function useKPIs(range: string) {
  return useQuery<KPIData>({
    queryKey: ['admin', 'kpis', range],
    queryFn: () => fetchKPIs(range),
    refetchInterval: POLL_INTERVAL,
    staleTime: 10_000,
  });
}

// ─── Daily Stats ─────────────────────────────────────────────────────

export function useDailyStats(range: string) {
  return useQuery<DailyStat[]>({
    queryKey: ['admin', 'daily-stats', range],
    queryFn: () => fetchDailyStats(range),
    refetchInterval: POLL_INTERVAL,
    staleTime: 10_000,
  });
}

// ─── System Metrics ──────────────────────────────────────────────────

export function useSystemMetrics(service?: string, range?: string) {
  return useQuery<SystemMetric[]>({
    queryKey: ['admin', 'system-metrics', service, range],
    queryFn: () => fetchSystemMetrics(service, range),
    refetchInterval: POLL_INTERVAL,
    staleTime: 10_000,
  });
}

// ─── Revenue ─────────────────────────────────────────────────────────

export function useRevenue() {
  return useQuery<RevenuePoint[]>({
    queryKey: ['admin', 'revenue'],
    queryFn: fetchRevenueData,
    refetchInterval: POLL_INTERVAL,
    staleTime: 10_000,
  });
}

// ─── Services ─────────────────────────────────────────────────────────

export function useServices() {
  return useQuery<ServicesResponse>({
    queryKey: ['admin', 'services'],
    queryFn: fetchServices,
    refetchInterval: SERVICE_POLL_INTERVAL,
    staleTime: 2_000,
  });
}

// ─── Pipeline Stats ───────────────────────────────────────────────────

export function usePipelineStats() {
  return useQuery<PipelineStats | null>({
    queryKey: ['admin', 'pipeline-stats'],
    queryFn: fetchPipelineStats,
    refetchInterval: POLL_INTERVAL,
    staleTime: 10_000,
  });
}

// ─── Service Health (port checks) ────────────────────────────────────

export function useServiceHealth() {
  return useQuery<ServiceHealth[]>({
    queryKey: ['admin', 'service-health'],
    queryFn: fetchServiceHealth,
    refetchInterval: SERVICE_POLL_INTERVAL,
    staleTime: 5_000,
  });
}
