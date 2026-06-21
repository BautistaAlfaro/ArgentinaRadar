/**
 * NewsProcessingChart — Stacked area chart of news pipeline stages.
 *
 * Shows ingested / geolocated / filtered / published news per day
 * with an interactive tooltip and framer-motion entrance.
 */

import { useEffect, useState } from 'react';
import { LazyMotion, domAnimation, m } from 'framer-motion';
import type { DailyStat } from '../../../services/adminApi';

const STAGES = [
  { key: 'ingested', label: 'Ingested', color: '#6366f1' },    // indigo
  { key: 'geolocated', label: 'Geolocated', color: '#06b6d4' },  // cyan
  { key: 'filtered', label: 'Filtered', color: '#22c55e' },       // green
  { key: 'published', label: 'Published', color: '#eab308' },     // yellow
] as const;

interface NewsProcessingChartProps {
  data: DailyStat[];
}

export function NewsProcessingChart({ data }: NewsProcessingChartProps) {
  const [R, setR] = useState<any>(null);

  useEffect(() => {
    import('recharts').then((mod) => setR(mod));
  }, []);

  if (!R) return null;

  const {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Legend,
  } = R;

  return (
    <LazyMotion features={domAnimation}>
    <m.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="rounded-xl border border-slate-700/50 bg-slate-800/60 p-5"
    >
      <h3 className="text-sm font-semibold text-slate-300 mb-4">
        News Processing Pipeline
      </h3>

      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
          >
            <defs>
              {STAGES.map((s) => (
                <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={s.color} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={s.color} stopOpacity={0.05} />
                </linearGradient>
              ))}
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
              tickFormatter={(v: string) => v.slice(5)} // MM-DD
            />

            <YAxis
              tick={{ fill: '#64748b', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
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
            />

            <Legend
              wrapperStyle={{ fontSize: '11px', color: '#94a3b8', paddingTop: '8px' }}
            />

            {STAGES.map((s) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stackId="1"
                stroke={s.color}
                fill={`url(#grad-${s.key})`}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </m.div>
    </LazyMotion>
  );
}


