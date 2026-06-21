/**
 * SystemMetrics — Service health panel for the admin dashboard.
 *
 * Lists each backend service with:
 * - Status indicator (online / offline / degraded)
 * - Mini CPU + memory sparklines
 * - Uptime percentage
 * - Last seen timestamp
 */

import { motion } from 'framer-motion';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import type { SystemMetric } from '../../services/adminApi';

interface SystemMetricsProps {
  metrics: SystemMetric[];
}

const STATUS_CONFIG = {
  online: { label: 'Online', dot: 'bg-emerald-500', bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  degraded: { label: 'Degraded', dot: 'bg-amber-500', bg: 'bg-amber-500/10', text: 'text-amber-400' },
  offline: { label: 'Offline', dot: 'bg-red-500', bg: 'bg-red-500/10', text: 'text-red-400' },
} as const;

function SparklineMini({ data, color }: { data: number[]; color: string }) {
  const chartData = data.map((v, i) => ({ i, v }));
  return (
    <div className="h-8 w-20">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`mini-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1}
            fill={`url(#mini-${color.replace('#', '')})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function formatLastSeen(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};

const item = {
  hidden: { opacity: 0, x: -12 },
  show: { opacity: 1, x: 0 },
};

export function SystemMetrics({ metrics }: SystemMetricsProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.55 }}
      className="rounded-xl border border-slate-700/50 bg-slate-800/60 p-5"
    >
      <h3 className="text-sm font-semibold text-slate-300 mb-4">
        System Health
      </h3>

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="space-y-1"
      >
        {metrics.map((m) => {
          const status = STATUS_CONFIG[m.status];
          const cpuColor = m.cpu > 80 ? '#ef4444' : m.cpu > 60 ? '#f97316' : '#22c55e';
          const memColor = m.memory > 500 ? '#ef4444' : m.memory > 350 ? '#f97316' : '#22c55e';

          return (
            <motion.div
              key={m.service}
              variants={item}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-700/30 transition-colors group"
            >
              {/* Status dot */}
              <span className={`w-2 h-2 rounded-full ${status.dot} shrink-0`} />

              {/* Service name */}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-slate-300 truncate">
                  {m.service}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`text-[10px] ${status.text}`}>
                    {status.label}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {m.uptime.toFixed(1)}% uptime
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {formatLastSeen(m.lastSeen)}
                  </span>
                </div>
              </div>

              {/* CPU sparkline */}
              <div className="text-right">
                <div className="flex items-center gap-2">
                  <SparklineMini data={m.cpuHistory} color={cpuColor} />
                  <div className="w-10 text-right">
                    <p className="text-[10px] text-slate-400 font-mono">{m.cpu}%</p>
                    <p className="text-[9px] text-slate-600">CPU</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 justify-end mt-1">
                  <SparklineMini data={m.memoryHistory} color={memColor} />
                  <div className="w-10 text-right">
                    <p className="text-[10px] text-slate-400 font-mono">{m.memory}MB</p>
                    <p className="text-[9px] text-slate-600">MEM</p>
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </motion.div>
    </motion.div>
  );
}
