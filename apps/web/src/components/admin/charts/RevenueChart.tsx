/**
 * RevenueChart — Daily revenue line chart with area fill.
 *
 * Shows daily revenue + MRR trend line, formatted in USD.
 */

import { LazyMotion, domAnimation, m } from 'framer-motion';
import { useState, useEffect } from 'react';
import type { RevenuePoint } from '../../../services/adminApi';

// Hoist Intl formatter to module scope
const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
});

interface RevenueChartProps {
  data: RevenuePoint[];
}

function formatUSD(amount: number): string {
  return usdFormatter.format(amount);
}

export function RevenueChart({ data }: RevenueChartProps) {
  const [R, setR] = useState<any>(null);

  useEffect(() => {
    import('recharts').then((mod) => setR(mod));
  }, []);

  if (!R) return null;

  const {
    LineChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart
  } = R;
  return (
    <LazyMotion features={domAnimation}>
    <m.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      className="rounded-xl border border-slate-700/50 bg-slate-800/60 p-5"
    >
      <h3 className="text-sm font-semibold text-slate-300 mb-4">
        Revenue Overview
      </h3>

      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
          >
            <defs>
              <linearGradient id="revenue-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#22d3ee" stopOpacity={0.02} />
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
              tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
            />

            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '8px',
                fontSize: '12px',
                color: '#e2e8f0',
              }}
              labelFormatter={(label: unknown) => new Date(label as string).toLocaleDateString('es-AR')}
              formatter={(value: unknown, name: unknown) => [formatUSD(value as number), name === 'revenue' ? 'Revenue' : 'MRR']}
            />

            {/* Area under the line */}
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="none"
              fill="url(#revenue-gradient)"
            />

            {/* Revenue line */}
            <Line
              type="monotone"
              dataKey="revenue"
              stroke="#22d3ee"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5, strokeWidth: 0, fill: '#22d3ee' }}
            />

            {/* MRR trend line */}
            <Line
              type="monotone"
              dataKey="mrr"
              stroke="#a78bfa"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0, fill: '#a78bfa' }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 rounded bg-cyan-400" />
          Daily Revenue
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 rounded bg-violet-400" />
          MRR Trend
        </span>
      </div>
    </m.div>
    </LazyMotion>
  );
}





