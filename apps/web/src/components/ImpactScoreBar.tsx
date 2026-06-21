/**
 * Impact Score Bar
 *
 * Horizontal colored bar representing an event's impact score (0–100):
 *   -  0–30: gray
 *   - 31–60: yellow
 *   - 61–100: red
 */

interface ImpactScoreBarProps {
  score: number;
}

function getBarColor(score: number): string {
  if (score >= 61) return 'bg-red-500';
  if (score >= 31) return 'bg-yellow-500';
  return 'bg-gray-500';
}

function getLabelColor(score: number): string {
  if (score >= 61) return 'text-red-400';
  if (score >= 31) return 'text-yellow-400';
  return 'text-gray-400';
}

export function ImpactScoreBar({ score }: ImpactScoreBarProps) {
  const clampedScore = Math.max(0, Math.min(100, score));
  const barColor = getBarColor(clampedScore);
  const labelColor = getLabelColor(clampedScore);

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-700/60 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${clampedScore}%` }}
        />
      </div>
      <span className={`text-xs font-semibold tabular-nums ${labelColor} w-7 text-right`}>
        {clampedScore}
      </span>
    </div>
  );
}
