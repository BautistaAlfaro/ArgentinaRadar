/**
 * SystemHealthChart — Multi-line chart for service CPU / memory.
 *
 * Each service gets its own colored line. Interactive legend to
 * toggle visibility. Expects arbitrary metric key (cpu / memory).
 */

import { useState, useEffect } from 'react';
import { LazyMotion, domAnimation, m } from 'framer-motion';
import type { SystemMetric } from '../../../services/adminApi';

const SERVICE_COLORS = [
  '#6366f1', // indigo
  '#06b6d4', // cyan
  '#22c55e', // green
  '#eab308', // yellow
  '#f97316', // orange
  '#ef4444', // red
  '#ec4899', // pink
  '#a78bfa', // violet
];

interface SystemHealthChartProps {
  metrics: SystemMetric[];
  /** Which metric dimension to display: 'cpu' or 'memory' */
  dimension?: 'cpu' | 'memory';
}

export function SystemHealthChart({
  metrics,
  dimension = 'cpu',
}: SystemHealthChartProps) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [R, setR] = useState<any>(null);

  useEffect(() => {
    import('recharts').then((mod) => setR(mod));
  }, []);

  // Build chart data: each entry = { index: number, serviceName: value, ... }
  const maxPoints = Math.max(...metrics.map((m) => m.cpuHistory.length));
  const chartData = Array.from({ length: maxPoints }, (_, i) => {
    const entry: Record<string, number | string> = { index: i };
    metrics.forEach((m) => {
      const history = dimension === 'cpu' ? m.cpuHistory : m.memoryHistory;
      entry[m.service] = history[i] ?? null;
    });
    return entry;
  });

  const toggleLine = (service: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(service)) next.delete(service);
      else next.add(service);
      return next;
    });
  };

  const unit = dimension === 'cpu' ? '%' : 'MB';
  const title = dimension === 'cpu' ? 'CPU Usage' : 'Memory Usage';

  if (!R) return null;

  const { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } = R;

  return (
    <LazyMotion features={domAnimation}>
    <m.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.4 }}
      className="rounded-xl border border-slate-700/50 bg-slate-800/60 p-5"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-300">{title}</h3>
        <div className="flex gap-1">
          <span className={`text-xs px-2 py-0.5 rounded cursor-pointer transition-colors ${dimension === 'cpu' ? 'bg-blue-500/20 text-blue-300' : 'text-slate-500 hover:text-slate-300'}`}>
            CPU
          </span>
          <span className={`text-xs px-2 py-0.5 rounded cursor-pointer transition-colors ${dimension === 'memory' ? 'bg-blue-500/20 text-blue-300' : 'text-slate-500 hover:text-slate-300'}`}>
            MEM
          </span>
        </div>
      </div>

      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#334155"
              vertical={false}
            />

            <XAxis
              dataKey="index"
              tick={{ fill: '#64748b', fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: '#334155' }}
              tickFormatter={(v: number) => `${v * 5}m`}
            />

            <YAxis
              tick={{ fill: '#64748b', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${v}${unit}`}
            />

            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '8px',
                fontSize: '12px',
                color: '#e2e8f0',
              }}
              labelFormatter={(label: unknown) => `${(label as number) * 5} min ago`}
            />

            <Legend
              wrapperStyle={{ fontSize: '11px', color: '#94a3b8', paddingTop: '8px' }}
              onClick={(e: any) => toggleLine(e.value as string)}
            />

            {metrics.map((m, i) => (
              <Line
                key={m.service}
                type="monotone"
                dataKey={m.service}
                name={m.service}
                stroke={SERVICE_COLORS[i % SERVICE_COLORS.length]}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, strokeWidth: 0 }}
                hide={hidden.has(m.service)}
                strokeOpacity={hidden.has(m.service) ? 0 : 1}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </m.div>
    </LazyMotion>
  );
}


