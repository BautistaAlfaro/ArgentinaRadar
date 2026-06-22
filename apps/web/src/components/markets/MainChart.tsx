/**
 * MainChart — Lazy-loadable wrapper around the recharts AreaChart.
 *
 * Uses React.lazy internally for ChartContent so that recharts is
 * never bundled in the main chunk — only loaded when the chart renders.
 */

import { lazy, Suspense } from 'react';

const ChartContent = lazy(() => import('./ChartContent'));

interface ChartDataPoint {
  date: string;
  value: number;
}

interface MainChartProps {
  data: ChartDataPoint[];
  indicatorSymbol: string;
  indicatorName: string;
  indicatorChange: number;
  indicatorChangePercent: number;
  indicatorValue: number;
  selectedRange: string;
  onRangeChange: (range: string) => void;
}

const RANGES = ['1D', '1W', '1M', '6M', '1Y', 'MAX'];

export default function MainChart({
  data,
  indicatorSymbol,
  indicatorName,
  indicatorChange,
  indicatorChangePercent,
  indicatorValue,
  selectedRange,
  onRangeChange,
}: MainChartProps) {
  const isRisk = indicatorSymbol === 'RISK.AR';

  return (
    <div className="glass-panel p-5 rounded active-glow flex flex-col h-[420px] justify-between relative">
      <div className="flex justify-between items-start border-b border-white/5 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-headline-sm text-headline-sm font-bold text-white uppercase font-space-grotesk">
              {indicatorName}
            </span>
            <span className="text-xs font-mono font-bold text-[#00A3FF]">
              ({indicatorSymbol})
            </span>
          </div>
          <div className="flex items-baseline gap-3 mt-1.5">
            <span className="text-2xl font-bold font-jetbrains-mono text-white">
              {isRisk
                ? Math.round(indicatorValue).toLocaleString('es-AR')
                : indicatorValue.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
              }
            </span>
            <span className={`text-sm font-mono font-bold flex items-center gap-0.5 ${
              indicatorChangePercent >= 0 ? 'text-secondary' : 'text-error'
            }`}>
              {indicatorChangePercent >= 0 ? '▲' : '▼'}
              {indicatorChange.toLocaleString('es-AR', { minimumFractionDigits: 2 })} ({indicatorChangePercent >= 0 ? '+' : ''}{indicatorChangePercent.toFixed(2)}%)
            </span>
          </div>
        </div>

        {/* Range selectors */}
        <div className="flex border border-white/10 bg-surface-container-lowest/80 p-0.5 rounded">
          {RANGES.map((r) => (
            <button
              type="button"
              key={r}
              onClick={() => onRangeChange(r)}
              className={`px-3 py-1 text-[10px] font-bold rounded cursor-pointer transition-all ${
                selectedRange === r
                  ? 'bg-[#00A3FF] text-white shadow-sm font-bold'
                  : 'text-on-surface-variant hover:text-[#00A3FF]'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Chart Canvas Area — lazily loads recharts */}
      <div className="flex-1 mt-4 relative min-w-0">
        <Suspense fallback={
          <div className="flex items-center justify-center h-full text-on-surface-variant">
            <span className="inline-block w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2" />
            <span className="text-sm font-mono">Cargando gráfico...</span>
          </div>
        }>
          <ChartContent data={data} isRisk={isRisk} />
        </Suspense>
      </div>
    </div>
  );
}
