/**
 * ControlCenter — 3-column dashboard layout replacing Telegram workflow.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ 🤖 ARGENTINA RADAR — Panel de Control                     [Stats]  │
 * ├───────────────┬─────────────────────────────────┬───────────────────┤
 * │ WORKFLOW      │ CONTENT PANEL                   │ MONITORING        │
 * │ (250px)       │ (flex-1)                        │ (300px)           │
 * │               │                                 │                   │
 * │ 🔵 Ingest    │   (changes by active phase)      │ 📜 Activity      │
 * │ 🟡 AI        │   - ArticleTable                 │ 📝 Logs          │
 * │ 🟢 Approve   │   - AIProcessPanel               │                   │
 * │ 🟣 Publish   │   - ApprovalPanel                │                   │
 * │               │   - PublishPanel                 │                   │
 * └───────────────┴─────────────────────────────────┴───────────────────┘
 */

import { useState, Suspense, lazy } from 'react';
import { LazyMotion, domAnimation } from 'framer-motion';
import { WorkflowSidebar, type WorkflowPhase } from '../components/workflow/WorkflowSidebar';
import { WorkflowContent } from '../components/workflow/WorkflowContent';
import { useDailyStats, usePipelineStats, useServiceHealth } from '../hooks/useAdminData';

const ActivityFeed = lazy(() => import('../components/admin/ActivityFeed').then(m => ({ default: m.ActivityFeed })));
const LogViewer = lazy(() => import('../components/admin/LogViewer').then(m => ({ default: m.LogViewer })));

function Skel({ h }: { h: string }) { return <div className={`bg-slate-700/20 rounded animate-pulse ${h}`} />; }
function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">{children}</p>;
}

export function ControlCenter() {
  const [activePhase, setActivePhase] = useState<WorkflowPhase>('ingest');

  const { data: pipelineStats, isLoading: pl } = usePipelineStats();
  const { data: serviceHealth, isLoading: hl } = useServiceHealth();
  const recent = pipelineStats?.recent ?? [];

  return (
    <LazyMotion features={domAnimation}>
      {/* Full viewport height — no external scroll */}
      <div className="flex flex-col pb-8" style={{ height: 'calc(100vh - 4rem)' }}>

        {/* ===== HEADER ===== */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700/30 shrink-0">
          <h1 className="text-sm font-bold text-white tracking-tight">🤖 ARGENTINA RADAR — Panel de Control</h1>
          <div className="flex items-center gap-4">
            <span className="text-[10px] text-slate-500 font-mono">
              {new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>

        {/* ===== BODY: 3 columns ===== */}
        <div className="flex flex-1 min-h-0">

          {/* ===== COL 1: Workflow Sidebar (250px) ===== */}
          <WorkflowSidebar activePhase={activePhase} onPhaseChange={setActivePhase} />

          {/* ===== COL 2: Content Panel (flex-1) ===== */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden border-r border-slate-700/30">
            <WorkflowContent activePhase={activePhase} />
          </div>

          {/* ===== COL 3: Monitoring Sidebar (300px) ===== */}
          <div className="w-[300px] shrink-0 flex flex-col p-4 gap-3 overflow-hidden">

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
