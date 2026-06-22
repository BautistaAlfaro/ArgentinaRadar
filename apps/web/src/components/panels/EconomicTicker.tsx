import { useEconomicData } from '../../hooks/useEconomicData';
import { useAuthStore } from '../../stores/authStore';
import { LazyMotion, domAnimation, m } from 'framer-motion';

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

function IndicatorBlock({ label, value, previousValue, format, metadata }: IndicatorBlockProps) {
  if (value === null) return null;

  const delta = getDelta(value, previousValue);
  const formattedValue = format ? format(value) : formatNumber(value);

  const isInverted = label === 'Riesgo País';
  const arrowColor = isInverted
    ? delta.direction === 'up' ? 'text-red-400' : delta.direction === 'down' ? 'text-green-400' : 'text-slate-400'
    : delta.color;

  const icon = label.includes('Blue') ? 'payments' : label.includes('MERVAL') ? 'equalizer' : 'warning';
  const iconColor = label.includes('Blue') ? 'text-primary' : label.includes('MERVAL') ? 'text-secondary' : 'text-tertiary';

  const venta = metadata?.venta as number | undefined;
  const extraValue = venta != null ? `(Venta: $${formatNumber(venta, 0)})` : null;

  return (
    <div className="flex items-center gap-3 px-4 py-1 shrink-0 font-inter text-xs">
      <span className={`material-symbols-outlined ${iconColor} text-[18px]`} aria-hidden="true">{icon}</span>
      <span className="font-label-caps text-slate-400 uppercase font-bold tracking-wider">{label}</span>
      <span className="font-label-data text-white font-mono font-bold">{formattedValue}</span>
      {extraValue && (
        <span className="text-[10px] text-slate-500 font-mono">
          {extraValue}
        </span>
      )}
      <span className={`font-mono font-bold ${arrowColor} text-sm`}>
        {delta.arrow}
      </span>
    </div>
  );
}

export function EconomicTicker() {
  const {
    dolarBlue,
    merval,
    riesgoPais,
    isLoading,
    isError,
  } = useEconomicData();

  const role = useAuthStore((s) => s.user?.role ?? null);

  const blocks = (
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
        label="Riesgo País"
        value={riesgoPais?.value ?? null}
        previousValue={riesgoPais?.previousValue ?? null}
        stale={riesgoPais?.stale ?? false}
        format={(v) => `${formatNumber(v, 0)} pts`}
      />
    </>
  );

  return (
    <LazyMotion features={domAnimation}>
    <footer
      className="fixed bottom-0 left-0 w-full z-50 h-10 bg-surface-dim/90 backdrop-blur-md border-t border-white/10 shadow-[0_-4px_20px_rgba(0,165,114,0.1)] flex items-center overflow-hidden shrink-0"
    >
      {/* Live Status Badge */}
      {role === 'VIP' ? (
        <div className="flex items-center gap-2 border-r border-white/20 pr-4 mr-4 pl-4 shrink-0 bg-surface-dim z-10 h-full">
          <span className="material-symbols-outlined text-secondary text-lg animate-pulse" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">sensors</span>
          <span className="font-label-caps text-[10px] font-bold text-secondary font-inter tracking-wider">VIP FEED LIVE</span>
        </div>
      ) : role === 'ADMIN' ? (
        <div className="flex items-center gap-2 border-r border-white/20 pr-4 mr-4 pl-4 shrink-0 bg-surface-dim z-10 h-full">
          <span className="material-symbols-outlined text-primary text-lg animate-pulse" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">wifi_tethering</span>
          <span className="font-label-caps text-[10px] font-bold text-primary font-inter tracking-wider">LIVE DATASTREAM</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 border-r border-white/20 pr-4 mr-4 pl-4 shrink-0 bg-surface-dim z-10 h-full">
          <m.span
            className="material-symbols-outlined text-slate-400 text-lg"
            style={{ fontVariationSettings: "'FILL' 1'", display: 'inline-block' }}
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 4, ease: 'linear' }}
          >
            radar
          </m.span>
          <span className="font-label-caps text-[10px] font-bold text-slate-400 font-inter tracking-wider">ECONÓMICO</span>
        </div>
      )}

      {/* Scrolling indicators */}
      <div className="flex-1 overflow-hidden relative h-full flex items-center">
        {isLoading && (
          <div className="flex items-center gap-2 px-4 text-slate-500 font-inter text-xs">
            <span className="inline-block w-3 h-3 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
            <span>Cargando indicadores...</span>
          </div>
        )}

        {isError && (
          <div className="flex items-center gap-2 px-4 text-red-400 font-inter text-xs">
            <span className="material-symbols-outlined text-sm" aria-hidden="true">warning</span>
            <span>Error en indicadores financieros</span>
          </div>
        )}

        {!isLoading && !isError && (
          <div className="ticker-animate flex items-center gap-12 px-4">
            {blocks}
            {/* Duplicate for infinite loop */}
            {blocks}
          </div>
        )}
      </div>
    </footer>
    </LazyMotion>
  );
}
