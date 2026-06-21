/**
 * PipelineView — Visual representation of the news pipeline stages.
 *
 * Shows articles flowing from ingestion → geolocation → AI processing →
 * pending approval → published, with counts at each stage.
 */

import { LazyMotion, domAnimation, m as motion } from 'framer-motion';

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
    icon: '📥',
    getCount: (p) => (p.ingested ?? 0) + (p.geolocated ?? 0),
  },
  {
    key: 'geolocated',
    label: 'Geolocated',
    color: 'amber',
    icon: '📍',
    getCount: (p) => p.geolocated ?? 0,
  },
  {
    key: 'filtered',
    label: 'AI Processing',
    color: 'blue',
    icon: '🧠',
    getCount: (p) => p.filtered ?? 0,
  },
  {
    key: 'pending_approval',
    label: 'Pending Approval',
    color: 'violet',
    icon: '⏳',
    getCount: (p, aq) => (p.pending_approval ?? 0) + (aq.pending ?? 0),
  },
  {
    key: 'published',
    label: 'Published',
    color: 'emerald',
    icon: '✅',
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
    return (
      <section className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-5">
        <div className="h-5 w-36 bg-slate-700 rounded animate-pulse mb-4" />
        <div className="flex gap-3 overflow-x-auto pb-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 w-32 bg-slate-700/60 rounded-xl animate-pulse shrink-0" />
          ))}
        </div>
      </section>
    );
  }

  if (!pipeline) {
    return (
      <section className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-5">
        <h3 className="text-sm font-semibold text-slate-400 mb-3">Pipeline Status</h3>
        <p className="text-xs text-slate-500">Pipeline service unreachable. Showing mock estimates.</p>
      </section>
    );
  }

  return (
    <LazyMotion features={domAnimation}>
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white tracking-tight">
            Pipeline Status
          </h3>
          <span className="text-[11px] text-slate-500 font-mono">
            {totalArticles} total articles
          </span>
        </div>

        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-slate-700">
          {STAGES.map((stage, idx) => {
            const colors = COLOR_MAP[stage.color];
            const count = stage.getCount(emptyPipeline, emptyAq);
            const isLast = idx === STAGES.length - 1;

            return (
              <div key={stage.key} className="flex items-center gap-0 shrink-0">
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: idx * 0.08 }}
                  className={`flex flex-col items-center gap-2 p-3 rounded-xl border ${colors.border} ${colors.bg} min-w-[110px] ${colors.glow} shadow-sm`}
                >
                  <span className="text-lg" aria-hidden="true">{stage.icon}</span>
                  <span className={`text-xs font-medium ${colors.text}`}>{stage.label}</span>
                  <span className={`text-lg font-bold tabular-nums ${colors.badge} px-2 py-0.5 rounded-md`}>
                    {count}
                  </span>
                </motion.div>

                {!isLast && (
                  <div className="flex items-center mx-1">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="w-4 h-4 text-slate-600"
                    >
                      <path
                        fillRule="evenodd"
                        d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-[10px] text-slate-600 mt-3 text-center">
          RSS Feeds → Pipeline → AI Processing → Approval → Publication
        </p>
      </motion.section>
    </LazyMotion>
  );
}
