/**
 * KPICard — Animated metric card for the admin dashboard.
 *
 * Features:
 * - Icon (lucide-react style via inline SVG)
 * - Counter animation (framer-motion)
 * - Trend indicator (↑/↓ with green/red)
 * - Sparkline mini chart (recharts)
 * - Fade-in entrance animation
 */

import { useEffect, useRef, useState, useMemo } from 'react';
import { LazyMotion, domAnimation, m, useInView } from 'framer-motion';

// Hoist Intl formatter to module scope to avoid recreating on every call
const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

interface KPICardProps {
  /** Icon SVG path data */
  icon: React.ReactNode;
  /** Primary value to display */
  value: number | string;
  /** Label below the value */
  label: string;
  /** Percentage trend (positive = up, negative = down) */
  trend: number;
  /** Sparkline data points (last N days) */
  sparkline: number[];
  /** Format for value display */
  format?: 'number' | 'currency' | 'compact';
  /** Accent color class (tailwind) */
  accent?: 'blue' | 'emerald' | 'amber' | 'violet';
}

const ACCENT_MAP = {
  blue: {
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
    icon: 'text-blue-400',
    glow: 'group-hover:shadow-blue-500/10',
  },
  emerald: {
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20',
    icon: 'text-emerald-400',
    glow: 'group-hover:shadow-emerald-500/10',
  },
  amber: {
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
    icon: 'text-amber-400',
    glow: 'group-hover:shadow-amber-500/10',
  },
  violet: {
    bg: 'bg-violet-500/10',
    border: 'border-violet-500/20',
    icon: 'text-violet-400',
    glow: 'group-hover:shadow-violet-500/10',
  },
};

function useCountUp(end: number, duration = 1200) {
  const [value, setValue] = useState(0);
  const ref = useRef<number>(0);
  const startTime = useRef<number>(0);

  useEffect(() => {
    startTime.current = performance.now();
    ref.current = requestAnimationFrame(function tick(now) {
      const elapsed = now - startTime.current;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * end));
      if (progress < 1) {
        ref.current = requestAnimationFrame(tick);
      }
    });
    return () => cancelAnimationFrame(ref.current);
  }, [end, duration]);

  return value;
}

function formatValue(value: number, format: KPICardProps['format']): string {
  switch (format) {
    case 'currency':
      return currencyFormatter.format(value);
    case 'compact':
      if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
      if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
      return value.toLocaleString();
    default:
      return value.toLocaleString();
  }
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const [R, setR] = useState<any>(null);

  useEffect(() => {
    import('recharts').then((mod) => setR(mod));
  }, []);

  if (!R) return <div className="h-10 w-full bg-slate-800/40 rounded animate-pulse" />;

  const { ResponsiveContainer, AreaChart, Area } = R;
  const chartData = data.map((v, i) => ({ i, v }));

  return (
    <div className="h-10 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`sparkline-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#sparkline-${color.replace('#', '')})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function KPICard({
  icon,
  value,
  label,
  trend,
  sparkline,
  format = 'number',
  accent = 'blue',
}: KPICardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-50px' });
  const colors = ACCENT_MAP[accent];
  const numericValue = typeof value === 'number' ? value : parseFloat(value.replace(/[^0-9.]/g, ''));
  const animatedValue = useCountUp(isInView ? numericValue : 0);
  const isPositive = trend >= 0;
  const sparklineColor = isPositive ? '#22c55e' : '#ef4444';

  return (
    <LazyMotion features={domAnimation}>
    <m.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className={`
        group relative rounded-xl border ${colors.border} ${colors.bg}
        p-5 transition-all duration-300 hover:shadow-lg ${colors.glow}
        hover:border-slate-600/50
      `}
    >
      {/* Hover accent line */}
      <div className={`absolute inset-x-0 top-0 h-0.5 rounded-t-xl bg-gradient-to-r from-transparent via-${accent}-400/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity`} />

      <div className="flex items-start justify-between mb-3">
        <div className={`p-2 rounded-lg bg-slate-800/60 ${colors.icon}`}>
          {icon}
        </div>
        <span
          className={`
            inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-medium
            ${isPositive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}
          `}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-3 h-3"
          >
            {isPositive ? (
              <path
                fillRule="evenodd"
                d="M10 17a.75.75 0 01-.75-.75V5.612L5.29 9.77a.75.75 0 01-1.08-1.04l5.25-5.5a.75.75 0 011.08 0l5.25 5.5a.75.75 0 11-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0110 17z"
                clipRule="evenodd"
              />
            ) : (
              <path
                fillRule="evenodd"
                d="M10 3a.75.75 0 01.75.75v10.638l3.96-4.158a.75.75 0 111.08 1.04l-5.25 5.5a.75.75 0 01-1.08 0l-5.25-5.5a.75.75 0 111.08-1.04l3.96 4.158V3.75A.75.75 0 0110 3z"
                clipRule="evenodd"
              />
            )}
          </svg>
          {Math.abs(trend).toFixed(1)}%
        </span>
      </div>

      <div className="mb-2">
        <m.span
          key={animatedValue}
          className="text-2xl font-bold text-white tracking-tight tabular-nums"
        >
          {typeof value === 'number'
            ? formatValue(animatedValue, format)
            : value}
        </m.span>
      </div>

      <p className="text-xs text-slate-400 font-medium mb-3">{label}</p>

      <Sparkline data={sparkline} color={sparklineColor} />
    </m.div>
    </LazyMotion>
  );
}
