/**
 * UserActivityChart — User activity over time, split by role.
 *
 * Line chart showing VIP vs ADMIN active users per day.
 */

import { motion } from 'framer-motion';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import type { DailyStat } from '../../../services/adminApi';

interface UserActivityChartProps {
  data: DailyStat[];
}

export function UserActivityChart({ data }: UserActivityChartProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.45 }}
      className="rounded-xl border border-slate-700/50 bg-slate-800/60 p-5"
    >
      <h3 className="text-sm font-semibold text-slate-300 mb-4">
        Active Users by Role
      </h3>

      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
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

            <Legend
              wrapperStyle={{ fontSize: '11px', color: '#94a3b8', paddingTop: '8px' }}
            />

            <Line
              type="monotone"
              dataKey="activeUsers"
              name="Total Active"
              stroke="#6366f1"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5, strokeWidth: 0, fill: '#6366f1' }}
            />

            <Line
              type="monotone"
              dataKey="vipUsers"
              name="VIP"
              stroke="#22c55e"
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0, fill: '#22c55e' }}
            />

            <Line
              type="monotone"
              dataKey="adminUsers"
              name="Admin"
              stroke="#f97316"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0, fill: '#f97316' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
}
