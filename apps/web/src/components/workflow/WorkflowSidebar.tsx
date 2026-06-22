/**
 * WorkflowSidebar — Left column (250px) for the 3-column dashboard layout.
 *
 * 4 phases with live counts, status colors, and active highlight.
 * Clicking a phase sets the active phase in the parent ControlCenter.
 */

import { useQuery } from '@tanstack/react-query';
import { m as motion } from 'framer-motion';
import { API } from '@shared/apiConfig';

const ADMIN_API = API.admin;

// ── Types ──────────────────────────────────────────────────────────────

export type WorkflowPhase = 'ingest' | 'ai' | 'approve' | 'publish';

interface PhaseDef {
  key: WorkflowPhase;
  label: string;
  icon: string;
  color: string;
  colorBg: string;
  colorBorder: string;
  getCount: (stats: WorkflowStats | null) => string | number;
  badge?: (stats: WorkflowStats | null) => number | null;
}

export interface WorkflowStats {
  totalArticles: number;
  totalSources: number;
  pendingApproval: number;
  publishedToday: number;
  scheduledCount: number;
  ingestedToday: number;
  lastRefresh: string | null;
  aiModel: string;
  aiThreshold: number;
  minQuality: number;
}

interface WorkflowSidebarProps {
  activePhase: WorkflowPhase;
  onPhaseChange: (phase: WorkflowPhase) => void;
}

// ── Fetch stats ────────────────────────────────────────────────────────

function useWorkflowStats() {
  return useQuery<WorkflowStats>({
    queryKey: ['admin', 'workflow-stats'],
    queryFn: async () => {
      const resp = await fetch(`${ADMIN_API}/api/admin/articles/stats`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.json();
    },
    refetchInterval: 15_000,
    staleTime: 5_000,
  });
}

// ── Phase definitions ──────────────────────────────────────────────────

const PHASES: PhaseDef[] = [
  {
    key: 'ingest',
    label: 'Ingest',
    icon: 'cloud_download',
    color: 'text-sky-400',
    colorBg: 'bg-sky-500/10',
    colorBorder: 'border-sky-500/30',
    getCount: (s) => {
      if (!s) return '...';
      return `${s.totalArticles} en DB · ${s.totalSources} fuentes`;
    },
  },
  {
    key: 'ai',
    label: 'AI Process',
    icon: 'psychology',
    color: 'text-amber-400',
    colorBg: 'bg-amber-500/10',
    colorBorder: 'border-amber-500/30',
    getCount: (s) => {
      if (!s) return '...';
      return `${s.ingestedToday} hoy · ${s.aiModel}`;
    },
  },
  {
    key: 'approve',
    label: 'Approve',
    icon: 'fact_check',
    color: 'text-emerald-400',
    colorBg: 'bg-emerald-500/10',
    colorBorder: 'border-emerald-500/30',
    getCount: (s) => {
      if (!s) return '...';
      const isAuto = s.pendingApproval === 0 && s.publishedToday > 0;
      return isAuto ? '0 (auto)' : `${s.pendingApproval} pend.`;
    },
    badge: (s) => {
      if (!s) return null;
      // In auto mode, don't show badge
      return s.pendingApproval > 0 ? s.pendingApproval : null;
    },
  },
  {
    key: 'publish',
    label: 'Publish',
    icon: 'publish',
    color: 'text-violet-400',
    colorBg: 'bg-violet-500/10',
    colorBorder: 'border-violet-500/30',
    getCount: (s) => {
      if (!s) return '...';
      return `${s.publishedToday} hoy · ${s.scheduledCount} prog.`;
    },
  },
];

// ── Helpers ────────────────────────────────────────────────────────────

function formatTimeAgo(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// ── Component ──────────────────────────────────────────────────────────

export function WorkflowSidebar({ activePhase, onPhaseChange }: WorkflowSidebarProps) {
  const { data: stats, isLoading } = useWorkflowStats();

  return (
    <nav className="w-[250px] shrink-0 flex flex-col gap-3 p-4 border-r border-slate-700/30 overflow-y-auto">
      {/* Stats header */}
      <div className="text-[10px] text-slate-500 font-mono mb-1">
        {isLoading ? 'Cargando...' : `Último: ${formatTimeAgo(stats?.lastRefresh ?? null)}`}
      </div>

      {/* Phase buttons */}
      {PHASES.map((phase) => {
        const isActive = activePhase === phase.key;
        const badgeCount = phase.badge?.(stats ?? null) ?? null;

        return (
          <motion.button
            key={phase.key}
            type="button"
            onClick={() => onPhaseChange(phase.key)}
            whileTap={{ scale: 0.97 }}
            className={`
              relative flex flex-col items-start gap-1 px-4 py-3 rounded-xl border text-left
              transition-all duration-150 cursor-pointer
              ${isActive
                ? `${phase.colorBg} ${phase.colorBorder} border-2`
                : 'border-slate-700/30 hover:border-slate-500/50 hover:bg-slate-800/40'
              }
            `}
          >
            {/* Badge for pending count */}
            {badgeCount !== null && badgeCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center w-5 h-5 rounded-full bg-red-500 text-white text-[9px] font-bold shadow-lg">
                {badgeCount > 9 ? '9+' : badgeCount}
              </span>
            )}

            {/* Icon + Label */}
            <div className="flex items-center gap-2">
              <span className={`material-symbols-outlined text-lg ${phase.color}`} aria-hidden="true">
                {phase.icon}
              </span>
              <span className={`text-sm font-bold ${isActive ? 'text-white' : 'text-slate-300'}`}>
                {phase.label}
              </span>
            </div>

            {/* Count / description */}
            <span className={`text-[11px] font-mono pl-7 ${isActive ? 'text-slate-300' : 'text-slate-500'}`}>
              {phase.getCount(stats ?? null)}
            </span>
          </motion.button>
        );
      })}

      {/* Pending article bar for ingest */}
      {stats && (
        <div className="mt-auto pt-4 border-t border-slate-700/20 text-[10px] text-slate-600 font-mono space-y-1">
          <div className="flex justify-between">
            <span>Ingeridos hoy</span>
            <span className="text-slate-400">{stats.ingestedToday}</span>
          </div>
          <div className="flex justify-between">
            <span>Total artículos</span>
            <span className="text-slate-400">{stats.totalArticles}</span>
          </div>
        </div>
      )}
    </nav>
  );
}
