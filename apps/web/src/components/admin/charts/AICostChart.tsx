/**
 * AICostChart — Daily AI processing cost with budget alert line.
 *
 * Shows daily AI cost as an area chart. Horizontal line marks the
 * $2 daily budget. Visual alert when costs approach the limit.
 */

import { useState, useEffect } from 'react';
import { LazyMotion, domAnimation, m } from 'framer-motion';
import type { DailyStat } from '../../../services/adminApi';
import { format } from 'date-fns';

const BUDGET = 2.0;
const WARNING_THRESHOLD = 0.8; // 80% of budget

interface AICostChartProps {
  data: DailyStat[];
}

export function AICostChart({ data }: AICostChartProps) {
  const [R, setR] = useState<any>(null);

  useEffect(() => {
    import('recharts').then((mod) => setR(mod));
  }, []);

  if (!R) return null;

  const {
    AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ComposedChart,
  Legend
  } = R;
  const nearBudget = data.some((d) => d.aiCost >= BUDGET * WARNING_THRESHOLD);

  return (
    <LazyMotion features={domAnimation}>
    <m.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.5 }}
      className="rounded-xl border border-slate-700/50 bg-slate-800/60 p-5"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-300">
          AI Processing Cost
        </h3>
        {nearBudget && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/20">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
            Near budget limit
          </span>
        )}
      </div>

      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
          >
            <defs>
              <linearGradient id="ai-cost-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#f97316" stopOpacity={0.02} />
              </linearGradient>
            </defs>

            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#334155"
              vertical={false}
            />

            <XAxis
              dataKey="date"
              tick={{ fill: '#64748b', fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: '#334155' }}
              tickFormatter={(v: string) => v.slice(5)}
            />

            <YAxis
              tick={{ fill: '#64748b', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `$${v.toFixed(1)}`}
              domain={[0, BUDGET * 1.4]}
            />

            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '8px',
                fontSize: '12px',
                color: '#e2e8f0',
              }}
              labelFormatter={(label: unknown) => format(new Date(label as string), 'MMM dd, yyyy')}
              formatter={(value: unknown) => [`$${(value as number).toFixed(3)}`, 'AI Cost']}
            />

            <Legend
              wrapperStyle={{ fontSize: '11px', color: '#94a3b8', paddingTop: '8px' }}
            />

            {/* Budget reference line */}
            <ReferenceLine
              y={BUDGET}
              stroke="#ef4444"
              strokeDasharray="6 4"
              strokeWidth={1.5}
              label={{
                value: 'Budget $2.00',
                position: 'right',
                fill: '#ef4444',
                fontSize: 10,
              }}
            />

            {/* Warning zone */}
            <ReferenceLine
              y={BUDGET * WARNING_THRESHOLD}
              stroke="#f97316"
              strokeDasharray="3 3"
              strokeWidth={1}
              strokeOpacity={0.5}
            />

            {/* Area fill */}
            <Area
              type="monotone"
              dataKey="aiCost"
              stroke="none"
              fill="url(#ai-cost-gradient)"
            />

            {/* Cost line */}
            <Line
              type="monotone"
              dataKey="aiCost"
              name="AI Cost"
              stroke="#f97316"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5, strokeWidth: 0, fill: '#f97316' }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </m.div>
    </LazyMotion>
  );
}


