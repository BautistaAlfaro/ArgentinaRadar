/**
 * EventDetectionChart — Bar chart of events detected per day.
 *
 * Bars are colored by average impact score. Tooltip shows detail.
 */

import { LazyMotion, domAnimation, m } from 'framer-motion';
import { useState, useEffect } from 'react';
import type { DailyStat } from '../../../services/adminApi';

interface EventDetectionChartProps {
  data: DailyStat[];
}

function getImpactColor(score: number): string {
  if (score >= 70) return '#ef4444';   // red — high impact
  if (score >= 45) return '#f97316';   // orange — medium impact
  return '#22c55e';                     // green — low impact
}

function getImpactLabel(score: number): string {
  if (score >= 70) return 'High';
  if (score >= 45) return 'Medium';
  return 'Low';
}

export function EventDetectionChart({ data }: EventDetectionChartProps) {
  const [R, setR] = useState<any>(null);

  useEffect(() => {
    import('recharts').then((mod) => setR(mod));
  }, []);

  if (!R) return null;

  const {
    BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell
  } = R;
  return (
    <LazyMotion features={domAnimation}>
    <m.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.35 }}
      className="rounded-xl border border-slate-700/50 bg-slate-800/60 p-5"
    >
      <h3 className="text-sm font-semibold text-slate-300 mb-4">
        Event Detection
      </h3>

      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
          >
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
              allowDecimals={false}
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

            <Bar
              dataKey="eventsDetected"
              radius={[4, 4, 0, 0]}
              maxBarSize={32}
            >
              {(Array.isArray(data) ? data : []).map((entry) => (
                <Cell key={entry.date} fill={getImpactColor(entry.avgImpactScore)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
          Low impact
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-orange-500" />
          Medium
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
          High
        </span>
      </div>
    </m.div>
    </LazyMotion>
  );
}



