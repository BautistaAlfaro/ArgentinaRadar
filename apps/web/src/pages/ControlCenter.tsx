/**
 * ControlCenter — Compact dashboard. Fits 1080p without scroll.
 * Priority: Approval Queue (interactive) > Pipeline > Charts > Activity > Logs > Services
 */
import { lazy, Suspense } from 'react';
import { LazyMotion, domAnimation } from 'framer-motion';
import { PipelineView } from '../components/admin/PipelineView';
import { ServiceCards } from '../components/admin/ServiceCards';
import { useDailyStats, usePipelineStats, useServiceHealth } from '../hooks/useAdminData';

const ApprovalQueue = lazy(() => import('../components/admin/ApprovalQueue').then(m => ({ default: m.ApprovalQueue })));
const NewsProcessingChart = lazy(() => import('../components/admin/charts/NewsProcessingChart').then(m => ({ default: m.NewsProcessingChart })));
const EventDetectionChart = lazy(() => import('../components/admin/charts/EventDetectionChart').then(m => ({ default: m.EventDetectionChart })));
const ActivityFeed = lazy(() => import('../components/admin/ActivityFeed').then(m => ({ default: m.ActivityFeed })));
const LogViewer = lazy(() => import('../components/admin/LogViewer').then(m => ({ default: m.LogViewer })));

function Skel({ h }: { h: string }) { return <div className={`bg-slate-700/20 rounded animate-pulse ${h}`} />; }

export function ControlCenter() {
  const { data: dailyStats } = useDailyStats('7d');
  const { data: pipelineStats, isLoading: pl } = usePipelineStats();
  const { data: serviceHealth, isLoading: hl } = useServiceHealth();
  const dailyData = Array.isArray(dailyStats) ? dailyStats : [];
  const pipeData = pipelineStats?.pipeline ?? {};
  const recent = pipelineStats?.recent ?? [];

  return (
    <LazyMotion features={domAnimation}>
      <div className="space-y-2 text-[11px] max-w-full">

        {/* Row 1: Services (inline pills) */}
        <div className="text-[10px]">
          <ServiceCards services={serviceHealth ?? null} isLoading={hl} />
        </div>

        {/* Row 2: Pipeline (1 line) */}
        <div className="text-[10px]">
          <PipelineView pipeline={pipeData} approvalQueue={pipelineStats?.approvalQueue ?? {}} isLoading={pl} />
        </div>

        {/* Row 3: Approval Queue — main interactive area */}
        <div className="min-h-[300px]">
          <Suspense fallback={<Skel h="h-80" />}>
            <ApprovalQueue />
          </Suspense>
        </div>

        {/* Row 4: Charts + Activity — side by side */}
        <div className="grid grid-cols-3 gap-3">
          <Suspense fallback={<Skel h="h-32" />}>
            <NewsProcessingChart data={dailyData} />
          </Suspense>
          <Suspense fallback={<Skel h="h-32" />}>
            <EventDetectionChart data={dailyData} />
          </Suspense>
          <div className="text-[10px] overflow-hidden">
            <Suspense fallback={<Skel h="h-32" />}>
              <ActivityFeed items={recent.slice(0, 5)} isLoading={pl} />
            </Suspense>
          </div>
        </div>

        {/* Row 5: Logs — compact */}
        <div className="text-[10px]">
          <Suspense fallback={<Skel h="h-20" />}>
            <LogViewer limit={5} compact />
          </Suspense>
        </div>

      </div>
    </LazyMotion>
  );
}
