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
  fetchQualityStats,
  fetchTrendingData,
  type KPIData,
  type DailyStat,
  type SystemMetric,
  type RevenuePoint,
  type ServicesResponse,
  type PipelineStats,
  type ServiceHealth,
  type QualityStats,
  type TrendingResponse,
  type ClustersResponse,
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

// ─── Logs ─────────────────────────────────────────────────────────────

const LOG_POLL_INTERVAL = 5_000; // 5 seconds

function useLogs(filters: { service?: string; level?: string; search?: string; limit?: number; offset?: number }) {
  return useQuery<LogsResponse>({
    queryKey: ['admin', 'logs', filters],
    queryFn: () => fetchLogs(filters),
    refetchInterval: LOG_POLL_INTERVAL,
    staleTime: 2_000,
  });
}

// ─── Metrics ───────────────────────────────────────────────────────────

function useMetrics() {
  return useQuery<MetricsResponse | null>({
    queryKey: ['admin', 'metrics'],
    queryFn: fetchMetrics,
    refetchInterval: 30_000,
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

// ─── Quality Stats ──────────────────────────────────────────────────

const QUALITY_POLL_INTERVAL = 30_000; // 30 seconds

export function useQualityStats() {
  return useQuery<QualityStats | null>({
    queryKey: ['admin', 'quality-stats'],
    queryFn: fetchQualityStats,
    refetchInterval: QUALITY_POLL_INTERVAL,
    staleTime: 10_000,
  });
}

// ─── Trending Topics ─────────────────────────────────────────────────

export function useTrendingTopics() {
  return useQuery({
    queryKey: ['news', 'trending', 'clusters'],
    queryFn: fetchTrendingData,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
