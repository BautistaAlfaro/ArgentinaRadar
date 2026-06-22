/**
 * ControlCenter — Unified scrollable admin dashboard.
 *
 * Layout:
 *   Row 1: Service status pills (inline)
 *   Row 2: Pipeline (compact) + Approval Queue (compact table)
 *   Row 3: Charts (News + Events side by side)
 *   Row 4: Activity Feed (5 items)
 *   Row 5: Logs (last 5)
 *
 * All data fetches use real API calls via React Query hooks.
 * Mock generators have been removed — every section calls a real backend.
 */

import { lazy, Suspense } from 'react';
import { LazyMotion, domAnimation, m as motion } from 'framer-motion';
import { PipelineView } from '../components/admin/PipelineView';
import { ServiceCards } from '../components/admin/ServiceCards';
import { useDailyStats, usePipelineStats, useServiceHealth } from '../hooks/useAdminData';

// ── Lazy loaded components ──────────────────────────────────────────

const ApprovalQueue = lazy(() =>
  import('../components/admin/ApprovalQueue').then((m) => ({ default: m.ApprovalQueue })),
);
const NewsProcessingChart = lazy(() =>
  import('../components/admin/charts/NewsProcessingChart').then((m) => ({ default: m.NewsProcessingChart })),
);
const EventDetectionChart = lazy(() =>
  import('../components/admin/charts/EventDetectionChart').then((m) => ({ default: m.EventDetectionChart })),
);
const ActivityFeed = lazy(() =>
  import('../components/admin/ActivityFeed').then((m) => ({ default: m.ActivityFeed })),
);
const LogViewer = lazy(() =>
  import('../components/admin/LogViewer').then((m) => ({ default: m.LogViewer })),
);

// ── Helpers ──────────────────────────────────────────────────────────

function Skel({ h }: { h: string }) {
  return <div className={`bg-surface-container-high/40 rounded animate-pulse ${h}`} />;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold text-primary tracking-widest uppercase font-label-caps mb-2">
      {children}
    </p>
  );
}

// ── Main ─────────────────────────────────────────────────────────────

export function ControlCenter() {
  const { data: dailyStats, isLoading: statsLoading } = useDailyStats('7d');
  const { data: pipelineStats, isLoading: pipelineLoading } = usePipelineStats();
  const { data: serviceHealth, isLoading: healthLoading } = useServiceHealth();

  const dailyData = Array.isArray(dailyStats) ? dailyStats : [];
  const pipeData = pipelineStats?.pipeline ?? {};
  const recentActivity = pipelineStats?.recent ?? [];

  return (
    <LazyMotion features={domAnimation}>
      <div className="space-y-6 max-w-7xl mx-auto pb-8">

        {/* ── Row 1: Service status pills (inline) ───────────────── */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <ServiceCards services={serviceHealth ?? null} isLoading={healthLoading} />
        </motion.div>

        {/* ── Row 2: Pipeline + Approval Queue ────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
          >
            <SectionLabel>Pipeline</SectionLabel>
            <PipelineView
              pipeline={pipeData}
              approvalQueue={pipelineStats?.approvalQueue ?? {}}
              isLoading={pipelineLoading}
            />
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <SectionLabel>Aprobación</SectionLabel>
            <Suspense fallback={<Skel h="h-40" />}>
              <ApprovalQueue />
            </Suspense>
          </motion.div>
        </div>

        {/* ── Row 3: Charts (News + Events side by side) ─────── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="glass-panel rounded-xl p-4">
              <SectionLabel>News Processing</SectionLabel>
              <Suspense fallback={<Skel h="h-40" />}>
                <NewsProcessingChart data={dailyData} />
              </Suspense>
            </div>
            <div className="glass-panel rounded-xl p-4">
              <SectionLabel>Event Detection</SectionLabel>
              <Suspense fallback={<Skel h="h-40" />}>
                <EventDetectionChart data={dailyData} />
              </Suspense>
            </div>
          </div>
        </motion.div>

        {/* ── Row 4: Activity Feed (5 items) ──────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <SectionLabel>Actividad Reciente</SectionLabel>
          <Suspense fallback={<Skel h="h-40" />}>
            <ActivityFeed
              items={recentActivity.slice(0, 5)}
              isLoading={pipelineLoading}
            />
          </Suspense>
        </motion.div>

        {/* ── Row 5: Logs (last 5) ────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
        >
          <SectionLabel>System Logs</SectionLabel>
          <Suspense fallback={<Skel h="h-40" />}>
            <LogViewer limit={5} compact />
          </Suspense>
        </motion.div>

      </div>
    </LazyMotion>
  );
}
