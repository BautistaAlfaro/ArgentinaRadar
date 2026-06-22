/**
 * ControlCenter — Grid asimétrico 3 columnas (70% + 30%).
 * Diseñado para 24" 1920x1080 sin scroll externo.
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
function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">{children}</p>;
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
      {/* Full viewport height — no external scroll */}
      <div className="flex flex-col" style={{ height: 'calc(100vh - 6rem)' }}>

        {/* ===== HEADER ===== */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700/30 shrink-0">
          <h1 className="text-sm font-bold text-white tracking-tight">🤖 ARGENTINA RADAR — Panel de Control</h1>
          <span className="text-[10px] text-slate-500 font-mono">
            {new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        {/* ===== BODY: Grid 70/30 ===== */}
        <div className="grid grid-cols-[1fr_360px] gap-0 flex-1 min-h-0">

          {/* ========== LEFT: Core Operativo (70%) ========== */}
          <div className="flex flex-col p-4 gap-3 overflow-hidden border-r border-slate-700/30">

            {/* Row 1: ServiceCards — horizontal flex */}
            <div className="shrink-0">
              <ServiceCards services={serviceHealth ?? null} isLoading={hl} />
            </div>

            {/* Row 2: PipelineView — full width */}
            <div className="shrink-0 text-[10px]">
              <PipelineView pipeline={pipeData} approvalQueue={pipelineStats?.approvalQueue ?? {}} isLoading={pl} />
            </div>

            {/* Row 3: ApprovalQueue — interactive table, takes remaining space */}
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              <Label>📋 Cola de Aprobación</Label>
              <div className="flex-1 min-h-0 overflow-y-auto">
                <Suspense fallback={<Skel h="h-full" />}>
                  <ApprovalQueue />
                </Suspense>
              </div>
            </div>

            {/* Row 4: Charts — 2 columns */}
            <div className="shrink-0 grid grid-cols-2 gap-3" style={{ height: '180px' }}>
              <div className="flex flex-col">
                <Label>📊 News Processing</Label>
                <div className="flex-1 min-h-0">
                  <Suspense fallback={<Skel h="h-full" />}>
                    <NewsProcessingChart data={dailyData} />
                  </Suspense>
                </div>
              </div>
              <div className="flex flex-col">
                <Label>📈 Event Detection</Label>
                <div className="flex-1 min-h-0">
                  <Suspense fallback={<Skel h="h-full" />}>
                    <EventDetectionChart data={dailyData} />
                  </Suspense>
                </div>
              </div>
            </div>

          </div>

          {/* ========== RIGHT: Sidebar de Monitoreo (30% / 360px) ========== */}
          <div className="flex flex-col p-4 gap-3 overflow-hidden">

            {/* ActivityFeed — top half */}
            <div className="flex-1 min-h-0 flex flex-col">
              <Label>📜 Actividad Reciente</Label>
              <div className="flex-1 min-h-0 overflow-y-auto text-[10px]">
                <Suspense fallback={<Skel h="h-32" />}>
                  <ActivityFeed items={recent.slice(0, 5)} isLoading={pl} />
                </Suspense>
              </div>
            </div>

            {/* LogViewer — bottom half */}
            <div className="flex-1 min-h-0 flex flex-col">
              <Label>📝 System Logs</Label>
              <div className="flex-1 min-h-0 overflow-y-auto font-mono">
                <Suspense fallback={<Skel h="h-32" />}>
                  <LogViewer limit={5} compact />
                </Suspense>
              </div>
            </div>

          </div>
        </div>
      </div>
    </LazyMotion>
  );
}
