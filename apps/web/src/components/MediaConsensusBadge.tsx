/**
 * Media Consensus Badge
 *
 * Inline badge showing how many sources have reported an event:
 *   - high (5+)   → 🟢 Confirmado
 *   - medium (3–4) → 🟡 Reportado
 *   - low (1–2)   → 🔴 Sin verificar
 */

import type { ConsensusLevel } from '../services/api';

interface MediaConsensusBadgeProps {
  level: ConsensusLevel;
  articleCount: number;
}

const CONFIG: Record<ConsensusLevel, { label: string; dot: string; className: string }> = {
  high: {
    label: 'Confirmado',
    dot: '🟢',
    className: 'bg-green-500/15 text-green-400 border-green-500/30',
  },
  medium: {
    label: 'Reportado',
    dot: '🟡',
    className: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  },
  low: {
    label: 'Sin verificar',
    dot: '🔴',
    className: 'bg-red-500/15 text-red-400 border-red-500/30',
  },
};

export function MediaConsensusBadge({ level, articleCount }: MediaConsensusBadgeProps) {
  const cfg = CONFIG[level];
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded border ${cfg.className}`}
    >
      <span className="text-[11px]" aria-hidden="true">
        {cfg.dot}
      </span>
      {cfg.label}
      <span className="opacity-60">({articleCount})</span>
    </span>
  );
}
