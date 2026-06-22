/**
 * WorkflowContent — Center column content area.
 *
 * Renders different panels based on the active workflow phase:
 *   ingest  → ArticleTable
 *   ai      → AIProcessPanel
 *   approve → ApprovalPanel
 *   publish → PublishPanel
 */

import type { WorkflowPhase } from './WorkflowSidebar';
import { ArticleTable } from './ArticleTable';
import { AIProcessPanel } from './AIProcessPanel';
import { ApprovalPanel } from './ApprovalPanel';
import { PublishPanel } from './PublishPanel';

interface WorkflowContentProps {
  activePhase: WorkflowPhase;
}

const PHASE_LABELS: Record<WorkflowPhase, { title: string; icon: string; description: string }> = {
  ingest: {
    title: '📥 Ingestion',
    icon: 'cloud_download',
    description: 'Artículos ingeridos desde fuentes RSS — revisar, filtrar y buscar',
  },
  ai: {
    title: '🧠 AI Processing',
    icon: 'psychology',
    description: 'Configuración del AI, threshold, modelo y reprocesamiento',
  },
  approve: {
    title: '✅ Approval',
    icon: 'fact_check',
    description: 'Revisar y aprobar artículos para publicar en Bluesky',
  },
  publish: {
    title: '🚀 Publication',
    icon: 'publish',
    description: 'Artículos publicados, programados y publicación manual',
  },
};

export function WorkflowContent({ activePhase }: WorkflowContentProps) {
  const meta = PHASE_LABELS[activePhase];

  return (
    <div className="flex-1 flex flex-col min-h-0 p-4 gap-4 overflow-hidden">
      {/* ── Phase header ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 shrink-0">
        <span className="material-symbols-outlined text-2xl text-primary" aria-hidden="true">{meta.icon}</span>
        <div>
          <h2 className="text-base font-bold text-white tracking-tight">{meta.title}</h2>
          <p className="text-[11px] text-slate-500">{meta.description}</p>
        </div>
      </div>

      {/* ── Phase content ─────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activePhase === 'ingest' && <ArticleTable />}
        {activePhase === 'ai' && <AIProcessPanel />}
        {activePhase === 'approve' && <ApprovalPanel />}
        {activePhase === 'publish' && <PublishPanel />}
      </div>
    </div>
  );
}
