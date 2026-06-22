/**
 * ChartContent — Recharts-powered chart rendering.
 *
 * Uses a dynamic import() to load recharts at render time so there is
 * NEVER a static import of the heavy library in any module — the bundler
 * places recharts in its own chunk via this dynamic boundary.
 */

import { useEffect, useState } from 'react';

interface ChartContentProps {
  data: Array<{ date: string; value: number }>;
  isRisk: boolean;
}

type RechartsModule = typeof import('recharts');

export default function ChartContent({ data, isRisk }: ChartContentProps) {
  const [charts, setCharts] = useState<RechartsModule | null>(null);

  useEffect(() => {
    let cancelled = false;
    import('recharts').then((mod) => {
      if (!cancelled) setCharts(mod);
    });
    return () => { cancelled = true; };
  }, []);

  if (!charts) {
    return (
      <div className="flex items-center justify-center h-full text-on-surface-variant">
        <span className="inline-block w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2" />
        <span className="text-sm font-mono">Cargando gráfico...</span>
      </div>
    );
  }

  const {
    ResponsiveContainer,
    AreaChart,
    Area,
    XAxis,
    YAxis,
    Tooltip,
  } = charts;

  return (
    <ResponsiveContainer width="99%" height="100%" minWidth={0}>
      <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="chartColor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#00A3FF" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#00A3FF" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="date"
          stroke="#869397"
          fontSize={9}
          tickLine={false}
          axisLine={false}
          dy={10}
          fontFamily="JetBrains Mono"
        />
        <YAxis
          stroke="#869397"
          fontSize={9}
          tickLine={false}
          axisLine={false}
          domain={['auto', 'auto']}
          dx={-5}
          fontFamily="JetBrains Mono"
          tickFormatter={(val: number) =>
            val >= 1_000_000
              ? `${(val / 1_000_000).toFixed(1)}M`
              : val >= 1_000
                ? `${(val / 1_000).toFixed(0)}K`
                : String(val)
          }
        />
        <Tooltip
          contentStyle={{
            background: 'rgba(11, 18, 32, 0.9)',
            borderColor: 'rgba(0, 163, 255, 0.3)',
            borderRadius: '4px',
            color: '#dde2f8',
            fontFamily: 'JetBrains Mono',
            fontSize: '11px',
          }}
          formatter={(val) => [
            `${Number(val).toLocaleString('es-AR')} ${isRisk ? 'pts' : 'ARS'}`,
            'Valor',
          ]}
          labelFormatter={(label) => `Fecha: ${label}`}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="#00A3FF"
          strokeWidth={2}
          fillOpacity={1}
          fill="url(#chartColor)"
          isAnimationActive={true}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
