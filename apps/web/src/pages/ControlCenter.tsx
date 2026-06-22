/**
 * ControlCenter — Compact unified dashboard.
 * Everything fits in ~50vh — no scroll needed on 1080p.
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

function Skel({ h }: { h: string }) {
  return <div className={`bg-slate-700/20 rounded animate-pulse ${h}`} />;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[9px] font-bold text-primary tracking-wider uppercase mb-1">{children}</p>;
}

export function ControlCenter() {
  const { data: dailyStats } = useDailyStats('7d');
  const { data: pipelineStats, isLoading: pl } = usePipelineStats();
  const { data: serviceHealth, isLoading: hl } = useServiceHealth();
  const dailyData = Array.isArray(dailyStats) ? dailyStats : [];
  const pipeData = pipelineStats?.pipeline ?? {};
  const recent = pipelineStats?.recent ?? [];

  return (
    <LazyMotion features={domAnimation}>
      <div className="space-y-1.5 text-[11px]" style={{ height: '50vh', overflow: 'hidden' }}>

        {/* Row 1: Services (1 line pills) + Pipeline (inline) */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="shrink-0"><ServiceCards services={serviceHealth ?? null} isLoading={hl} /></div>
          <div className="text-[10px] shrink-0">
            <PipelineView pipeline={pipeData} approvalQueue={pipelineStats?.approvalQueue ?? {}} isLoading={pl} />
          </div>
        </div>

        {/* Row 2: Approval Queue (interactive — takes most space) */}
        <div className="flex-1 min-h-0" style={{ height: 'calc(50vh - 120px)' }}>
          <Suspense fallback={<Skel h="h-full" />}>
            <ApprovalQueue />
          </Suspense>
        </div>

        {/* Row 3: Charts + Activity + Logs — compact footer row */}
        <div className="grid grid-cols-4 gap-2 shrink-0">
          <div>
            <SectionLabel>News</SectionLabel>
            <Suspense fallback={<Skel h="h-20" />}>
              <NewsProcessingChart data={dailyData} />
            </Suspense>
          </div>
          <div>
            <SectionLabel>Events</SectionLabel>
            <Suspense fallback={<Skel h="h-20" />}>
              <EventDetectionChart data={dailyData} />
            </Suspense>
          </div>
          <div>
            <SectionLabel>Activity</SectionLabel>
            <div className="text-[9px]">
              <Suspense fallback={<Skel h="h-20" />}>
                <ActivityFeed items={recent.slice(0, 3)} isLoading={pl} />
              </Suspense>
            </div>
          </div>
          <div>
            <SectionLabel>Logs</SectionLabel>
            <div className="text-[9px]">
              <Suspense fallback={<Skel h="h-20" />}>
                <LogViewer limit={3} compact />
              </Suspense>
            </div>
          </div>
        </div>

      </div>
    </LazyMotion>
  );
}
