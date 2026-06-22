/**
 * PipelineView — Compact pipeline status bar.
 */
interface PipelineViewProps {
  pipeline: Record<string, number> | null;
  approvalQueue: Record<string, number> | null;
  isLoading: boolean;
}

interface StageDef {
  key: string;
  label: string;
  color: 'emerald' | 'amber' | 'blue' | 'violet' | 'slate';
  icon: string;
  /** Compute count from the pipeline/approvalQueue data */
  getCount: (pipeline: Record<string, number>, approvalQueue: Record<string, number>) => number;
}

const STAGES: StageDef[] = [
  {
    key: 'ingested',
    label: 'Ingested',
    color: 'emerald',
    icon: 'download',
    getCount: (p) => (p.ingested ?? 0) + (p.geolocated ?? 0),
  },
  {
    key: 'geolocated',
    label: 'Geolocated',
    color: 'amber',
    icon: 'location_on',
    getCount: (p) => p.geolocated ?? 0,
  },
  {
    key: 'filtered',
    label: 'AI Processing',
    color: 'blue',
    icon: 'psychology',
    getCount: (p) => p.filtered ?? 0,
  },
  {
    key: 'pending_approval',
    label: 'Pending Approval',
    color: 'violet',
    icon: 'pending_actions',
    getCount: (p, aq) => (p.pending_approval ?? 0) + (aq.pending ?? 0),
  },
  {
    key: 'published',
    label: 'Published',
    color: 'emerald',
    icon: 'check_circle',
    getCount: (p) => p.published ?? 0,
  },
];

const COLOR_MAP = {
  emerald: {
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    text: 'text-emerald-400',
    badge: 'bg-emerald-500/20 text-emerald-300',
    glow: 'shadow-emerald-500/5',
  },
  amber: {
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    text: 'text-amber-400',
    badge: 'bg-amber-500/20 text-amber-300',
    glow: 'shadow-amber-500/5',
  },
  blue: {
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    text: 'text-blue-400',
    badge: 'bg-blue-500/20 text-blue-300',
    glow: 'shadow-blue-500/5',
  },
  violet: {
    bg: 'bg-violet-500/10',
    border: 'border-violet-500/30',
    text: 'text-violet-400',
    badge: 'bg-violet-500/20 text-violet-300',
    glow: 'shadow-violet-500/5',
  },
  slate: {
    bg: 'bg-slate-500/10',
    border: 'border-slate-500/30',
    text: 'text-slate-400',
    badge: 'bg-slate-500/20 text-slate-300',
    glow: 'shadow-slate-500/5',
  },
};

export function PipelineView({ pipeline, approvalQueue, isLoading }: PipelineViewProps) {
  const emptyPipeline: Record<string, number> = pipeline ?? {};
  const emptyAq: Record<string, number> = approvalQueue ?? {};
  const totalArticles = Object.values(emptyPipeline).reduce((a, b) => a + b, 0);

  if (isLoading) {
    return <div className="flex gap-2 items-center text-xs text-slate-500"><span className="w-20 h-4 bg-slate-700/30 rounded animate-pulse" /></div>;
  }

  if (!pipeline) {
    return <div className="text-[11px] text-slate-500">Pipeline offline</div>;
  }

  return (
    <div className="flex items-center gap-1.5 text-[11px] flex-wrap">
      {STAGES.map((stage, idx) => {
        const colors = COLOR_MAP[stage.color];
        const count = stage.getCount(emptyPipeline, emptyAq);
        const isLast = idx === STAGES.length - 1;
        return (
          <span key={stage.key} className="inline-flex items-center gap-0.5">
            <span className={`${colors.text} ${colors.bg} ${colors.border} border rounded px-1.5 py-0.5 font-medium inline-flex items-center gap-0.5`}>
              <span className="material-symbols-outlined text-[10px]">{stage.icon}</span>
              <span className="font-bold">{count}</span>
              <span className="text-[9px] opacity-70">{stage.label}</span>
            </span>
            {!isLast && <span className="text-slate-600 mx-0.5">→</span>}
          </span>
        );
      })}
    </div>
  );
}
