/**
 * Economic Ticker — Horizontal bar at the bottom of the dashboard.
 *
 * Shows:
 *   - Dólar Blue (compra/venta)
 *   - MERVAL index
 *   - Riesgo País (sovereign risk spread)
 *
 * Each indicator shows:
 *   - Current value
 *   - Delta arrow (↑/↓) with color (green for positive, red for negative)
 *   - Status indicator (stale → red background + tooltip)
 *
 * Polls via TanStack Query every 60 seconds.
 */

import { useEconomicData, type EnrichedIndicator } from '../../hooks/useEconomicData';

/**
 * Determine indicator direction and display value from previous_value.
 */
function getDelta(current: number, previous: number | null): { arrow: string; direction: 'up' | 'down' | 'flat'; color: string } {
  if (previous === null || previous === 0) {
    return { arrow: '—', direction: 'flat', color: 'text-slate-400' };
  }

  const pct = ((current - previous) / previous) * 100;

  if (Math.abs(pct) < 0.01) {
    return { arrow: '—', direction: 'flat', color: 'text-slate-400' };
  }

  if (pct > 0) {
    return { arrow: '↑', direction: 'up', color: 'text-green-400' };
  }

  return { arrow: '↓', direction: 'down', color: 'text-red-400' };
}

/**
 * Format a number with thousand separators and fixed decimals.
 */
function formatNumber(value: number, decimals = 2): string {
  return value.toLocaleString('es-AR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

interface IndicatorBlockProps {
  label: string;
  value: number | null;
  previousValue: number | null;
  stale: boolean;
  format?: (v: number) => string;
  metadata?: Record<string, unknown> | null;
}

function IndicatorBlock({ label, value, previousValue, stale, format, metadata }: IndicatorBlockProps) {
  if (value === null) {
    return (
      <div className="flex items-center gap-3 px-4 py-1 border-r border-slate-700/50 last:border-r-0 min-w-fit">
        <span className="text-xs text-slate-500 font-semibold uppercase tracking-wide">{label}</span>
        <span className="text-sm text-slate-600">—</span>
      </div>
    );
  }

  const delta = getDelta(value, previousValue);
  const formattedValue = format ? format(value) : formatNumber(value);

  // For riesgo país, up is BAD (red), down is GOOD (green) — invert arrow color
  const isInverted = label === 'R. País';
  const arrowColor = isInverted
    ? delta.direction === 'up'
      ? 'text-red-400'
      : delta.direction === 'down'
        ? 'text-green-400'
        : 'text-slate-400'
    : delta.color;

  // Extract venta from metadata for dólar blue
  const venta = metadata?.venta as number | undefined;
  const extraValue = venta != null ? `V: ${formatNumber(venta)}` : null;

  return (
    <div
      className={`flex items-center gap-3 px-4 py-1 border-r border-slate-700/50 last:border-r-0 min-w-fit ${
        stale ? 'bg-red-900/40' : ''
      }`}
      title={stale ? '⚠️ Datos desactualizados' : undefined}
    >
      <span className="text-xs text-slate-500 font-semibold uppercase tracking-wide">{label}</span>

      <div className="flex items-baseline gap-1">
        <span className={`text-sm font-mono font-bold tabular-nums ${stale ? 'text-red-300' : 'text-white'}`}>
          {formattedValue}
        </span>
        {extraValue && (
          <span className="text-xs font-mono text-slate-400 tabular-nums ml-1">
            {extraValue}
          </span>
        )}
      </div>

      <span className={`text-xs font-mono font-bold ${arrowColor} transition-colors`}>
        {delta.arrow}
      </span>

      {stale && (
        <span className="text-xs text-red-400 font-semibold ml-1" title="Datos desactualizados">
          ⚠
        </span>
      )}
    </div>
  );
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function EconomicTicker() {
  const {
    dolarBlue,
    merval,
    riesgoPais,
    hasStaleData,
    isLoading,
    isError,
    serverTime,
  } = useEconomicData();

  return (
    <footer
      className={`h-12 ${
        hasStaleData
          ? 'bg-red-950/60 border-t border-red-800/50'
          : 'bg-slate-800/80 backdrop-blur-sm border-t border-slate-700/50'
      } shrink-0 flex items-center overflow-hidden transition-colors duration-300`}
    >
      <div className="flex items-center h-full overflow-x-auto scrollbar-none">
        {isLoading && (
          <div className="flex items-center gap-2 px-4 text-slate-500">
            <span className="inline-block w-3 h-3 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs">Cargando datos...</span>
          </div>
        )}

        {isError && (
          <div className="flex items-center gap-2 px-4 text-red-400">
            <span className="text-sm">⚠</span>
            <span className="text-xs font-medium">Error al cargar indicadores</span>
          </div>
        )}

        {!isLoading && !isError && (
          <>
            <IndicatorBlock
              label="Dólar Blue"
              value={dolarBlue?.value ?? null}
              previousValue={dolarBlue?.previousValue ?? null}
              stale={dolarBlue?.stale ?? false}
              metadata={dolarBlue?.metadata ?? null}
            />

            <IndicatorBlock
              label="MERVAL"
              value={merval?.value ?? null}
              previousValue={merval?.previousValue ?? null}
              stale={merval?.stale ?? false}
              format={(v) => formatNumber(v, 2)}
            />

            <IndicatorBlock
              label="R. País"
              value={riesgoPais?.value ?? null}
              previousValue={riesgoPais?.previousValue ?? null}
              stale={riesgoPais?.stale ?? false}
              format={(v) => `${formatNumber(v, 0)} pts`}
            />
          </>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1 min-w-4" />

      {/* Last-update timestamp */}
      <div className="flex items-center gap-2 px-4 text-xs text-slate-500 shrink-0">
        <span
          className={`inline-block w-2 h-2 rounded-full ${
            isError ? 'bg-red-500' : hasStaleData ? 'bg-yellow-500' : 'bg-green-500'
          }`}
        />
        <span className="font-mono">
          {serverTime ? `Últ. act.: ${formatTime(serverTime)}` : 'Esperando datos...'}
        </span>
      </div>
    </footer>
  );
}
