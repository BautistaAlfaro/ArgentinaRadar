/**
 * CategoryChart — Horizontal bar chart showing article distribution by category.
 *
 * Uses plain CSS bars (no chart library dependency) for a lightweight display.
 */

import { LazyMotion, domAnimation, m as motion } from 'framer-motion';

interface CategoryChartProps {
  categories: Array<{ category: string; count: number }> | null;
  isLoading: boolean;
}

const CATEGORY_COLORS: Record<string, { bar: string; text: string; bg: string }> = {
  sociedad:  { bar: 'bg-blue-500',     text: 'text-blue-300',  bg: 'bg-blue-500/10' },
  economia:  { bar: 'bg-emerald-500',  text: 'text-emerald-300', bg: 'bg-emerald-500/10' },
  politica:  { bar: 'bg-violet-500',   text: 'text-violet-300', bg: 'bg-violet-500/10' },
  deportes:  { bar: 'bg-amber-500',    text: 'text-amber-300', bg: 'bg-amber-500/10' },
};

const DEFAULT_COLOR = { bar: 'bg-slate-500', text: 'text-slate-300', bg: 'bg-slate-500/10' };

export function CategoryChart({ categories, isLoading }: CategoryChartProps) {
  if (isLoading) {
    return (
      <section className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-5">
        <div className="h-5 w-40 bg-slate-700 rounded animate-pulse mb-4" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 mb-3">
            <div className="h-4 w-16 bg-slate-700 rounded animate-pulse" />
            <div className="h-4 flex-1 bg-slate-700/60 rounded animate-pulse" />
            <div className="h-4 w-8 bg-slate-700 rounded animate-pulse" />
          </div>
        ))}
      </section>
    );
  }

  if (!categories || categories.length === 0) {
    return (
      <section className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-5">
        <h3 className="text-sm font-semibold text-slate-400 mb-3">Category Breakdown</h3>
        <p className="text-xs text-slate-500">No category data available.</p>
      </section>
    );
  }

  const maxCount = Math.max(...categories.map((c) => c.count), 1);

  return (
    <LazyMotion features={domAnimation}>
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-5"
      >
        <h3 className="text-sm font-semibold text-white tracking-tight mb-4">
          Category Breakdown
        </h3>

        <div className="space-y-3">
          {categories.map((cat, idx) => {
            const colors = CATEGORY_COLORS[cat.category] ?? DEFAULT_COLOR;
            const pct = Math.round((cat.count / maxCount) * 100);
            const totalPct = Math.round((cat.count / categories.reduce((s, c) => s + c.count, 0)) * 100);

            return (
              <motion.div
                key={cat.category}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.06 }}
                className="flex items-center gap-3"
              >
                <span className={`text-xs font-medium capitalize w-20 shrink-0 ${colors.text}`}>
                  {cat.category}
                </span>

                <div className="flex-1 h-5 rounded-full bg-slate-700/50 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.6, delay: idx * 0.06, ease: 'easeOut' }}
                    className={`h-full rounded-full ${colors.bar} opacity-80`}
                  />
                </div>

                <div className="flex items-center gap-2 w-16 justify-end shrink-0">
                  <span className="text-sm font-bold text-white tabular-nums">{cat.count}</span>
                  <span className="text-[10px] text-slate-500">{totalPct}%</span>
                </div>
              </motion.div>
            );
          })}
        </div>
      </motion.section>
    </LazyMotion>
  );
}
