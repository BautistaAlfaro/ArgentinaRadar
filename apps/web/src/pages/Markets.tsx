"use client";

import React, { useState, useMemo, lazy, Suspense } from 'react';
import { LazyMotion, domAnimation, m } from 'framer-motion';
import { Header } from '../components/Header';

const MainChart = lazy(() => import('../components/markets/MainChart'));

// --- Types ---
type TimeRange = '1D' | '1W' | '1M' | '6M' | '1Y' | 'MAX';

interface MarketItem {
  symbol: string;
  name: string;
  value: number;
  change: number;
  changePercent: number;
  sparkline: number[];
  updatedAt: string;
}

interface TickerItem {
  symbol: string;
  price: number;
  changePercent: number;
}

interface TableRowItem {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
}

interface NewsItem {
  id: string;
  title: string;
  source: string;
  time: string;
  tag: 'Mercados' | 'Economía' | 'Empresas';
}

interface SidebarItem {
  name: string;
  value: string;
  changePercent: number;
  isCrypto?: boolean;
}

// --- Mock Data ---

const MAIN_INDICATORS: MarketItem[] = [
  {
    symbol: 'MERV',
    name: 'S&P Merval',
    value: 1845620.40,
    change: 41220.15,
    changePercent: 2.28,
    sparkline: [35, 42, 38, 48, 55, 62, 59, 70, 75, 82, 80],
    updatedAt: '17:00:00',
  },
  {
    symbol: 'MERV.USD',
    name: 'Merval USD',
    value: 1414.25,
    change: 21.80,
    changePercent: 1.57,
    sparkline: [30, 28, 35, 40, 38, 45, 48, 52, 50, 58, 62],
    updatedAt: '17:00:00',
  },
  {
    symbol: 'ARS.OF',
    name: 'Dólar Oficial',
    value: 942.50,
    change: 0.50,
    changePercent: 0.05,
    sparkline: [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30],
    updatedAt: '15:00:00',
  },
  {
    symbol: 'ARS.MEP',
    name: 'Dólar MEP',
    value: 1295.80,
    change: -12.40,
    changePercent: -0.95,
    sparkline: [60, 58, 62, 65, 59, 54, 50, 48, 45, 42, 38],
    updatedAt: '16:55:00',
  },
  {
    symbol: 'ARS.CCL',
    name: 'Dólar CCL',
    value: 1308.20,
    change: -8.10,
    changePercent: -0.62,
    sparkline: [55, 58, 60, 54, 52, 48, 49, 45, 42, 38, 40],
    updatedAt: '16:55:00',
  },
  {
    symbol: 'RISK.AR',
    name: 'Riesgo País',
    value: 1385.00,
    change: -42.00,
    changePercent: -2.94,
    sparkline: [80, 85, 78, 72, 68, 65, 69, 62, 58, 55, 50],
    updatedAt: '17:00:00',
  },
];

const TICKER_ITEMS: TickerItem[] = [
  { symbol: 'GGAL', price: 4210.50, changePercent: 3.42 },
  { symbol: 'YPFD', price: 28400.00, changePercent: 2.15 },
  { symbol: 'PAMP', price: 3120.00, changePercent: 1.85 },
  { symbol: 'TXAR', price: 915.00, changePercent: -1.25 },
  { symbol: 'ALUA', price: 890.00, changePercent: -0.80 },
  { symbol: 'CEPU', price: 1240.00, changePercent: 0.95 },
  { symbol: 'COME', price: 185.00, changePercent: 4.12 },
  { symbol: 'AL30', price: 54.20, changePercent: 2.85 },
  { symbol: 'GD30', price: 56.90, changePercent: 3.10 },
];

const TOP_GAINERS: TableRowItem[] = [
  { symbol: 'COME', name: 'Sociedad Comercial del Plata', price: 185.00, changePercent: 4.12 },
  { symbol: 'GGAL', name: 'Grupo Financiero Galicia', price: 4210.50, changePercent: 3.42 },
  { symbol: 'EDN', name: 'Edenor S.A.', price: 1450.00, changePercent: 2.95 },
  { symbol: 'AL30', name: 'Bonos Rep. Arg. USD 2030', price: 54.20, changePercent: 2.85 },
  { symbol: 'TGSU2', name: 'Transportadora Gas del Sur', price: 4890.00, changePercent: 2.60 },
];

const TOP_LOSERS: TableRowItem[] = [
  { symbol: 'TXAR', name: 'Ternium Argentina S.A.', price: 915.00, changePercent: -1.25 },
  { symbol: 'ALUA', name: 'Aluar Aluminio Argentino', price: 890.00, changePercent: -0.80 },
  { symbol: 'BYMA', name: 'Bolsas y Mercados Argentinos', price: 2150.00, changePercent: -0.75 },
  { symbol: 'SUPV', name: 'Grupo Supervielle S.A.', price: 1840.00, changePercent: -0.54 },
  { symbol: 'LOMA', name: 'Loma Negra Compania Industrial', price: 1980.00, changePercent: -0.30 },
];

const SIDEBAR_ITEMS: SidebarItem[] = [
  { name: 'Bitcoin (BTC)', value: 'USD 97,420.00', changePercent: 1.84, isCrypto: true },
  { name: 'Ethereum (ETH)', value: 'USD 3,240.50', changePercent: 0.95, isCrypto: true },
  { name: 'Oro Spot', value: 'USD 2,654.20 / oz', changePercent: -0.42 },
  { name: 'Crudo Brent', value: 'USD 74.85 / bbl', changePercent: 1.15 },
  { name: 'Nasdaq 100', value: '20,410.50', changePercent: 0.72 },
  { name: 'S&P 500', value: '5,980.20', changePercent: 0.45 },
];

const FINANCIAL_NEWS: NewsItem[] = [
  {
    id: 'n1',
    title: 'El Merval vuela impulsado por ADRs bancarios y el descenso del Riesgo País',
    source: 'Radar Finanzas',
    time: 'Hace 15m',
    tag: 'Mercados',
  },
  {
    id: 'n2',
    title: 'Las liquidaciones del agro mantienen calmo al dólar MEP en la rueda bursátil',
    source: 'Reuters',
    time: 'Hace 45m',
    tag: 'Economía',
  },
  {
    id: 'n3',
    title: 'YPF anuncia emisión de Obligaciones Negociables por USD 300 millones',
    source: 'Mercado Argentino',
    time: 'Hace 1h',
    tag: 'Empresas',
  },
  {
    id: 'n4',
    title: 'Analistas prevén desaceleración inflacionaria para el próximo bimestre',
    source: 'Ecolatina',
    time: 'Hace 2h',
    tag: 'Economía',
  },
  {
    id: 'n5',
    title: 'Grupo Galicia completa la adquisición de filial bancaria internacional',
    source: 'Ambito Financiero',
    time: 'Hace 3h',
    tag: 'Empresas',
  },
];

// Historical mock data generator for chart
function generateChartData(range: TimeRange) {
  const points = range === '1D' ? 24 : range === '1W' ? 7 : range === '1M' ? 30 : range === '6M' ? 24 : range === '1Y' ? 12 : 50;
  const data = [];
  let baseValue = 1845620.40;
  const now = new Date();

  for (let i = points; i >= 0; i--) {
    const d = new Date(now);
    if (range === '1D') d.setHours(now.getHours() - i);
    else if (range === '1W' || range === '1M') d.setDate(now.getDate() - i);
    else if (range === '6M' || range === '1Y') d.setMonth(now.getMonth() - i);
    else d.setFullYear(now.getFullYear() - Math.floor(i / 12), now.getMonth() - (i % 12));

    const label = range === '1D'
      ? `${d.getHours()}:00`
      : d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });

    const randomFactor = (Math.random() - 0.45) * 45000;
    baseValue = baseValue - (i * 2000) + randomFactor;

    data.push({
      date: label,
      value: Math.round(baseValue),
    });
  }

  data[data.length - 1].value = 1845620.40;
  return data;
}

// --- Sub-components ---

function CardSparkline({ points, isPositive }: { points: number[]; isPositive: boolean }) {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const spread = max - min === 0 ? 1 : max - min;

  const width = 120;
  const height = 40;
  const coords = points.map((val, idx) => {
    const x = (idx / (points.length - 1)) * width;
    const y = height - ((val - min) / spread) * height + 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const strokeColor = isPositive ? '#10b981' : '#f43f5e';
  const fillColor = isPositive ? 'rgba(16,185,129,0.08)' : 'rgba(244,63,94,0.08)';

  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden="true">
      <polygon
        points={`0,${height} ${coords} ${width},${height}`}
        fill={fillColor}
      />
      <polyline
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.5"
        points={coords}
      />
    </svg>
  );
}

function IndicatorCard({
  item,
  isSelected,
  onSelect,
}: {
  item: MarketItem;
  isSelected: boolean;
  onSelect: (symbol: string) => void;
}) {
  const isPos = item.changePercent >= 0;

  return (
    <m.div
      key={item.symbol}
      whileHover={{ y: -2 }}
      onClick={() => onSelect(item.symbol)}
      onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') onSelect(item.symbol); }}
      role="button"
      tabIndex={0}
      aria-label={`Select ${item.name}`}
      className={`glass-panel p-4 rounded cursor-pointer transition-all flex flex-col justify-between h-[120px] focus:outline-none focus:ring-2 focus:ring-[#00A3FF]/50 ${
        isSelected
          ? 'border-[#00A3FF]/50 bg-[#00A3FF]/5 shadow-[0_0_15px_rgba(0,163,255,0.08)]'
          : 'border-white/10 hover:border-[#00A3FF]/30'
      }`}
    >
      <div className="flex justify-between items-start">
        <div>
          <span className="font-label-caps text-[10px] text-on-surface-variant font-bold uppercase tracking-wider block">
            {item.name}
          </span>
          <span className="font-label-data text-xs text-[#00A3FF] font-jetbrains-mono block mt-0.5">
            {item.symbol}
          </span>
        </div>
        <span className={`font-mono text-xs font-bold px-1.5 py-0.5 rounded ${
          isPos ? 'bg-secondary/15 text-secondary' : 'bg-error/15 text-error'
        }`}>
          {isPos ? '+' : ''}{item.changePercent.toFixed(2)}%
        </span>
      </div>

      <div className="flex justify-between items-end mt-2">
        <div>
          <span className="text-xl font-bold font-jetbrains-mono text-white tracking-tight block">
            {item.symbol === 'RISK.AR'
              ? Math.round(item.value).toLocaleString('es-AR')
              : item.value.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            }
          </span>
          <span className="text-[9px] text-on-surface-variant/60 font-label-data font-jetbrains-mono">
            Actualizado: {item.updatedAt}
          </span>
        </div>
        <div className="opacity-90 pl-2 shrink-0">
          <CardSparkline points={item.sparkline} isPositive={isPos} />
        </div>
      </div>
    </m.div>
  );
}

const TICKER_ACTIVE_SYMBOLS = ['GGAL', 'YPFD', 'PAMP', 'TXAR', 'ALUA', 'CEPU', 'COME'];

function TickerItemRow({ item }: { item: TickerItem }) {
  const isPos = item.changePercent >= 0;

  return (
    <button
      type="button"
      className="flex items-center gap-2 cursor-pointer hover:text-white transition-colors"
      onClick={() => {
        if (TICKER_ACTIVE_SYMBOLS.includes(item.symbol)) {
          // Focus Merval
        }
      }}
      aria-label={`${item.symbol}: ${item.price} (${isPos ? '+' : ''}${item.changePercent.toFixed(2)}%)`}
    >
      <span className="font-bold text-white font-jetbrains-mono">{item.symbol}</span>
      <span className="font-mono text-on-surface-variant/80">{item.price.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
      <span className={`font-mono font-bold flex items-center gap-0.5 text-xs ${isPos ? 'text-secondary' : 'text-error'}`}>
        {isPos ? '▲' : '▼'} {Math.abs(item.changePercent).toFixed(2)}%
      </span>
    </button>
  );
}

function TickerMarquee({ items, ariaHidden }: { items: TickerItem[]; ariaHidden?: boolean }) {
  return (
    <div className="flex items-center gap-12 px-8 font-label-data text-[11px] text-on-surface-variant animate-marquee" aria-hidden={ariaHidden}>
      {items.map((item) => (
        <TickerItemRow key={item.symbol} item={item} />
      ))}
    </div>
  );
}

function MarketStatusBadge({ isOpen }: { isOpen: boolean }) {
  return (
    <div className={`px-3 py-1.5 rounded border flex items-center gap-2 font-label-caps text-[10px] font-black tracking-wider ${
      isOpen
        ? 'bg-secondary/15 border-secondary/30 text-secondary'
        : 'bg-error/15 border-error/30 text-error'
    }`}>
      <span className={`w-2 h-2 rounded-full ${isOpen ? 'bg-secondary animate-pulse' : 'bg-error'}`} />
      <span>{isOpen ? 'MERCADO ABIERTO' : 'MERCADO CERRADO'}</span>
    </div>
  );
}

function GlobalSidebarItem({ item }: { item: SidebarItem }) {
  const isPos = item.changePercent >= 0;
  return (
    <div key={item.name} className="flex justify-between items-center border-b border-white/5 pb-2.5 last:border-0 last:pb-0">
      <div>
        <span className="text-[11px] font-bold text-white block uppercase font-inter">{item.name}</span>
        <span className="text-[10px] text-on-surface-variant/70 font-label-data mt-0.5 block font-jetbrains-mono">{item.value}</span>
      </div>
      <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded shrink-0 ${
        isPos ? 'bg-secondary/15 text-secondary' : 'bg-error/15 text-error'
      }`}>
        {isPos ? '+' : ''}{item.changePercent.toFixed(2)}%
      </span>
    </div>
  );
}

// --- Typed table components ---

function TableHeaderCell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={`pb-2 ${className ?? ''}`}>{children}</th>;
}

function GainersTable({ items }: { items: TableRowItem[] }) {
  return (
    <div className="glass-panel p-4 rounded active-glow">
      <h3 className="font-label-caps text-xs text-secondary font-bold tracking-wider uppercase flex items-center gap-2 mb-4 border-b border-white/5 pb-2">
        <span className="material-symbols-outlined text-sm">trending_up</span>
        Mayores Subas (Panel General)
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left font-label-data text-xs border-collapse">
          <thead>
            <tr className="text-on-surface-variant/60 font-label-caps border-b border-white/5 text-[9px] font-bold tracking-widest uppercase">
              <TableHeaderCell>Símbolo</TableHeaderCell>
              <TableHeaderCell>Compañía</TableHeaderCell>
              <TableHeaderCell className="font-mono">Último</TableHeaderCell>
              <TableHeaderCell className="font-mono text-right">Variación</TableHeaderCell>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {items.map((row) => (
              <tr key={row.symbol} className="hover:bg-white/5 transition-colors group">
                <td className="py-2.5 font-bold text-white font-jetbrains-mono">{row.symbol}</td>
                <td className="py-2.5 text-on-surface-variant truncate max-w-[140px] font-medium">{row.name}</td>
                <td className="py-2.5 font-mono text-white">${row.price.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
                <td className="py-2.5 font-mono text-right text-secondary font-bold">+{row.changePercent.toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LosersTable({ items }: { items: TableRowItem[] }) {
  return (
    <div className="glass-panel p-4 rounded active-glow">
      <h3 className="font-label-caps text-xs text-error font-bold tracking-wider uppercase flex items-center gap-2 mb-4 border-b border-white/5 pb-2">
        <span className="material-symbols-outlined text-sm">trending_down</span>
        Mayores Bajas (Panel General)
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left font-label-data text-xs border-collapse">
          <thead>
            <tr className="text-on-surface-variant/60 font-label-caps border-b border-white/5 text-[9px] font-bold tracking-widest uppercase">
              <TableHeaderCell>Símbolo</TableHeaderCell>
              <TableHeaderCell>Compañía</TableHeaderCell>
              <TableHeaderCell className="font-mono">Último</TableHeaderCell>
              <TableHeaderCell className="font-mono text-right">Variación</TableHeaderCell>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {items.map((row) => (
              <tr key={row.symbol} className="hover:bg-white/5 transition-colors group">
                <td className="py-2.5 font-bold text-white font-jetbrains-mono">{row.symbol}</td>
                <td className="py-2.5 text-on-surface-variant truncate max-w-[140px] font-medium">{row.name}</td>
                <td className="py-2.5 font-mono text-white">${row.price.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
                <td className="py-2.5 font-mono text-right text-error font-bold">{row.changePercent.toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Main component ---

export function Markets() {
  const [selectedRange, setSelectedRange] = useState<TimeRange>('1M');
  const [selectedIndicator, setSelectedIndicator] = useState<string>('MERV');

  const isMarketOpen = useMemo(() => {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const arTime = new Date(utc + (3600000 * -3));
    const day = arTime.getDay();
    const hours = arTime.getHours();
    return day >= 1 && day <= 5 && hours >= 11 && hours < 17;
  }, []);

  const chartData = useMemo(() => generateChartData(selectedRange), [selectedRange]);

  const activeIndicator = useMemo(
    () => MAIN_INDICATORS.find((ind) => ind.symbol === selectedIndicator) ?? MAIN_INDICATORS[0],
    [selectedIndicator],
  );

  return (
    <LazyMotion features={domAnimation}>
    <div className="min-h-screen bg-[#0B1220] text-[#dde2f8] font-inter select-none antialiased relative overflow-hidden pb-12">
      <Header />

      <div className="scanline" />

      {/* --- 1. Top Ticker horizontal animado --- */}
      <div className="w-full bg-[#080e1d] border-b border-white/5 h-10 flex items-center overflow-hidden whitespace-nowrap z-40 relative mt-16">
        <div className="flex items-center gap-1.5 px-6 border-r border-white/10 h-full bg-[#080e1d] z-20 shrink-0 select-none">
          <span className="material-symbols-outlined text-xs text-[#00A3FF] animate-pulse" aria-hidden="true">monitoring</span>
          <span className="font-label-caps text-[9px] font-bold text-on-surface-variant tracking-wider uppercase">Bolsa Argentina</span>
        </div>

        <div className="flex-1 flex overflow-hidden" aria-label="Stock ticker">
          <TickerMarquee items={TICKER_ITEMS} />
          <TickerMarquee items={TICKER_ITEMS} ariaHidden />
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-4 md:px-8 mt-6 space-y-6">

        {/* --- 2. Header and Market Status --- */}
        <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-4 border-b border-white/5 pb-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-headline-lg text-headline-lg text-white font-black tracking-tight uppercase font-space-grotesk">
                MERCADOS EN VIVO
              </h1>
              <span className="bg-[#00A3FF]/15 text-[#00A3FF] text-[9px] font-bold px-2 py-0.5 rounded border border-[#00A3FF]/30 font-jetbrains-mono tracking-widest uppercase">
                Premium
              </span>
            </div>
            <p className="text-sm text-on-surface-variant/80 font-inter mt-1">
              Seguimiento en tiempo real del mercado argentino e internacional.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <MarketStatusBadge isOpen={isMarketOpen} />
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-3 py-1.5 bg-white/5 border border-white/10 text-on-surface-variant hover:text-primary hover:bg-white/10 rounded flex items-center gap-1.5 font-label-caps text-[10px] font-bold cursor-pointer transition-colors"
              aria-label="Actualizar página"
            >
              <span className="material-symbols-outlined text-sm" aria-hidden="true">refresh</span>
              Actualizar
            </button>
          </div>
        </div>

        {/* --- 3. Main Grid Layout --- */}
        <div className="grid grid-cols-12 gap-5">

          {/* Left / Center Content (9 Cols) */}
          <div className="col-span-12 lg:col-span-9 space-y-6">

            {/* Cards principal indicators */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {MAIN_INDICATORS.map((item) => (
                <IndicatorCard
                  key={item.symbol}
                  item={item}
                  isSelected={selectedIndicator === item.symbol}
                  onSelect={setSelectedIndicator}
                />
              ))}
            </div>

            {/* TradingView-style Main Chart (lazy loaded — recharts) */}
            <Suspense fallback={
              <div className="glass-panel p-5 rounded active-glow flex items-center justify-center h-[420px]">
                <div className="flex items-center gap-3 text-on-surface-variant">
                  <span className="inline-block w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm font-mono">Cargando gráfico...</span>
                </div>
              </div>
            }>
              <MainChart
                data={chartData}
                indicatorSymbol={activeIndicator.symbol}
                indicatorName={activeIndicator.name}
                indicatorChange={activeIndicator.change}
                indicatorChangePercent={activeIndicator.changePercent}
                indicatorValue={activeIndicator.value}
                selectedRange={selectedRange}
                onRangeChange={(r) => setSelectedRange(r as TimeRange)}
              />
            </Suspense>

            {/* Top Movers sub-tables */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <GainersTable items={TOP_GAINERS} />
              <LosersTable items={TOP_LOSERS} />
            </div>

          </div>

          {/* Right Content / Sidebar (3 Cols) */}
          <div className="col-span-12 lg:col-span-3 space-y-5">

            {/* Widget Markets commodities/cryptos */}
            <div className="glass-panel p-4 rounded active-glow">
              <h3 className="font-label-caps text-xs text-primary font-bold tracking-wider uppercase flex items-center gap-2 mb-4 border-b border-white/5 pb-2">
                <span className="material-symbols-outlined text-sm" aria-hidden="true">public</span>
                Mercados Globales
              </h3>
              <div className="space-y-4">
                {SIDEBAR_ITEMS.map((item) => (
                  <GlobalSidebarItem key={item.name} item={item} />
                ))}
              </div>
            </div>

            {/* Financial News */}
            <div className="glass-panel p-4 rounded active-gow flex flex-col justify-between">
              <div>
                <h3 className="font-label-caps text-xs text-primary font-bold tracking-wider uppercase flex items-center gap-2 mb-4 border-b border-white/5 pb-2">
                  <span className="material-symbols-outlined text-sm" aria-hidden="true">description</span>
                  Radar Financiero
                </h3>
                <div className="space-y-4">
                  {FINANCIAL_NEWS.map((news) => {
                    const tagColors = {
                      Mercados: 'bg-[#00A3FF]/10 text-[#00A3FF] border-[#00A3FF]/20',
                      Economía: 'bg-tertiary/10 text-tertiary border-tertiary/20',
                      Empresas: 'bg-secondary/10 text-secondary border-secondary/20',
                    };
                    return (
                      <div key={news.id} className="group border-b border-white/5 pb-3 last:border-0 last:pb-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className={`text-[8px] font-bold px-1.5 py-0.2 rounded border font-label-caps tracking-wider uppercase ${tagColors[news.tag]}`}>
                            {news.tag}
                          </span>
                          <span className="text-[9px] text-on-surface-variant/60 font-mono">{news.time}</span>
                        </div>
                        <h4 className="text-xs font-semibold leading-tight text-white transition-colors line-clamp-2">
                          {news.title}
                        </h4>
                        <span className="text-[9px] text-on-surface-variant/50 mt-1 block font-label-data">
                          Fuente: {news.source}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

          </div>

        </div>

        {/* --- 4. Section Footer Disclaimer --- */}
        <div className="border-t border-white/5 mt-8 pt-4 flex flex-col sm:flex-row justify-between items-center gap-3">
          <p className="text-[10px] text-on-surface-variant/60 font-label-data uppercase tracking-wider text-center sm:text-left">
            Datos financieros con fines informativos. No constituyen recomendación de inversión.
          </p>
          <p className="text-[9px] text-on-surface-variant/40 font-mono">
            Powered by Argentina Radar Engine &copy; 2026
          </p>
        </div>

      </div>
    </div>
    </LazyMotion>
  );
}
